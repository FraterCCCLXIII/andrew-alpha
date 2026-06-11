#!/usr/bin/env python3
"""Smoke-test export and retrieval without the Chainlit UI."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

EVAL_QUESTIONS = [
    "What are the Five Tenets?",
    "What is clarity of intention?",
    "What is Evolutionary Enlightenment?",
    "How does Andrew Cohen describe meditation?",
    "What is the Authentic Self?",
]


def main() -> None:
    export_script = ROOT / "scripts/export_corpus.py"
    subprocess.run([sys.executable, str(export_script)], check=True)

    settings_module = __import__("rag.config", fromlist=["get_settings"])
    settings = settings_module.get_settings()
    corpus_path = settings.corpus_path

    if not corpus_path.exists():
        raise SystemExit("Export failed: corpus.jsonl not created")

    line_count = sum(1 for _ in corpus_path.open(encoding="utf-8"))
    print(f"corpus.jsonl lines: {line_count}")
    if line_count < 400:
        raise SystemExit(f"Expected at least 400 documents, got {line_count}")

    from rag.chunking import build_chunk_records

    chunk_total = 0
    with corpus_path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                chunk_total += len(build_chunk_records(json.loads(line)))
    print(f"estimated chunks after ingest: {chunk_total}")
    if chunk_total < 1000:
        raise SystemExit(f"Expected at least 1000 chunks, got {chunk_total}")

    try:
        from rag.retrieve import retrieve_passages
    except Exception as error:
        print(f"Skipping retrieval tests (index may be missing): {error}")
        return

    try:
        passages = retrieve_passages("What are the Five Tenets?", top_k=3)
    except RuntimeError as error:
        print(f"Retrieval skipped: {error}")
        print("Run `python scripts/ingest.py` after configuring embeddings.")
        return

    print(f"sample retrieval hits: {len(passages)}")
    for passage in passages:
        print(f"  - [{passage['sourceType']}] {passage['title']}")

    for question in EVAL_QUESTIONS:
        hits = retrieve_passages(question, top_k=2)
        print(f"\nQ: {question}")
        for hit in hits:
            print(f"  -> {hit['title']} ({hit['sourceType']})")


if __name__ == "__main__":
    main()
