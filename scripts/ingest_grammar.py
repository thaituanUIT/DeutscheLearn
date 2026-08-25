from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.core.time import utc_now
from app.services.grammar import embed_texts

GRAMMAR_DIR = Path("data/grammar")
PDF_DIR = Path("data/grammar_pdfs")
MANIFEST_PATH = Path("data/grammar_sources.json")
SourceKind = Literal["markdown", "pdf"]


@dataclass(frozen=True)
class GrammarDoc:
    doc_id: str
    title: str
    level: str
    topic: str
    source: str
    source_path: str
    source_kind: SourceKind
    body: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class GrammarChunk:
    chunk_id: str
    doc: GrammarDoc
    section: str
    content: str
    content_hash: str
    sort_order: int
    page_start: int | None = None
    page_end: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest grammar notes into Supabase pgvector.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--extract-only", action="store_true")
    parser.add_argument("--changed-only", action="store_true")
    parser.add_argument("--delete-missing", action="store_true")
    parser.add_argument("--corpus-dir", default=str(GRAMMAR_DIR))
    parser.add_argument("--pdf-dir", default=str(PDF_DIR))
    parser.add_argument("--manifest", default=str(MANIFEST_PATH))
    parser.add_argument(
        "--source-kind",
        choices=["markdown", "pdf", "all"],
        default="all",
        help="Limit ingestion to Markdown, PDF, or both.",
    )
    args = parser.parse_args()

    docs = load_documents(
        corpus_dir=Path(args.corpus_dir),
        pdf_dir=Path(args.pdf_dir),
        manifest_path=Path(args.manifest),
        source_kind=args.source_kind,
    )
    chunks = [chunk for doc in docs for chunk in chunk_doc(doc)]
    print(f"Found {len(docs)} documents and {len(chunks)} chunks.")
    if args.dry_run or args.extract_only:
        for chunk in chunks:
            page = page_label(chunk)
            print(f"{chunk.chunk_id}: {chunk.doc.level}/{chunk.doc.topic}/{chunk.section}{page}")
            if args.extract_only:
                print(chunk.content[:700].strip())
                print()
        return

    settings = get_settings()
    engine = create_engine(normalize_database_url(settings.database_url))

    with engine.begin() as conn:
        existing_hashes = {}
        if args.changed_only and chunks:
            rows = conn.execute(
                text("select id, content_hash from grammar_chunks where id = any(:ids)"),
                {"ids": [chunk.chunk_id for chunk in chunks]},
            )
            existing_hashes = {row.id: row.content_hash for row in rows}

        changed_chunks = [
            chunk
            for chunk in chunks
            if not args.changed_only or existing_hashes.get(chunk.chunk_id) != chunk.content_hash
        ]
        print(f"Embedding {len(changed_chunks)} changed chunks.")
        embeddings = []
        for start in range(0, len(changed_chunks), 96):
            batch = changed_chunks[start : start + 96]
            embeddings.extend(
                embed_texts([chunk.content for chunk in batch], input_type="search_document")
            )

        now = utc_now()
        for doc in docs:
            conn.execute(
                text(
                    """
                    insert into grammar_documents
                        (
                            id, title, level, topic, source_path, source_kind, metadata_json,
                            content_hash, created_at, updated_at
                        )
                    values
                        (
                            :id, :title, :level, :topic, :source_path, :source_kind, :metadata_json,
                            :content_hash, :now, :now
                        )
                    on conflict (id) do update set
                        title = excluded.title,
                        level = excluded.level,
                        topic = excluded.topic,
                        source_path = excluded.source_path,
                        source_kind = excluded.source_kind,
                        metadata_json = excluded.metadata_json,
                        content_hash = excluded.content_hash,
                        updated_at = excluded.updated_at
                    """
                ),
                {
                    "id": doc.doc_id,
                    "title": doc.title,
                    "level": doc.level,
                    "topic": doc.topic,
                    "source_path": doc.source_path,
                    "source_kind": doc.source_kind,
                    "metadata_json": json.dumps(doc.metadata, ensure_ascii=False),
                    "content_hash": sha256(doc.body),
                    "now": now,
                },
            )

        for chunk, embedding in zip(changed_chunks, embeddings, strict=True):
            embedding_literal = "[" + ",".join(f"{value:.8f}" for value in embedding) + "]"
            conn.execute(
                text(
                    """
                    insert into grammar_chunks
                        (
                            id, document_id, title, section, level, topic, source_path, source_kind,
                            page_start, page_end, metadata_json, content, content_hash, sort_order,
                            embedding, created_at, updated_at
                        )
                    values
                        (
                            :id, :document_id, :title, :section, :level, :topic, :source_path,
                            :source_kind, :page_start, :page_end, :metadata_json, :content,
                            :content_hash, :sort_order, cast(:embedding as extensions.vector), :now, :now
                        )
                    on conflict (id) do update set
                        title = excluded.title,
                        section = excluded.section,
                        level = excluded.level,
                        topic = excluded.topic,
                        source_path = excluded.source_path,
                        source_kind = excluded.source_kind,
                        page_start = excluded.page_start,
                        page_end = excluded.page_end,
                        metadata_json = excluded.metadata_json,
                        content = excluded.content,
                        content_hash = excluded.content_hash,
                        sort_order = excluded.sort_order,
                        embedding = excluded.embedding,
                        updated_at = excluded.updated_at
                    """
                ),
                {
                    "id": chunk.chunk_id,
                    "document_id": chunk.doc.doc_id,
                    "title": chunk.doc.title,
                    "section": chunk.section,
                    "level": chunk.doc.level,
                    "topic": chunk.doc.topic,
                    "source_path": chunk.doc.source_path,
                    "source_kind": chunk.doc.source_kind,
                    "page_start": chunk.page_start,
                    "page_end": chunk.page_end,
                    "metadata_json": json.dumps(chunk.metadata, ensure_ascii=False),
                    "content": chunk.content,
                    "content_hash": chunk.content_hash,
                    "sort_order": chunk.sort_order,
                    "embedding": embedding_literal,
                    "now": now,
                },
            )

        if args.delete_missing:
            ids = [chunk.chunk_id for chunk in chunks]
            conn.execute(text("delete from grammar_chunks where not (id = any(:ids))"), {"ids": ids})


