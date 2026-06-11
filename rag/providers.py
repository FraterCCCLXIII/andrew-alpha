from __future__ import annotations

from typing import Iterable

import litellm
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings

from rag.config import Settings, get_settings


class LiteLLMEmbeddingFunction(EmbeddingFunction):
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        if self.settings.embedding_provider == "ollama":
            litellm.api_base = self.settings.ollama_base_url

    def __call__(self, input: Documents) -> Embeddings:
        response = litellm.embedding(
            model=self.settings.embedding_model,
            input=list(input),
            api_key=self.settings.openai_api_key or None,
        )
        return [item["embedding"] for item in response.data]


def embed_query(text: str, settings: Settings | None = None) -> list[float]:
    settings = settings or get_settings()
    if settings.embedding_provider == "ollama":
        litellm.api_base = settings.ollama_base_url
    response = litellm.embedding(
        model=settings.embedding_model,
        input=[text],
        api_key=settings.openai_api_key or None,
    )
    return response.data[0]["embedding"]


def stream_completion(messages: list[dict[str, str]], settings: Settings | None = None):
    settings = settings or get_settings()
    if settings.llm_provider == "ollama":
        litellm.api_base = settings.ollama_base_url

    return litellm.completion(
        model=settings.llm_model,
        messages=messages,
        stream=True,
        api_key=settings.openai_api_key or None,
    )


def complete(messages: list[dict[str, str]], settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    if settings.llm_provider == "ollama":
        litellm.api_base = settings.ollama_base_url

    response = litellm.completion(
        model=settings.llm_model,
        messages=messages,
        stream=False,
        api_key=settings.openai_api_key or None,
    )
    return response.choices[0].message.content or ""
