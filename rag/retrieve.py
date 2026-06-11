from __future__ import annotations

import chromadb
from chromadb.config import Settings as ChromaSettings

from rag.config import Settings, get_settings
from rag.providers import LiteLLMEmbeddingFunction

COLLECTION_NAME = "andrew_cohen_archive"


def get_chroma_client(settings: Settings | None = None) -> chromadb.PersistentClient:
    settings = settings or get_settings()
    settings.chroma_path.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(
        path=str(settings.chroma_path),
        settings=ChromaSettings(anonymized_telemetry=False),
    )


def get_collection(settings: Settings | None = None):
    settings = settings or get_settings()
    client = get_chroma_client(settings)
    embedding_fn = LiteLLMEmbeddingFunction(settings)
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=embedding_fn,
        metadata={"hnsw:space": "cosine"},
    )


def retrieve_passages(
    query: str,
    *,
    top_k: int | None = None,
    settings: Settings | None = None,
) -> list[dict]:
    settings = settings or get_settings()
    collection = get_collection(settings)
    count = collection.count()
    if count == 0:
        raise RuntimeError(
            "The vector index is empty. Run: python scripts/export_corpus.py && python scripts/ingest.py"
        )

    result = collection.query(
        query_texts=[query],
        n_results=min(top_k or settings.top_k, count),
        include=["documents", "metadatas", "distances"],
    )

    passages: list[dict] = []
    documents = result.get("documents", [[]])[0]
    metadatas = result.get("metadatas", [[]])[0]

    for document, metadata in zip(documents, metadatas, strict=False):
        metadata = metadata or {}
        passages.append(
            {
                "id": metadata.get("id", ""),
                "title": metadata.get("title", "Untitled"),
                "text": document or "",
                "url": metadata.get("url", ""),
                "sourceType": metadata.get("sourceType", ""),
                "metadata": metadata,
            }
        )

    return _prioritize_sources(passages)


def _prioritize_sources(passages: list[dict]) -> list[dict]:
    priority = {
        "dictionary": 0,
        "book": 1,
        "teaching": 2,
        "journal": 3,
        "transcript": 4,
    }
    return sorted(
        passages,
        key=lambda item: (priority.get(item.get("sourceType", ""), 5), item.get("title", "")),
    )
