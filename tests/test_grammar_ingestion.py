import json

import pytest

from scripts.ingest_grammar import (
    GrammarDoc,
    chunk_doc,
    embedding_text,
    load_manifest,
    parse_pdf_doc,
)


def test_manifest_requires_pdf_metadata(tmp_path) -> None:
    manifest = tmp_path / "grammar_sources.json"
    manifest.write_text(json.dumps([{"id": "a1"}]), encoding="utf-8")

    with pytest.raises(ValueError, match="missing"):
        load_manifest(manifest)


def test_pdf_chunks_preserve_page_ranges() -> None:
    doc = GrammarDoc(
        doc_id="pdf-grammar",
        title="PDF Grammar",
        level="A2",
        topic="praeposition_dativ",
        source="pdf",
        source_path="data/grammar_pdfs/sample.pdf",
        source_kind="pdf",
        body=(
            "<!-- page:3 -->\n"
            "# Dative Prepositions\n"
            "mit always takes Dativ.\n"
            "<!-- page:4 -->\n"
            "das Auto becomes dem Auto in Dativ."
        ),
    )

    chunks = chunk_doc(doc)

    assert len(chunks) == 1
    assert chunks[0].chunk_id == "pdf-grammar-dative-prepositions-p3-4-0"
    assert chunks[0].section == "Dative Prepositions"
    assert chunks[0].page_start == 3
    assert chunks[0].page_end == 4
    assert chunks[0].metadata["approximate_tokens"] > 0


def test_markdown_chunk_ids_stay_stable_for_normal_sections() -> None:
    doc = GrammarDoc(
        doc_id="artikel-kasus",
        title="Articles and Cases",
        level="A1",
        topic="artikel_kasus",
        source="curated",
        source_path="data/grammar/articles-cases.md",
        source_kind="markdown",
        body=(
            "# Nominativ and Akkusativ\n"
            "Use Nominativ for the subject.\n\n"
            "# Dativ Articles\n"
            "der becomes dem in Dativ."
        ),
        metadata={"source": "curated"},
    )

    chunks = chunk_doc(doc)

    assert [chunk.chunk_id for chunk in chunks] == [
        "artikel-kasus-nominativ-and-akkusativ",
        "artikel-kasus-dativ-articles",
    ]
    assert chunks[0].metadata["source"] == "curated"
    assert embedding_text(chunks[0]).startswith("Articles and Cases\nNominativ and Akkusativ\n")


def test_markdown_long_sections_split_on_paragraph_boundaries() -> None:
    paragraphs = [f"Paragraph {index}. " + ("This sentence explains Dativ. " * 80) for index in range(3)]
    doc = GrammarDoc(
        doc_id="long-doc",
        title="Long Doc",
        level="A2",
        topic="praeposition_dativ",
        source="curated",
        source_path="data/grammar/long-doc.md",
        source_kind="markdown",
        body="# Long Section\n" + "\n\n".join(paragraphs),
    )

    chunks = chunk_doc(doc)

    assert len(chunks) > 1
    assert chunks[0].chunk_id == "long-doc-long-section-0"
    assert chunks[1].chunk_id == "long-doc-long-section-1"
    assert all(chunk.content.startswith("Paragraph") for chunk in chunks)


def test_pdf_parse_rejects_missing_file(tmp_path) -> None:
    with pytest.raises(FileNotFoundError):
        parse_pdf_doc(
            {
                "id": "missing",
                "title": "Missing",
                "level": "A1",
                "topic": "articles",
                "path": "missing.pdf",
            },
            tmp_path,
        )
