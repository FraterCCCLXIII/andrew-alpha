# Andrew Cohen Archive — RAG Chat (Andrew-AI)

Standalone RAG app that reads text from the sibling [andrew-cohen-site](../andrew-cohen-site) repo, indexes it in ChromaDB, and serves a [Chainlit](https://chainlit.io/) chat UI with cited answers.

## Stack

- **Chainlit** — open-source chat UI (streaming, source panels)
- **ChromaDB** — local vector store
- **LiteLLM** — OpenAI or Ollama for embeddings + chat
- **Export pipeline** — books, transcripts, journal, teaching pages, dictionary

## Quick start

```bash
cd Andrew-AI
python3 -m venv .venv
source .venv/bin/activate
pip install -e .

cp .env.example .env
# Add OPENAI_API_KEY, or use Ollama (see below)
```

Export and ingest the corpus:

```bash
python scripts/export_corpus.py
python scripts/ingest.py
```

Run the chat UI:

```bash
chainlit run app/chainlit_app.py -w
```

Open the URL Chainlit prints (default `http://localhost:8000`).

### Chat modes

When you start a new chat, choose a profile:

- **Archive Research** — neutral research assistant with citations (default)
- **Andrew Alpha** — self-aware AI version of Andrew Cohen; speaks in his teaching voice, grounded in the archive, and explicitly not Andrew in the flesh

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `CORPUS_SOURCE` | `../andrew-cohen-site` | Path to the site repo |
| `SITE_BASE_URL` | `http://localhost:3002` | Base URL for citation links |
| `LLM_PROVIDER` | `openai` | `openai` or `ollama` |
| `EMBEDDING_PROVIDER` | `openai` | `openai` or `ollama` |
| `OPENAI_API_KEY` | — | Required when using OpenAI |
| `OPENAI_MODEL` | `gpt-4o-mini` | Chat model |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embeddings |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Local Ollama API |
| `OLLAMA_MODEL` | `llama3.1:8b` | Local chat model |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | Local embeddings |

### Using Ollama locally

```bash
docker compose up -d
ollama pull llama3.1:8b
ollama pull nomic-embed-text
```

Set in `.env`:

```
LLM_PROVIDER=ollama
EMBEDDING_PROVIDER=ollama
```

## Refreshing the index

When andrew-cohen-site content changes:

```bash
python scripts/export_corpus.py
python scripts/ingest.py
```

## Smoke test

```bash
python scripts/smoke_test.py
```

Export always runs. Retrieval tests run if a Chroma index already exists.

## Project layout

```
Andrew-AI/
  app/chainlit_app.py      # Chat UI
  rag/                     # Config, chunking, retrieval, prompts
  scripts/
    export_corpus.py       # Build corpus.jsonl from site repo
    ingest.py              # Embed + store in ChromaDB
    smoke_test.py          # Pipeline check
  data/                    # gitignored: corpus.jsonl, chroma/
```

## Notes

- Video transcripts are auto-captions; books and teaching pages are higher quality.
- The assistant cites archive URLs; it does not claim to be Andrew Cohen.
- Magazine PDFs and books without chapter JSON are not in the MVP corpus.