def load_documents(
    corpus_dir: Path,
    pdf_dir: Path,
    manifest_path: Path,
    source_kind: str,
) -> list[GrammarDoc]:
    docs: list[GrammarDoc] = []
    if source_kind in {"markdown", "all"}:
        docs.extend(parse_markdown_doc(path) for path in sorted(corpus_dir.glob("*.md")))
    if source_kind in {"pdf", "all"}:
        docs.extend(parse_pdf_doc(entry, pdf_dir) for entry in load_manifest(manifest_path))
    return docs


def load_manifest(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise TypeError(f"{path} must contain a JSON array")
    for index, entry in enumerate(data):
        if not isinstance(entry, dict):
            raise TypeError(f"{path} entry {index} must be an object")
        required = {"id", "title", "level", "topic", "path"}
        missing = required - entry.keys()
        if missing:
            raise ValueError(f"{path} entry {index} missing: {', '.join(sorted(missing))}")
    return data


def parse_markdown_doc(path: Path) -> GrammarDoc:
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---\n"):
        raise ValueError(f"{path} is missing frontmatter")
    _, frontmatter, body = raw.split("---\n", 2)
    meta = parse_frontmatter(frontmatter)
    return GrammarDoc(
        doc_id=meta["id"],
        title=meta["title"],
        level=meta["level"],
        topic=meta["topic"],
        source=meta.get("source", "curated"),
        source_path=str(path),
        source_kind="markdown",
        body=body.strip(),
        metadata={"source": meta.get("source", "curated")},
    )


def parse_pdf_doc(entry: dict[str, Any], pdf_dir: Path) -> GrammarDoc:
    pdf_path = pdf_dir / str(entry["path"])
    if not pdf_path.exists():
        raise FileNotFoundError(f"Missing grammar PDF: {pdf_path}")
    markdown = extract_pdf_markdown(pdf_path, entry)
    if len(markdown.strip()) < 300:
        raise ValueError(
            f"{pdf_path} produced very little text. It may be scanned; run OCR locally first."
        )
    return GrammarDoc(
        doc_id=str(entry["id"]),
        title=str(entry["title"]),
        level=str(entry["level"]),
        topic=str(entry["topic"]),
        source=str(entry.get("source", "pdf")),
        source_path=str(pdf_path),
        source_kind="pdf",
        body=markdown.strip(),
        metadata={
            key: value
            for key, value in entry.items()
            if key not in {"id", "title", "level", "topic", "path"}
        },
    )


def extract_pdf_markdown(pdf_path: Path, entry: dict[str, Any]) -> str:
    try:
        import pymupdf4llm
    except ImportError as exc:
        raise RuntimeError(
            "PDF ingestion requires pymupdf4llm. Install dependencies with `uv sync`."
        ) from exc

    pages = entry.get("pages")
    if isinstance(pages, list) and len(pages) == 2:
        start, end = int(pages[0]), int(pages[1])
        page_chunks = [
            extract_pdf_page(pymupdf4llm, pdf_path, page_number)
            for page_number in range(start, end + 1)
        ]
        return "\n\n".join(page_chunks)

    markdown = pymupdf4llm.to_markdown(str(pdf_path))
    page_chunks = split_pdf_pages(markdown)
    if len(page_chunks) <= 1:
        return f"<!-- page:1 -->\n{markdown}"
    return "\n\n".join(page_chunks)


def extract_pdf_page(module: Any, pdf_path: Path, page_number: int) -> str:
    markdown = module.to_markdown(str(pdf_path), pages=[page_number - 1])
    return f"<!-- page:{page_number} -->\n{markdown}"


def split_pdf_pages(markdown: str) -> list[str]:
    pages = [page.strip() for page in markdown.split("\f") if page.strip()]
    if len(pages) > 1:
        return [f"<!-- page:{index} -->\n{page}" for index, page in enumerate(pages, start=1)]
    return [markdown]


def parse_frontmatter(frontmatter: str) -> dict[str, str]:
    values = {}
    for line in frontmatter.splitlines():
        key, _, value = line.partition(":")
        if key and value:
            values[key.strip()] = value.strip()
    required = {"id", "title", "level", "topic"}
    missing = required - values.keys()
    if missing:
        raise ValueError(f"Missing frontmatter fields: {', '.join(sorted(missing))}")
    return values


def chunk_doc(doc: GrammarDoc) -> list[GrammarChunk]:
    if doc.source_kind == "pdf":
        return chunk_pdf_doc(doc)
    return chunk_markdown_doc(doc)


def chunk_markdown_doc(doc: GrammarDoc) -> list[GrammarChunk]:
    chunks = []
    section = doc.title
    lines: list[str] = []
    order = 0
    for line in doc.body.splitlines():
        if line.startswith("# "):
            if lines:
                chunks.append(build_chunk(doc, section, lines, order))
                order += 1
                lines = []
            section = line.removeprefix("# ").strip()
        else:
            lines.append(line)
    if lines:
        chunks.append(build_chunk(doc, section, lines, order))
    return chunks


def chunk_pdf_doc(doc: GrammarDoc) -> list[GrammarChunk]:
    chunks: list[GrammarChunk] = []
    section = doc.title
    lines: list[str] = []
    current_page: int | None = None
    page_start: int | None = None
    page_end: int | None = None
    order = 0

    def flush() -> None:
        nonlocal lines, order, page_start, page_end
        content = "\n".join(line.rstrip() for line in lines).strip()
        if content:
            chunks.append(
                build_chunk(
                    doc,
                    section,
                    content.splitlines(),
                    order,
                    page_start=page_start,
                    page_end=page_end,
                )
            )
            order += 1
        lines = []
        page_start = None
        page_end = None

    for line in doc.body.splitlines():
        page = parse_page_marker(line)
        if page is not None:
            current_page = page
            continue
        heading = parse_heading(line)
        if heading:
            flush()
            section = heading
            continue
        if current_page is not None and line.strip():
            page_start = current_page if page_start is None else min(page_start, current_page)
            page_end = current_page if page_end is None else max(page_end, current_page)
        lines.append(line)
        if approximate_token_count("\n".join(lines)) > 520:
            flush()
    flush()
    return chunks


def parse_page_marker(line: str) -> int | None:
    match = re.match(r"<!--\s*page:(\d+)\s*-->", line.strip())
    return int(match.group(1)) if match else None


def parse_heading(line: str) -> str | None:
    stripped = line.strip()
    if stripped.startswith("#"):
        return stripped.lstrip("#").strip()
    return None


def build_chunk(
    doc: GrammarDoc,
    section: str,
    lines: list[str],
    order: int,
    page_start: int | None = None,
    page_end: int | None = None,
) -> GrammarChunk:
    content = "\n".join(line.rstrip() for line in lines).strip()
    digest = sha256(content)
    if doc.source_kind == "markdown":
        chunk_id = f"{doc.doc_id}-{slug(section)}"
    else:
        page_suffix = f"-p{page_start}-{page_end}" if page_start is not None else ""
        chunk_id = f"{doc.doc_id}-{slug(section)}{page_suffix}-{order}"
    return GrammarChunk(
        chunk_id=chunk_id,
        doc=doc,
        section=section[:200],
        content=content,
        content_hash=digest,
        sort_order=order,
        page_start=page_start,
        page_end=page_end,
        metadata={},
    )


def normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+psycopg://", 1)
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url


def approximate_token_count(text: str) -> int:
    return max(1, len(text) // 4)


def page_label(chunk: GrammarChunk) -> str:
    if chunk.page_start is None or chunk.page_end is None:
        return ""
    if chunk.page_start == chunk.page_end:
        return f"/p.{chunk.page_start}"
    return f"/pp.{chunk.page_start}-{chunk.page_end}"


def slug(value: str) -> str:
    cleaned = "".join(char.lower() if char.isalnum() else "-" for char in value)
    return "-".join(part for part in cleaned.split("-") if part)[:90]


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    main()
