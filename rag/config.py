from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def _resolve_path(value: str, base: Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else (base / path).resolve()


@dataclass(frozen=True)
class Settings:
    root: Path
    corpus_source: Path
    site_base_url: str
    corpus_path: Path
    chroma_path: Path
    llm_provider: str
    embedding_provider: str
    openai_api_key: str
    openai_model: str
    openai_embedding_model: str
    ollama_base_url: str
    ollama_model: str
    ollama_embedding_model: str
    top_k: int

    @property
    def llm_model(self) -> str:
        if self.llm_provider == "ollama":
            return f"ollama/{self.ollama_model}"
        return self.openai_model

    @property
    def embedding_model(self) -> str:
        if self.embedding_provider == "ollama":
            return f"ollama/{self.ollama_embedding_model}"
        return self.openai_embedding_model


def get_settings() -> Settings:
    return Settings(
        root=ROOT,
        corpus_source=_resolve_path(
            os.getenv("CORPUS_SOURCE", "../andrew-cohen-site"), ROOT
        ),
        site_base_url=os.getenv("SITE_BASE_URL", "http://localhost:3002").rstrip(
            "/"
        ),
        corpus_path=_resolve_path(os.getenv("CORPUS_PATH", "./data/corpus.jsonl"), ROOT),
        chroma_path=_resolve_path(os.getenv("CHROMA_PATH", "./data/chroma"), ROOT),
        llm_provider=os.getenv("LLM_PROVIDER", "openai").lower(),
        embedding_provider=os.getenv("EMBEDDING_PROVIDER", "openai").lower(),
        openai_api_key=os.getenv("OPENAI_API_KEY", ""),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        openai_embedding_model=os.getenv(
            "OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"
        ),
        ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        ollama_model=os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
        ollama_embedding_model=os.getenv(
            "OLLAMA_EMBEDDING_MODEL", "nomic-embed-text"
        ),
        top_k=int(os.getenv("TOP_K", "8")),
    )
