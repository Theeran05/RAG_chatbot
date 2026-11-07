from openai import OpenAI
from dotenv import load_dotenv
import os
from typing import List

# Load environment variables
load_dotenv()

# Initialize OpenRouter client
client = OpenAI(
    api_key=os.getenv("OPENROUTER_API_KEY"),
    base_url="https://openrouter.ai/api/v1"
)

# Free embedding model
EMBEDDING_MODEL = "liquid/lfm-2.5-embedding-350m:free"


def embed_chunks(chunks: List[str]) -> List[List[float]]:
    """Embed chunks using OpenRouter's free embedding model."""

    embeddings = []

    for chunk in chunks:
        response = client.embeddings.create(
            input=chunk,
            model=EMBEDDING_MODEL
        )

        embeddings.append(response.data[0].embedding)

    return embeddings

def embed_User_query(query: str) -> List[float]:
    """Embeds a user query using OpenAI's embedding model."""

    response = client.embeddings.create(
        input=query,
        model=EMBEDDING_MODEL
    )

    return response.data[0].embedding