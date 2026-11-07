from pypdf import _page_labels
import os
from pdfreader import read_pdf
from chunker import chunk_pages
from embedder import embed_chunks
from vectorstore import store_in_pinecone
# from typing import List

pdf_path = "./resources/HR_Policy_RAG_Demo.pdf"
def run():

    pages = read_pdf (pdf_path)
    chunks = chunk_pages (pages,chunk_size=900,chunk_overlap=150)
    embed_chunkes= embed_chunks (chunks)
    store_in_pinecone(chunks, embed_chunkes,namespace="")

if __name__ == "__main__":
    run()