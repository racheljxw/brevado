"""
Deterministic metrics computed from a transcript (and, for words-per-minute,
the source audio) — no Gemini calls in this module. They're computed in code
and fed into the feedback prompt as grounding rather than left to the LLM to
eyeball, so they need to be right on their own.

Pure text/audio-metadata logic with no network calls, unit-tested in
isolation (see `test_metrics.py`).

Output shape (stored as-is into `recordings.metrics` jsonb):
    {
        "filler_word_rate": 0.08,      # float 0.0-1.0, NOT a percentage — see compute_filler_word_rate
        "words_per_minute": 142,       # int, or None if audio duration couldn't be determined
        "repetition_count": 3,         # int, count of immediate word/phrase repeats — see compute_repetition_count
        "word_count": 210,             # int, kept because the other two fields derive from it and callers want it directly
    }
"""

import io
import logging
import re

from mutagen import File as MutagenFile

logger = logging.getLogger(__name__)

# Starter filler word/phrase list — deliberately simple (plain word-boundary matching,
# no POS tagging or context awareness). "like" in particular will also match legitimate
# non-filler uses ("I like pizza") — a known limitation of a starter list, not a bug.
# Tune this list based on what real transcripts show.
FILLER_WORDS = [
    "um",
    "umm",
    "uh",
    "uhh",
    "er",
    "ah",
    "like",
    "you know",
    "sort of",
    "kind of",
    "i mean",
    "basically",
    "actually",
    "literally",
]

# Sort longest-first so a multi-word phrase is matched before any single-word substring
# of it. No current filler word is a substring of another, but this keeps that safe if
# the list grows.
_FILLER_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in sorted(FILLER_WORDS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)

_WORD_PATTERN = re.compile(r"[A-Za-z']+")

# mutagen identifies format from file content, not extension, so this only needs to
# cover the formats we actually pass it (mirrors `_GEMINI_MIME_TYPES` in processing.py).
_MUTAGEN_EXTENSION_HINT = {
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
    "audio/mp3": ".mp3",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
    "audio/aiff": ".aiff",
}


def _tokenize(transcript: str) -> list[str]:
    return _WORD_PATTERN.findall(transcript)


def compute_word_count(transcript: str) -> int:
    return len(_tokenize(transcript))


def compute_filler_word_rate(transcript: str, word_count: int | None = None) -> float:
    """Fraction (0.0-1.0) of total words that were filler words/phrases.

    Rate, not a percentage — 0.08 means 8%, not 0.08%. Numerator is the count of filler
    *occurrences* found via `_FILLER_PATTERN` (a multi-word phrase like "you know" counts
    as one occurrence); denominator is total word count. Returns 0.0 for an empty
    transcript rather than dividing by zero.
    """
    if word_count is None:
        word_count = compute_word_count(transcript)
    if word_count == 0:
        return 0.0
    filler_count = len(_FILLER_PATTERN.findall(transcript))
    return round(filler_count / word_count, 4)


def compute_repetition_count(transcript: str) -> int:
    """Counts immediate word/short-phrase repeats — e.g. "the the" or "I think I think".

    Deliberately simple, not a general repetition/disfluency detector: scans the token
    list left to right, and at each position checks whether the next 3, 2, or 1 word(s)
    are immediately repeated right after themselves (checked longest-first so "the main
    point the main point" counts once, not additionally as a 1-word or 2-word repeat
    inside it). On a match, the count increments once and the scan jumps past both
    copies, so overlapping repeats aren't double-counted. Case-insensitive, punctuation
    stripped before comparison.
    """
    words = [w.lower() for w in _tokenize(transcript)]
    count = 0
    i = 0
    n = len(words)
    while i < n:
        matched = False
        for phrase_len in (3, 2, 1):
            end = i + 2 * phrase_len
            if end <= n and words[i : i + phrase_len] == words[i + phrase_len : end]:
                count += 1
                i = end
                matched = True
                break
        if not matched:
            i += 1
    return count


def get_audio_duration_seconds(audio_bytes: bytes, mime_type: str) -> float | None:
    """Reads audio duration straight from the file's own header via `mutagen`.

    The Gemini transcription response carries no duration or timing metadata, and asking
    for timestamps would mean a second call for one number that still wouldn't be exact.
    The file header is exact, free, and needs no network call — and the bytes are the
    ones already downloaded for transcription, not re-fetched.

    `mutagen.File` sniffs format from content but is more reliable with an extension
    hint for ambiguous containers like m4a/mp4; `_MUTAGEN_EXTENSION_HINT` supplies one.

    Returns None (never raises) if duration can't be determined, so a metrics issue
    never fails the whole recording.
    """
    extension_hint = _MUTAGEN_EXTENSION_HINT.get(mime_type, "")
    try:
        audio_file = MutagenFile(io.BytesIO(audio_bytes), filename=f"audio{extension_hint}")
    except Exception as exc:
        logger.warning("metrics: mutagen failed to parse audio for duration (%s): %s", mime_type, exc)
        return None

    if audio_file is None or audio_file.info is None or not hasattr(audio_file.info, "length"):
        logger.warning("metrics: mutagen could not determine duration for audio (%s)", mime_type)
        return None

    duration = float(audio_file.info.length)
    if duration <= 0:
        logger.warning("metrics: mutagen reported non-positive duration (%s) for audio (%s)", duration, mime_type)
        return None

    return duration


def compute_words_per_minute(word_count: int, audio_bytes: bytes | None, mime_type: str | None) -> int | None:
    """Returns None (not a fabricated number) if duration can't be determined."""
    if not audio_bytes or not mime_type:
        return None
    duration_seconds = get_audio_duration_seconds(audio_bytes, mime_type)
    if not duration_seconds:
        return None
    return round(word_count / (duration_seconds / 60))


def compute_metrics(transcript: str, audio_bytes: bytes | None, mime_type: str | None) -> dict:
    """Computes the full metrics object stored into `recordings.metrics`.

    Filler-word rate, repetition count, and word count only need the transcript text and
    always succeed for any string input (including "", which yields all-zero metrics).
    Words-per-minute is the only field that depends on audio duration and can come back
    None — isolated in `compute_words_per_minute` so a duration failure only nulls that
    one field rather than the whole metrics object.
    """
    word_count = compute_word_count(transcript)
    return {
        "filler_word_rate": compute_filler_word_rate(transcript, word_count),
        "words_per_minute": compute_words_per_minute(word_count, audio_bytes, mime_type),
        "repetition_count": compute_repetition_count(transcript),
        "word_count": word_count,
    }
