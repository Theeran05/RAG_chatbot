import sys

from pdfreader import read_pdf
from chunker import chunk_pages
from embedder import embed_chunks, embed_User_query
from vectorstore import index, store_in_pinecone, search_in_pinecone
from llm import query_llm_with_context

PDF_PATH = "./resources/HR_Policy_RAG_Demo.pdf"
NAMESPACE = ""
EXIT_WORDS = {"exit", "quit", "q", "bye"}


def ingest() -> None:
    """Read the PDF, chunk it, embed the chunks and store them in Pinecone."""
    print(f"Reading {PDF_PATH} ...")
    pages = read_pdf(PDF_PATH)
    chunks = chunk_pages(pages, chunk_size=900, chunk_overlap=150)
    print(f"Created {len(chunks)} chunks. Embedding ...")
    embeddings = embed_chunks(chunks)
    store_in_pinecone(chunks, embeddings, namespace=NAMESPACE)


def index_has_data() -> bool:
    """True if the Pinecone index already holds vectors in our namespace."""
    stats = index.describe_index_stats()
    ns = stats.namespaces.get(NAMESPACE)
    return bool(ns and ns.vector_count > 0)


def answer(query: str) -> str:
    """Embed the question, find matching chunks and ask the LLM."""
    query_vector = embed_User_query(query)
    matched_chunks = search_in_pinecone(query_vector, top_k=4, namespace=NAMESPACE)
    if not matched_chunks:
        return "I couldn't find anything relevant in the document."
    return query_llm_with_context(query, matched_chunks)


def main() -> None:
    # Ingest only when asked (python main.py --ingest) or when the index is empty
    if "--ingest" in sys.argv or not index_has_data():
        ingest()
    else:
        print("Index already has data, skipping ingestion (use --ingest to rebuild).")

    print("\nAsk me anything about the HR policy. Type 'exit' to quit.\n")

    while True:
        try:
            query = input("You: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nGoodbye!")
            break

        if not query:
            continue
        if query.lower() in EXIT_WORDS:
            print("Goodbye!")
            break

        try:
            print(f"\nAssistant: {answer(query)}\n")
        except KeyboardInterrupt:
            print("\n(cancelled)\n")
        except Exception as e:
            # Keep the loop alive on API/network errors
            print(f"\nError: {e}\n")


if __name__ == "__main__":
    main()
