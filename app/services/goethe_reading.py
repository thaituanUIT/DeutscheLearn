from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

GoetheLevel = Literal["A1", "A2", "B1", "B2"]
GoethePart = Literal["teil_1", "teil_2", "teil_3", "teil_4", "teil_5"]


@dataclass(frozen=True)
class GoetheReadingPartSpec:
    shape: str
    label: str
    description: str
    default_options: tuple[str, ...]


GOETHE_READING_SPECS: dict[GoetheLevel, dict[GoethePart, GoetheReadingPartSpec]] = {
    "A1": {
        "teil_1": GoetheReadingPartSpec(
            shape="true_false_text",
            label="Teil 1 · Short text · Richtig/Falsch",
            description="Read a short personal text and mark each statement as Richtig or Falsch.",
            default_options=("Richtig", "Falsch"),
        ),
        "teil_2": GoetheReadingPartSpec(
            shape="source_choice",
            label="Teil 2 · Two adverts · a/b",
            description="Read a situation and choose which of two adverts fits.",
            default_options=("a", "b"),
        ),
        "teil_3": GoetheReadingPartSpec(
            shape="true_false_notice",
            label="Teil 3 · Sign or notice · Richtig/Falsch",
            description="Read a sign, notice, or short announcement and mark Richtig or Falsch.",
            default_options=("Richtig", "Falsch"),
        ),
    },
    "A2": {
        "teil_1": GoetheReadingPartSpec(
            shape="abc_choice",
            label="Teil 1 · Newspaper article · a/b/c",
            description="Read one article and choose a, b, or c for tasks 1-5.",
            default_options=("a", "b", "c"),
        ),
        "teil_2": GoetheReadingPartSpec(
            shape="abc_choice",
            label="Teil 2 · Information board · a/b/c",
            description="Use an information board/table and choose a, b, or c for tasks 6-10.",
            default_options=("a", "b", "c"),
        ),
        "teil_3": GoetheReadingPartSpec(
            shape="abc_choice",
            label="Teil 3 · E-mail · a/b/c",
            description="Read one e-mail and choose a, b, or c for tasks 11-15.",
            default_options=("a", "b", "c"),
        ),
        "teil_4": GoetheReadingPartSpec(
            shape="matching",
            label="Teil 4 · Ad matching · a-f/x",
            description="Match situations to adverts a-f; one task has no solution and uses X.",
            default_options=("a", "b", "c", "d", "e", "f", "X"),
        ),
    },
    "B1": {
        "teil_1": GoetheReadingPartSpec(
            shape="true_false_text",
            label="Teil 1 · Text · Richtig/Falsch",
            description="Read one text and mark each statement as Richtig or Falsch.",
            default_options=("Richtig", "Falsch"),
        ),
        "teil_2": GoetheReadingPartSpec(
            shape="abc_choice",
            label="Teil 2 · Article · a/b/c",
            description="Read one article and choose a, b, or c.",
            default_options=("a", "b", "c"),
        ),
        "teil_3": GoetheReadingPartSpec(
            shape="matching",
            label="Teil 3 · Advertisement matching · a-j/x",
            description="Match situations to adverts a-j; use X when none fits.",
            default_options=("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "X"),
        ),
        "teil_4": GoetheReadingPartSpec(
            shape="yes_no",
            label="Teil 4 · Opinion texts · Ja/Nein",
            description="Read opinions and choose whether each person supports the statement.",
            default_options=("Ja", "Nein"),
        ),
        "teil_5": GoetheReadingPartSpec(
            shape="abc_choice",
            label="Teil 5 · Rules text · a/b/c",
            description="Read rules or regulations and choose a, b, or c.",
            default_options=("a", "b", "c"),
        ),
    },
    "B2": {
        "teil_1": GoetheReadingPartSpec(
            shape="matching",
            label="Teil 1 · Four people · a-d",
            description="Match statements to people a-d; people can be selected more than once.",
            default_options=("a", "b", "c", "d"),
        ),
        "teil_2": GoetheReadingPartSpec(
            shape="gap_match",
            label="Teil 2 · Gap sentences · a-h",
            description="Choose which sentence a-h fits each gap; two sentences do not fit.",
            default_options=("a", "b", "c", "d", "e", "f", "g", "h"),
        ),
        "teil_3": GoetheReadingPartSpec(
            shape="abc_choice",
            label="Teil 3 · Article · a/b/c",
            description="Read one article and choose a, b, or c.",
            default_options=("a", "b", "c"),
        ),
        "teil_4": GoetheReadingPartSpec(
            shape="matching",
            label="Teil 4 · Headline matching · a-h",
            description="Match opinion texts to headings a-h; one option does not fit.",
            default_options=("a", "b", "c", "d", "e", "f", "g", "h"),
        ),
        "teil_5": GoetheReadingPartSpec(
            shape="matching",
            label="Teil 5 · Regulation headings · a-h",
            description="Match paragraphs from rules or regulations to headings a-h.",
            default_options=("a", "b", "c", "d", "e", "f", "g", "h"),
        ),
    },
}

GOETHE_PARTS_BY_LEVEL = {
    level: tuple(parts.keys())
    for level, parts in GOETHE_READING_SPECS.items()
}


def get_goethe_part_spec(level: str, part: str | None) -> GoetheReadingPartSpec | None:
    if level not in GOETHE_READING_SPECS or part is None:
        return None
    return GOETHE_READING_SPECS[level].get(part)  # type: ignore[index]


def goethe_part_label(level: str, part: str) -> str:
    spec = get_goethe_part_spec(level, part)
    return spec.label if spec else part.replace("_", " ").title()


def uses_source_choice(group: str, level: str, part: str | None) -> bool:
    spec = get_goethe_part_spec(level, part)
    return group == "goethe" and spec is not None and spec.shape == "source_choice"


def uses_notice(group: str, level: str, part: str | None) -> bool:
    spec = get_goethe_part_spec(level, part)
    return group == "goethe" and spec is not None and spec.shape == "true_false_notice"


def exercise_type_for(group: str, level: str, part: str | None, kind: str = "text") -> str | None:
    if group != "goethe":
        return None
    if uses_source_choice(group, level, part):
        return "source_choice"
    if uses_notice(group, level, part) or (level == "A1" and kind == "sign"):
        return "true_false_notice"
    return "standard"


def stimulus_kind_for(group: str, level: str, part: str | None) -> str:
    return "sign" if uses_notice(group, level, part) else "text"
