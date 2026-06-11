from __future__ import annotations

import re
from typing import Any

import tiktoken

ENCODER = tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    return len(ENCODER.encode(text))


def split_paragraphs(text: str) -> list[str]:
    parts = re.split(r"\n\s*\n+", text.strip())
    return [part.strip() for part in parts if part.strip()]


def chunk_text(
    text: str,
    *,
    max_tokens: int = 1200,
    overlap_tokens: int = 100,
    source_type: str = "book",
) -> list[str]:
    if not text.strip():
        return []

    transcript_max = 800 if source_type == "transcript" else max_tokens
    limit = transcript_max

    if count_tokens(text) <= limit:
        return [text.strip()]

    if source_type == "transcript" and "\n\n" not in text:
        return _split_by_tokens(text, limit, overlap_tokens)

    paragraphs = split_paragraphs(text)
    if len(paragraphs) <= 1 and source_type == "transcript":
        return _split_by_tokens(text, limit, overlap_tokens)

    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0

    for paragraph in paragraphs:
        paragraph_tokens = count_tokens(paragraph)
        if paragraph_tokens > limit:
            if current:
                chunks.append("\n\n".join(current))
                current = []
                current_tokens = 0
            chunks.extend(_split_by_tokens(paragraph, limit, overlap_tokens))
            continue

        if current_tokens + paragraph_tokens > limit and current:
            chunks.append("\n\n".join(current))
            overlap = _tail_overlap("\n\n".join(current), overlap_tokens)
            current = [overlap, paragraph] if overlap else [paragraph]
            current_tokens = count_tokens("\n\n".join(current))
        else:
            current.append(paragraph)
            current_tokens += paragraph_tokens

    if current:
        chunks.append("\n\n".join(current))

    return [chunk.strip() for chunk in chunks if chunk.strip()]


def _tail_overlap(text: str, overlap_tokens: int) -> str:
    tokens = ENCODER.encode(text)
    if len(tokens) <= overlap_tokens:
        return text
    return ENCODER.decode(tokens[-overlap_tokens:])


def _split_by_tokens(text: str, max_tokens: int, overlap_tokens: int) -> list[str]:
    tokens = ENCODER.encode(text)
    chunks: list[str] = []
    start = 0
    while start < len(tokens):
        end = min(start + max_tokens, len(tokens))
        chunks.append(ENCODER.decode(tokens[start:end]).strip())
        if end >= len(tokens):
            break
        start = max(end - overlap_tokens, start + 1)
    return chunks


def build_chunk_records(document: dict[str, Any]) -> list[dict[str, Any]]:
    source_type = document["sourceType"]
    pieces = chunk_text(document["text"], source_type=source_type)
    records: list[dict[str, Any]] = []

    for index, piece in enumerate(pieces):
        chunk_id = document["id"] if len(pieces) == 1 else f"{document['id']}:{index}"
        records.append(
            {
                "id": chunk_id,
                "text": piece,
                "title": document["title"],
                "url": document["url"],
                "sourceType": source_type,
                "metadata": {
                    **document.get("metadata", {}),
                    "chunkIndex": index,
                    "chunkCount": len(pieces),
                    "parentId": document["id"],
                },
            }
        )

    return records
