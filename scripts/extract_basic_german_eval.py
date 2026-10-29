"""Build grammar-point chunks from BasicGerman.pdf for retrieval benchmarks."""
from __future__ import annotations

import hashlib
import json
import re
import statistics
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "dev" / "BasicGerman.pdf"
OUT = ROOT / "evals" / "basic_german_sections.json"
MAX_CHARS = 3600

LIGATURES = str.maketrans(
    {
        "\ufb00": "ff",
        "\ufb01": "fi",
        "\ufb02": "fl",
        "\ufb03": "ffi",
        "\ufb04": "ffl",
        "\u2013": "-",
        "\u2014": "-",
    }
)


@dataclass
class Section:
    unit: str
    heading: str
    start_page: int
    lines: list[str] = field(default_factory=list)
    table_lines: list[str] = field(default_factory=list)
    end_page: int | None = None

    @property
    def path(self) -> str:
        return f"{self.unit} > {self.heading}"


def normalize_text(text: str) -> str:
    text = text.translate(LIGATURES)
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\x13", "").replace("\x17", "")
    return re.sub(r"[ \t]+", " ", text).strip()


def digest(source: str, section: str, content: str) -> str:
    return hashlib.sha256(f"{source}\n{section}\n{content}".encode()).hexdigest()


def is_unit_heading(text: str, size: float) -> bool:
    return size >= 18 and text.startswith("UNIT ")


def is_grammar_heading(text: str, size: float, font: str) -> bool:
    if size < 11.5 or "Bold" not in font:
        return False
    if text.startswith(("Exercise ", "Exercises", "Checklist")):
        return False
    if len(text) > 120:
        return False
    if re.fullmatch(r"\d+|[a-z]\)", text):
        return False
    return bool(re.search(r"[A-Za-z]", text))


def page_lines(page: fitz.Page) -> list[tuple[str, float, str, float]]:
    rows: list[tuple[str, float, str, float]] = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            text = normalize_text("".join(span.get("text", "") for span in spans))
            if not text:
                continue
            size = max((float(span.get("size", 0)) for span in spans), default=0.0)
            font = " ".join(str(span.get("font", "")) for span in spans)
            y0 = min((float(span.get("bbox", [0, 0, 0, 0])[1]) for span in spans), default=0.0)
            rows.append((text, size, font, y0))
    rows.sort(key=lambda item: item[3])
    return rows


def linearize_table_rows(rows: list[list[str | None]]) -> list[str]:
    cleaned = [[normalize_text(str(cell or "")) for cell in row] for row in rows if row]
    cleaned = [[cell for cell in row if cell] for row in cleaned]
    cleaned = [row for row in cleaned if row]
    if not cleaned:
        return []
    result: list[str] = []
    for row in cleaned:
        if len(row) == 1:
            result.append(row[0])
        else:
            result.append(" | ".join(row))
    return result


def extract_tables(page: fitz.Page) -> list[str]:
    lines: list[str] = []
    try:
        tables = page.find_tables().tables
    except (RuntimeError, ValueError):
        return lines
    for table in tables:
        lines.extend(linearize_table_rows(table.extract()))
    return lines


def split_oversized(text: str) -> list[str]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    parts: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if len(paragraph) > MAX_CHARS:
            if current:
                parts.append(current)
                current = ""
            lines = paragraph.splitlines()
            line_current = ""
            for line in lines:
                candidate = f"{line_current}\n{line}".strip()
                if line_current and len(candidate) > MAX_CHARS:
                    parts.append(line_current)
                    line_current = line
                else:
                    line_current = candidate
            if line_current:
                parts.append(line_current)
            continue
        candidate = f"{current}\n\n{paragraph}".strip()
        if current and len(candidate) > MAX_CHARS:
            parts.append(current)
            current = paragraph
        else:
            current = candidate
    if current:
        parts.append(current)
    return parts


def build_sections(document: fitz.Document) -> tuple[list[Section], list[dict]]:
    toc_units = [
        {"title": normalize_text(title), "page": page}
        for level, title, page in document.get_toc(simple=True)
        if level == 1 and normalize_text(title).startswith("UNIT ")
    ]
    toc_by_page = {item["page"]: item["title"] for item in toc_units}
    sections: list[Section] = []
    current_unit = ""
    current: Section | None = None
    uncertain: list[dict] = []

    for page_index, page in enumerate(document, start=1):
        page_unit = toc_by_page.get(page_index)
        if page_unit:
            current_unit = page_unit
        if not current_unit:
            continue

        tables = extract_tables(page)
        for text, size, font, _y0 in page_lines(page):
            if is_unit_heading(text, size):
                current_unit = text
                continue
            if is_grammar_heading(text, size, font):
                if current:
                    current.end_page = page_index
                current = Section(unit=current_unit, heading=text, start_page=page_index)
                sections.append(current)
                continue
            if current and size >= 9:
                current.lines.append(text)

        if tables and current:
            current.table_lines.extend(tables)
        elif tables:
            uncertain.append({"page": page_index, "reason": "table before first grammar heading", "rows": tables[:4]})

    if current:
        current.end_page = len(document)
    return sections, uncertain


def build_chunks(sections: list[Section]) -> list[dict]:
    chunks: list[dict] = []
    source = str(PDF.relative_to(ROOT))
    for section in sections:
        content = "\n".join(section.lines).strip()
        if section.table_lines:
            table_text = "\n".join(f"Table row: {line}" for line in section.table_lines)
            content = f"{content}\n\n{table_text}".strip()
        if not content:
            continue
        for part, chunk_text in enumerate(split_oversized(content)):
            content_hash = digest(source, section.path, chunk_text)
            chunks.append(
                {
                    "id": f"basic-german-{content_hash[:16]}",
                    "section_path": section.path,
                    "part": part,
                    "pages": [section.start_page, section.end_page or section.start_page],
                    "content": chunk_text,
                    "content_hash": content_hash,
                }
            )
    return chunks


def section_tree(sections: list[Section]) -> dict[str, list[str]]:
    tree: dict[str, list[str]] = {}
    for section in sections:
        tree.setdefault(section.unit, [])
        if section.heading not in tree[section.unit]:
            tree[section.unit].append(section.heading)
    return tree


def main() -> None:
    document = fitz.open(PDF)
    sections, uncertain = build_sections(document)
    chunks = build_chunks(sections)
    lengths = [len(chunk["content"]) for chunk in chunks]
    payload = {
        "source": str(PDF.relative_to(ROOT)),
        "source_sha256": hashlib.sha256(PDF.read_bytes()).hexdigest(),
        "page_count": len(document),
        "max_chunk_chars": MAX_CHARS,
        "section_tree": section_tree(sections),
        "uncertain": uncertain,
        "stats": {
            "grammar_points": len(sections),
            "chunks": len(chunks),
            "mean_chars": round(statistics.mean(lengths), 1) if lengths else 0,
            "max_chars": max(lengths) if lengths else 0,
        },
        "chunks": chunks,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload["stats"], indent=2))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
