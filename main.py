"""FastAPI REST API for the HR Policy RAG Assistant."""

from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from pdfreader import read_pdf
from chunker import chunk_pages
from embedder import embed_chunks, embed_User_query
from vectorstore import index, store_in_pinecone, search_in_pinecone
from llm import query_llm_with_context

PDF_PATH = "./resources/HR_Policy_RAG_Demo.pdf"
NAMESPACE = ""


# ---------- Request / response models ----------

class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, examples=["How many days is the probation period?"])
    top_k: int = Field(4, ge=1, le=20, description="Number of chunks to retrieve")
    include_sources: bool = Field(False, description="Return the retrieved chunks too")


class AskResponse(BaseModel):
    question: str
    answer: str
    sources: Optional[List[str]] = None


class IngestRequest(BaseModel):
    pdf_path: str = PDF_PATH
    chunk_size: int = Field(900, gt=0)
    chunk_overlap: int = Field(150, ge=0)


class IngestResponse(BaseModel):
    message: str
    pdf_path: str
    chunks_stored: int


class HealthResponse(BaseModel):
    status: str
    vector_count: int


# ---------- Helpers ----------

def get_vector_count() -> int:
    stats = index.describe_index_stats()
    ns = stats.namespaces.get(NAMESPACE)
    return ns.vector_count if ns else 0


def run_ingest(pdf_path: str, chunk_size: int, chunk_overlap: int) -> int:
    pages = read_pdf(pdf_path)
    chunks = chunk_pages(pages, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    embeddings = embed_chunks(chunks)
    store_in_pinecone(chunks, embeddings, namespace=NAMESPACE)
    return len(chunks)


# ---------- App ----------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ingest the default PDF on startup if the index is empty
    try:
        if get_vector_count() == 0:
            print("Index is empty, ingesting default PDF ...")
            run_ingest(PDF_PATH, 900, 150)
    except Exception as e:
        print(f"Startup ingestion skipped: {e}")
    yield


app = FastAPI(
    title="HR Policy RAG API",
    description="Ask questions about a PDF and get answers grounded in its content.",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse, tags=["System"])
def health():
    try:
        return HealthResponse(status="ok", vector_count=get_vector_count())
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Vector store unavailable: {e}")


@app.post("/api/v1/ask", response_model=AskResponse, tags=["RAG"])
def ask(req: AskRequest):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Question must not be empty.")

    try:
        query_vector = embed_User_query(question)
        chunks = search_in_pinecone(query_vector, top_k=req.top_k, namespace=NAMESPACE)
        if not chunks:
            answer = "I couldn't find anything relevant in the document."
        else:
            answer = query_llm_with_context(question, chunks)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to generate answer: {e}")

    return AskResponse(
        question=question,
        answer=answer,
        sources=chunks if req.include_sources else None,
    )


@app.post("/api/v1/ingest", response_model=IngestResponse, tags=["RAG"])
def ingest(req: IngestRequest = IngestRequest()):
    if req.chunk_overlap >= req.chunk_size:
        raise HTTPException(status_code=422, detail="chunk_overlap must be smaller than chunk_size.")
    try:
        count = run_ingest(req.pdf_path, req.chunk_size, req.chunk_overlap)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ingestion failed: {e}")

    return IngestResponse(message="Ingestion complete", pdf_path=req.pdf_path, chunks_stored=count)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
