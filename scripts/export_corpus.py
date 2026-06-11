#!/usr/bin/env python3
"""Export Andrew Cohen archive content from andrew-cohen-site into corpus.jsonl."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Iterator

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from rag.config import get_settings  # noqa: E402


def main() -> None:
    settings = get_settings()
    source = settings.corpus_source
    if not source.exists():
        raise SystemExit(f"Corpus source not found: {source}")

    documents: list[dict[str, Any]] = []
    documents.extend(export_books(source))
    documents.extend(export_transcripts(source))
    documents.extend(export_journal(source))
    documents.extend(export_dictionary(source))
    documents.extend(export_teaching(source))

    settings.corpus_path.parent.mkdir(parents=True, exist_ok=True)
    with settings.corpus_path.open("w", encoding="utf-8") as handle:
        for document in documents:
            handle.write(json.dumps(document, ensure_ascii=False) + "\n")

    counts: dict[str, int] = {}
    for document in documents:
        counts[document["sourceType"]] = counts.get(document["sourceType"], 0) + 1

    print(f"Wrote {len(documents)} documents to {settings.corpus_path}")
    for source_type, count in sorted(counts.items()):
        print(f"  {source_type}: {count}")


def export_books(source: Path) -> list[dict[str, Any]]:
    books_dir = source / "src/data/books"
    documents: list[dict[str, Any]] = []

    for book_dir in sorted(books_dir.iterdir()):
        if not book_dir.is_dir():
            continue
        index_path = book_dir / "index.json"
        if not index_path.exists():
            continue

        index = json.loads(index_path.read_text(encoding="utf-8"))
        book_slug = index["slug"]
        book_title = index["title"]

        for chapter in index.get("chapters", []):
            content_path = book_dir / chapter["contentFile"]
            if not content_path.exists():
                continue
            body = json.loads(content_path.read_text(encoding="utf-8")).get("body", "")
            if not body.strip():
                continue

            chapter_id = chapter["id"]
            chapter_title = chapter["title"]
            documents.append(
                {
                    "id": f"book:{book_slug}:{chapter_id}",
                    "sourceType": "book",
                    "title": f"{book_title} — {chapter_title}",
                    "text": body.strip(),
                    "url": f"/books/{book_slug}/read/{chapter_id}",
                    "metadata": {
                        "bookSlug": book_slug,
                        "chapterId": chapter_id,
                        "partId": chapter.get("partId"),
                        "sourceCitation": index.get("credits", book_title),
                    },
                }
            )

    return documents


def export_transcripts(source: Path) -> list[dict[str, Any]]:
    transcripts_dir = source / "src/data/transcripts"
    videos_path = source / "src/data/youtube-videos.json"
    video_lookup: dict[str, dict[str, Any]] = {}

    if videos_path.exists():
        for video in json.loads(videos_path.read_text(encoding="utf-8")):
            youtube_id = video.get("youtubeId") or video.get("id", "").replace("yt-", "")
            if youtube_id:
                video_lookup[youtube_id] = video

    documents: list[dict[str, Any]] = []
    for path in sorted(transcripts_dir.glob("yt-*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        text = data.get("text", "").strip()
        if not text:
            continue

        transcript_id = data.get("id", path.stem)
        youtube_id = data.get("youtubeId", transcript_id.replace("yt-", ""))
        video = video_lookup.get(youtube_id, {})
        title = data.get("title") or video.get("title") or transcript_id

        documents.append(
            {
                "id": f"transcript:{transcript_id}",
                "sourceType": "transcript",
                "title": title,
                "text": text,
                "url": f"/archive/{transcript_id}",
                "metadata": {
                    "youtubeId": youtube_id,
                    "postedAt": video.get("date"),
                    "tags": video.get("tags", []),
                    "sourceCitation": title,
                },
            }
        )

    return documents


def export_journal(source: Path) -> list[dict[str, Any]]:
    content_dir = source / "src/data/journal/content"
    index_path = source / "src/data/journal/index.json"
    index_lookup: dict[str, dict[str, Any]] = {}

    if index_path.exists():
        index_data = json.loads(index_path.read_text(encoding="utf-8"))
        for article in index_data.get("articles", []):
            index_lookup[article["slug"]] = article

    documents: list[dict[str, Any]] = []
    for path in sorted(content_dir.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        slug = data.get("slug", path.stem)
        html = data.get("contentHtml", "")
        text = html_to_text(html)
        if not text.strip():
            continue

        article = index_lookup.get(slug, {})
        title = article.get("title") or slug.replace("-", " ").title()

        documents.append(
            {
                "id": f"journal:{slug}",
                "sourceType": "journal",
                "title": title,
                "text": text.strip(),
                "url": f"/journal/{slug}",
                "metadata": {
                    "slug": slug,
                    "postedAt": article.get("postedAt"),
                    "author": article.get("author", "Andrew Cohen"),
                    "tags": article.get("tags", []),
                    "sourceCitation": title,
                },
            }
        )

    return documents


def export_dictionary(source: Path) -> list[dict[str, Any]]:
    dictionary_path = source / "src/data/dictionary.ts"
    text = dictionary_path.read_text(encoding="utf-8")
    documents: list[dict[str, Any]] = []

    pattern = re.compile(
        r'id:\s*"(?P<id>[^"]+)"\s*,\s*'
        r'term:\s*"(?P<term>[^"]+)"\s*,\s*'
        r'category:\s*"(?P<category>[^"]+)"\s*,\s*'
        r'definition:\s*\n?\s*"(?P<definition>(?:\\.|[^"\\])*)"\s*,\s*'
        r'source:\s*"(?P<source>(?:\\.|[^"\\])*)"',
        re.DOTALL,
    )

    for match in pattern.finditer(text):
        entry_id = match.group("id")
        term = match.group("term")
        category = match.group("category")
        definition = match.group("definition").replace('\\"', '"')
        citation = match.group("source").replace('\\"', '"')
        body = f"{term}\n\n{definition}\n\nSource: {citation}"

        documents.append(
            {
                "id": f"dictionary:{entry_id}",
                "sourceType": "dictionary",
                "title": f"Dictionary — {term}",
                "text": body.strip(),
                "url": f"/dictionary#{entry_id}",
                "metadata": {
                    "term": term,
                    "category": category,
                    "sourceCitation": citation,
                },
            }
        )

    return documents


def export_teaching(source: Path) -> list[dict[str, Any]]:
    teaching_dir = source / "src/app/teaching"
    documents: list[dict[str, Any]] = []

    for page_path in sorted(teaching_dir.glob("*/page.tsx")):
        slug = page_path.parent.name
        if slug == "page.tsx":
            continue
        page_text = page_path.read_text(encoding="utf-8")
        page_title = extract_page_title(page_text, slug)

        for section in extract_sections(page_text):
            section_id = slugify(section["title"])
            documents.append(
                {
                    "id": f"teaching:{slug}:{section_id}",
                    "sourceType": "teaching",
                    "title": f"{page_title} — {section['title']}",
                    "text": section["body"].strip(),
                    "url": f"/teaching/{slug}",
                    "metadata": {
                        "slug": slug,
                        "sectionTitle": section["title"],
                        "sourceCitation": page_title,
                    },
                }
            )

        for index, quote in enumerate(extract_quotes(page_text)):
            documents.append(
                {
                    "id": f"teaching:{slug}:quote-{index + 1}",
                    "sourceType": "teaching",
                    "title": f"{page_title} — Quote",
                    "text": f"{quote['text']}\n\n— {quote['source']}",
                    "url": f"/teaching/{slug}",
                    "metadata": {
                        "slug": slug,
                        "sourceCitation": quote["source"],
                    },
                }
            )

    return documents


def extract_page_title(page_text: str, slug: str) -> str:
    match = re.search(r'title="([^"]+)"', page_text)
    if match:
        return match.group(1)
    return slug.replace("-", " ").title()


def extract_sections(page_text: str) -> list[dict[str, str]]:
    match = re.search(r"const sections = \[(.*?)\n\];", page_text, re.DOTALL)
    if not match:
        return []

    sections: list[dict[str, str]] = []
    block = match.group(1)
    for section_match in re.finditer(
        r'title:\s*"((?:\\.|[^"\\])*)"\s*,\s*body:\s*`((?:\\.|[^`\\])*)`',
        block,
        re.DOTALL,
    ):
        title = section_match.group(1).replace('\\"', '"')
        body = section_match.group(2).replace("\\`", "`")
        sections.append({"title": title, "body": body})
    return sections


def extract_quotes(page_text: str) -> list[dict[str, str]]:
    match = re.search(r"const quotes = \[(.*?)\n\];", page_text, re.DOTALL)
    if not match:
        return []

    quotes: list[dict[str, str]] = []
    block = match.group(1)
    for quote_match in re.finditer(
        r'text:\s*"((?:\\.|[^"\\])*)"\s*,\s*source:\s*"((?:\\.|[^"\\])*)"',
        block,
        re.DOTALL,
    ):
        quotes.append(
            {
                "text": quote_match.group(1).replace('\\"', '"'),
                "source": quote_match.group(2).replace('\\"', '"'),
            }
        )
    return quotes


def html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()
    return soup.get_text("\n", strip=True)


def slugify(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "section"


if __name__ == "__main__":
    main()
