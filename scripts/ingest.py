#!/usr/bin/env python3
"""Chunk corpus.jsonl, embed with LiteLLM, and store in ChromaDB."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from rag.chunking import build_chunk_records  # noqa: E402
from rag.config import get_settings  # noqa: E402
from rag.providers import LiteLLMEmbeddingFunction  # noqa: E402
from rag.retrieve import COLLECTION_NAME, get_chroma_client  # noqa: E402

BATCH_SIZE = 64


def main() -> None:
    settings = get_settings()
    if not settings.corpus_path.exists():
        raise SystemExit(
            f"Corpus not found at {settings.corpus_path}. Run scripts/export_corpus.py first."
        )

    documents = load_corpus(settings.corpus_path)
    chunks: list[dict] = []
    for document in documents:
        chunks.extend(build_chunk_records(document))

    print(f"Loaded {len(documents)} documents -> {len(chunks)} chunks")

    client = get_chroma_client(settings)
    try:
        client.delete_collection(COLLECTION_NAME)
    except Exception:
        pass

    collection = client.create_collection(
        name=COLLECTION_NAME,
        embedding_function=LiteLLMEmbeddingFunction(settings),
        metadata={"hnsw:space": "cosine"},
    )

    for start in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[start : start + BATCH_SIZE]
        collection.add(
            ids=[item["id"] for item in batch],
            documents=[item["text"] for item in batch],
            metadatas=[flatten_metadata(item) for item in batch],
        )
        print(f"  ingested {min(start + BATCH_SIZE, len(chunks))}/{len(chunks)}")

    print(f"Chroma index ready at {settings.chroma_path}")


def load_corpus(path: Path) -> list[dict]:
    documents: list[dict] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                documents.append(json.loads(line))
    return documents


def flatten_metadata(chunk: dict) -> dict:
    metadata = {
        "id": chunk["id"],
        "title": chunk["title"],
        "url": chunk["url"],
        "sourceType": chunk["sourceType"],
    }
    for key, value in chunk.get("metadata", {}).items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            metadata[key] = value
        else:
            metadata[key] = json.dumps(value)
    return metadata


if __name__ == "__main__":
    main()
