import re
import unicodedata
from typing import Any

# Only complete wrapped labels are eligible; ordinary sentence text stays intact.
_WRAPPED_CUE = re.compile(
    r"\[[^\[\]\n]*\]|\([^()\n]*\)|"
    r"(?<!\*)(?P<stars>\*{1,3})(?P<cue>[^*\n]+)(?P=stars)(?!\*)"
)
_SOUND_CUE = re.compile(
    r"(?:(?:leise|laute|sanfte|ruhige|fröhliche|traurige|spannende|dramatische|"
    r"instrumentale|soft|quiet|loud|background)\s+)*"
    r"(?:musik|music|applaus|applause|lachen|lacht|laughter|laughing|"
    r"gelächter|beifall|jubel|cheering|stille|silence|geräusch(?:e)?|"
    r"sound|noise|husten|coughing|seufzen|sighing)"
    r"(?:\s+(?:spielt|plays|im hintergrund))?",
    re.IGNORECASE,
)


def normalize_dictation_text(text: str) -> str:
    """Remove non-speech sound cues and normalize Unicode and whitespace."""
    text = unicodedata.normalize("NFC", text)
    text = _WRAPPED_CUE.sub(
        lambda match: " " if _SOUND_CUE.fullmatch(
            (match.group("cue") or match.group()[1:-1]).strip()
        ) else match.group(),
        text,
    )
    text = " ".join(text.split())
    return re.sub(r"\s+([,.!?;:…])", r"\1", text)


def normalize_dictation_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Clean saved segments without changing their timing or other metadata."""
    result = []
    for segment in segments:
        text = normalize_dictation_text(segment["text"])
        if text:
            result.append({**segment, "text": text})
    return result
