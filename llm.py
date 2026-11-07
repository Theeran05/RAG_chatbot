from openai import OpenAI
from dotenv import load_dotenv
import os

# Load environment variables from .env file
load_dotenv()

# Initialize OpenRouter client
client = OpenAI(
    api_key=os.getenv("OPENROUTER_API_KEY"),
    base_url="https://openrouter.ai/api/v1"
)

# OpenRouter automatically selects an available free model
LLM_MODEL = "openrouter/free"


def query_llm_with_context(query: str, context) -> str:
    """Generate an answer using the user's query and retrieved context."""

    system_content = """You are a helpful assistant for answering user queries based on the provided context.

Use the context to provide accurate and relevant answers.

Do not make assumptions beyond the context provided.

If the context does not contain enough information to answer the query,
let the user know that you cannot provide an answer based on the given context.
"""

    # Convert retrieved chunks into one context string
    if isinstance(context, list):
        context = "\n\n".join(context)

    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {
                "role": "system",
                "content": system_content
            },
            {
                "role": "user",
                "content": f"Query: {query}\n\nContext:\n{context}"
            }
        ],
        temperature=0.4
    )

    return response.choices[0].message.content