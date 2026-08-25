from __future__ import annotations

import argparse
import hashlib
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import create_engine, text

from app.core.config import get_settings
from app.core.time import utc_now
from app.services.grammar import embed_texts

GRAMMAR_DIR = Path("data/grammar")


@dataclass(frozen=True)
class GrammarDoc:
    doc_id: str
    title: str
    level: str
    topic: str
    source: str
    source_path: str
    body: str


@dataclass(frozen=True)
class GrammarChunk:
    chunk_id: str
    doc: GrammarDoc
    section: str
    content: str
    content_hash: str
    sort_order: int


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest grammar notes into Supabase pgvector.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--changed-only", action="store_true")
    parser.add_argument("--delete-missing", action="store_true")
    parser.add_argument("--corpus-dir", default=str(GRAMMAR_DIR))
    args = parser.parse_args()

    settings = get_settings()
    database_url = settings.database_url
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    engine = create_engine(database_url)

    docs = [parse_doc(path) for path in sorted(Path(args.corpus_dir).glob("*.md"))]
    chunks = [chunk for doc in docs for chunk in chunk_doc(doc)]
    print(f"Found {len(docs)} documents and {len(chunks)} chunks.")
    if args.dry_run:
        for chunk in chunks:
            print(f"{chunk.chunk_id}: {chunk.doc.level}/{chunk.doc.topic}/{chunk.section}")
        return

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
            doc_hash = sha256(doc.body)
            conn.execute(
                text(
                    """
                    insert into grammar_documents
                        (id, title, level, topic, source_path, content_hash, created_at, updated_at)
                    values
                        (:id, :title, :level, :topic, :source_path, :content_hash, :now, :now)
                    on conflict (id) do update set
                        title = excluded.title,
                        level = excluded.level,
                        topic = excluded.topic,
                        source_path = excluded.source_path,
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
                    "content_hash": doc_hash,
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
                            id, document_id, title, section, level, topic, source_path, content,
                            content_hash, sort_order, embedding, created_at, updated_at
                        )
                    values
                        (
                            :id, :document_id, :title, :section, :level, :topic, :source_path,
                            :content, :content_hash, :sort_order,
                            cast(:embedding as extensions.vector), :now, :now
                        )
                    on conflict (id) do update set
                        title = excluded.title,
                        section = excluded.section,
                        level = excluded.level,
                        topic = excluded.topic,
                        source_path = excluded.source_path,
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


def parse_doc(path: Path) -> GrammarDoc:
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
        body=body.strip(),
    )


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


def build_chunk(doc: GrammarDoc, section: str, lines: list[str], order: int) -> GrammarChunk:
    content = "\n".join(line.rstrip() for line in lines).strip()
    digest = sha256(content)
    return GrammarChunk(
        chunk_id=f"{doc.doc_id}-{slug(section)}",
        doc=doc,
        section=section,
        content=content,
        content_hash=digest,
        sort_order=order,
    )


def slug(value: str) -> str:
    cleaned = "".join(char.lower() if char.isalnum() else "-" for char in value)
    return "-".join(part for part in cleaned.split("-") if part)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    main()
