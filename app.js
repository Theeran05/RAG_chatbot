(() => {
  "use strict";

  // ---------- Config (from config.js, generated from .env) ----------
  const cfg = window.APP_CONFIG || {};
  const isLocal = ["localhost", "127.0.0.1", "0.0.0.0", "", "::1"].includes(window.location.hostname);
  // SAME_ORIGIN: the page is served by the FastAPI app itself, so call the API
  // on the same host with relative URLs ("/api/v1/ask"). Works locally and on Vercel.
  const API_BASE = cfg.SAME_ORIGIN ? "" :
    cfg.API_BASE_URL ||
    (isLocal ? cfg.API_BASE_URL_LOCAL : cfg.API_BASE_URL_PROD) ||
    "http://127.0.0.1:8000";

  if (!window.APP_CONFIG) {
    console.warn("config.js missing. Run `node scripts/generate-config.js`. Falling back to", API_BASE);
  }

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const chat = $("chat");
  const welcome = $("welcome");
  const form = $("composer");
  const input = $("input");
  const sendBtn = $("send");
  const sourcesToggle = $("sourcesToggle");
  const topKSelect = $("topK");
  const clearBtn = $("clearChat");
  const status = $("status");

  // ---------- State ----------
  let busy = false;
  let includeSources = load("includeSources", true);
  let topK = load("topK", cfg.DEFAULT_TOP_K || 4);

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }

  // ---------- Controls ----------
  for (let k = 1; k <= 20; k++) {
    const opt = document.createElement("option");
    opt.value = k; opt.textContent = k;
    topKSelect.appendChild(opt);
  }
  topKSelect.value = topK;
  topKSelect.addEventListener("change", () => { topK = Number(topKSelect.value); save("topK", topK); });

  const renderSourcesToggle = () => {
    sourcesToggle.setAttribute("aria-pressed", String(includeSources));
    sourcesToggle.title = includeSources ? "Sources on: click to hide" : "Sources off: click to show";
  };
  renderSourcesToggle();
  sourcesToggle.addEventListener("click", () => {
    includeSources = !includeSources; save("includeSources", includeSources); renderSourcesToggle();
  });

  clearBtn.addEventListener("click", () => {
    if (busy) return;
    chat.querySelectorAll(".msg").forEach((m) => m.remove());
    welcome.hidden = false;
    input.focus();
  });

  document.querySelectorAll(".chip").forEach((chip) =>
    chip.addEventListener("click", () => ask(chip.textContent.trim()))
  );

  // Auto-grow textarea, Enter to send
  const autosize = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 180) + "px";
    sendBtn.disabled = busy || !input.value.trim();
  };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || busy) return;
    input.value = ""; autosize();
    ask(q);
  });

  // ---------- Rendering ----------
  function addMessage(role, text, extra = {}) {
    welcome.hidden = true;
    const wrap = document.createElement("div");
    wrap.className = `msg ${role}${extra.error ? " error" : ""}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (extra.typing) {
      bubble.innerHTML = '<span class="typing" aria-label="Thinking"><span></span><span></span><span></span></span>';
    } else {
      bubble.textContent = text; // user text stays plain
    }
    wrap.appendChild(bubble);
    chat.appendChild(wrap);
    scrollDown();
    return wrap;
  }

  // ---------- Minimal, safe Markdown renderer ----------
  // Escapes all HTML first, then adds a small set of tags we create ourselves,
  // so model output can never inject markup or scripts.
  const escapeHtml = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
     .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function inlineMd(text) {
    const codes = [];
    let s = escapeHtml(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1<em>$2</em>")
      .replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, "$1<em>$2</em>")
      .replace(/~~(.+?)~~/g, "<del>$1</del>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  }

  function renderMarkdown(md) {
    const lines = md.replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let para = [];
    let list = null; // { type: "ul" | "ol", items: [] }

    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(inlineMd).join("<br>")}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inlineMd(i)}</li>`).join("")}</${list.type}>`);
      list = null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/^\s*```/.test(line)) {               // fenced code block
        flushPara(); flushList();
        const code = [];
        while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
        out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }
      if (!line.trim()) { flushPara(); flushList(); continue; }

      let m;
      if ((m = line.match(/^\s*(#{1,6})\s+(.*)$/))) {
        flushPara(); flushList();
        const level = Math.min(m[1].length + 2, 6); // keep headings small inside a bubble
        out.push(`<h${level}>${inlineMd(m[2])}</h${level}>`);
      } else if (/^\s*(?:([-*_])\s*){3,}$/.test(line)) {
        flushPara(); flushList(); out.push("<hr>");
      } else if ((m = line.match(/^\s*>\s?(.*)$/))) {
        flushPara(); flushList(); out.push(`<blockquote>${inlineMd(m[1])}</blockquote>`);
      } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara();
        const type = /^\s*\d/.test(line) ? "ol" : "ul";
        if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
        list.items.push(m[1]);
      } else if (list && /^\s{2,}\S/.test(line)) {
        list.items[list.items.length - 1] += " " + line.trim(); // wrapped list item
      } else {
        flushList(); para.push(line);
      }
    }
    flushPara(); flushList();
    return out.join("");
  }

  function fillBotMessage(wrap, answer, sources) {
    const bubble = wrap.querySelector(".bubble");
    bubble.classList.add("md");
    bubble.innerHTML = renderMarkdown(answer);
    if (Array.isArray(sources) && sources.length) {
      const details = document.createElement("details");
      details.className = "sources";
      const summary = document.createElement("summary");
      summary.textContent = `${sources.length} source${sources.length > 1 ? "s" : ""} from the document`;
      const list = document.createElement("ol");
      sources.forEach((s) => {
        const li = document.createElement("li");
        li.textContent = s.trim();
        list.appendChild(li);
      });
      details.append(summary, list);
      wrap.appendChild(details);
    }
    scrollDown();
  }

  const scrollDown = () => chat.scrollTo({ top: chat.scrollHeight, behavior: "smooth" });

  // ---------- API ----------
  async function ask(question) {
    busy = true; autosize();
    addMessage("user", question);
    const pending = addMessage("bot", "", { typing: true });

    try {
      const res = await fetch(`${API_BASE}/api/v1/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, top_k: topK, include_sources: includeSources }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(res.status, data));
      fillBotMessage(pending, data.answer || "No answer returned.", data.sources);
    } catch (err) {
      pending.classList.add("error");
      const msg = err instanceof TypeError
        ? `Couldn't reach the API at ${API_BASE || window.location.origin}. Check that it is running and that CORS allows this site.`
        : err.message;
      fillBotMessage(pending, msg);
    } finally {
      busy = false; autosize(); input.focus();
    }
  }

  function errorText(code, data) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d) => d.msg).join(", ")
      : data.detail;
    const hints = {
      422: "The question was rejected",
      429: "Rate limited by the free model. Wait a moment and try again",
      502: "The AI service failed to answer",
      503: "The vector store is unavailable",
    };
    return `${hints[code] || `Request failed (${code})`}${detail ? `: ${detail}` : "."}`;
  }

  async function checkHealth() {
    const text = status.querySelector(".status-text");
    try {
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || res.status);
      status.className = "status ok";
      text.textContent = "Online";
      status.title = `${API_BASE} · ${data.vector_count} chunks indexed`;
    } catch (e) {
      status.className = "status down";
      text.textContent = "Offline";
      status.title = `Can't reach ${API_BASE}`;
    }
  }

  checkHealth();
  input.focus();
})();
