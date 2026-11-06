import re
import unicodedata
from typing import Any

# Match known sound cues, rather than removing arbitrary bracketed speech.
_BRACKETED = re.compile(r"\[[^\[\]\n]*\]|\([^()\n]*\)")
_SOUND_CUE = re.compile(
    r"\b(?:musik|music|applaus|applause|lachen|lacht|laughter|laughing|"
    r"gelächter|beifall|jubel|cheering|stille|silence|geräusch(?:e)?|"
    r"sound|noise|husten|coughing|seufzen|sighing)\b",
    re.IGNORECASE,
)


def normalize_dictation_text(text: str) -> str:
    """Remove non-speech sound cues and normalize Unicode and whitespace."""
    text = unicodedata.normalize("NFC", text)
    text = _BRACKETED.sub(
        lambda match: " " if _SOUND_CUE.search(match.group()) else match.group(), text
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
