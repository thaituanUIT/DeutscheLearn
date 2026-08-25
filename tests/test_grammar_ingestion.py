import json

import pytest

from scripts.ingest_grammar import (
    GrammarDoc,
    chunk_doc,
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
