"""
Unit checks for `app/services/metrics.py` — the deterministic
filler-word/WPM/repetition logic. Deliberately small (hand-written
transcripts): this is pure code that's easy to get subtly wrong (off-by-one
word counts, double-counted repeats) and hard to verify by eyeballing a real
recording's output.

Run from `backend/` with the dev deps installed:
    pip install -r requirements.txt -r requirements-dev.txt
    pytest
"""

import io
import wave

from app.services.metrics import (
    compute_filler_word_rate,
    compute_metrics,
    compute_repetition_count,
    compute_word_count,
    compute_words_per_minute,
    get_audio_duration_seconds,
)


def _make_wav_bytes(duration_seconds: float, sample_rate: int = 8000) -> bytes:
    """Builds a minimal silent WAV file of an exact known duration, using only the
    stdlib `wave` module — no audio fixture files or extra dependencies needed to
    exercise `get_audio_duration_seconds` against a real, parseable audio file."""
    buffer = io.BytesIO()
    frame_count = int(duration_seconds * sample_rate)
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * frame_count)
    return buffer.getvalue()


# --- word count -------------------------------------------------------------


def test_word_count_basic():
    assert compute_word_count("This is five words total") == 5


def test_word_count_ignores_punctuation():
    assert compute_word_count("Well, I think- that's it.") == 5  # Well, I, think, that's, it


def test_word_count_empty_string():
    assert compute_word_count("") == 0


# --- filler word rate ---------------------------------------------------------


def test_filler_word_rate_sample_transcript():
    transcript = "So, um, I think the the main point is clear"
    word_count = compute_word_count(transcript)  # So, um, I, think, the, the, main, point, is, clear = 10
    assert word_count == 10
    rate = compute_filler_word_rate(transcript, word_count)
    # "um" is the only filler-list hit here ("so" and "think" aren't on the list) -> 1/10
    assert rate == 0.1


def test_filler_word_rate_multi_word_phrase_counts_once():
    transcript = "You know, I kind of think it was fine you know"
    word_count = compute_word_count(transcript)
    assert word_count == 11  # You, know, I, kind, of, think, it, was, fine, you, know
    rate = compute_filler_word_rate(transcript, word_count)
    # "you know" (x2) + "kind of" (x1) = 3 filler occurrences out of 11 words
    assert rate == round(3 / 11, 4)


def test_filler_word_rate_no_fillers():
    assert compute_filler_word_rate("The quarterly results exceeded expectations") == 0.0


def test_filler_word_rate_empty_transcript_does_not_divide_by_zero():
    assert compute_filler_word_rate("") == 0.0


# --- repetition count ---------------------------------------------------------


def test_repetition_count_immediate_word_repeat():
    assert compute_repetition_count("I think the the main point is clear") == 1


def test_repetition_count_immediate_phrase_repeat():
    assert compute_repetition_count("I think I think that's the plan") == 1


def test_repetition_count_no_repeats():
    assert compute_repetition_count("This sentence has no repeated words at all") == 0


def test_repetition_count_multiple_separate_repeats():
    transcript = "the the plan is is good"
    # "the the" (1-word repeat) then, after skipping past it, "is is" (1-word repeat)
    assert compute_repetition_count(transcript) == 2


def test_repetition_count_does_not_double_count_overlapping_matches():
    # A naive scanner might count "point point" as both a 1-word repeat at the "point"
    # boundary and part of a longer phrase repeat; longest-first matching + jumping the
    # scan past a match should yield exactly one hit here, not two or three.
    transcript = "the main point point is clear"
    assert compute_repetition_count(transcript) == 1


# --- audio duration / words per minute -----------------------------------------


def test_get_audio_duration_seconds_from_generated_wav():
    audio_bytes = _make_wav_bytes(duration_seconds=30.0)
    duration = get_audio_duration_seconds(audio_bytes, "audio/wav")
    assert duration is not None
    assert abs(duration - 30.0) < 0.05


def test_get_audio_duration_seconds_returns_none_for_garbage():
    assert get_audio_duration_seconds(b"not a real audio file", "audio/wav") is None


def test_compute_words_per_minute_known_rate():
    # 100 words over 30 seconds (0.5 minutes) = 200 wpm.
    audio_bytes = _make_wav_bytes(duration_seconds=30.0)
    wpm = compute_words_per_minute(word_count=100, audio_bytes=audio_bytes, mime_type="audio/wav")
    assert wpm == 200


def test_compute_words_per_minute_none_without_audio():
    assert compute_words_per_minute(word_count=100, audio_bytes=None, mime_type=None) is None


def test_compute_words_per_minute_none_on_unparseable_audio():
    assert compute_words_per_minute(word_count=100, audio_bytes=b"garbage", mime_type="audio/wav") is None


# --- end-to-end shape -----------------------------------------------------------


def test_compute_metrics_shape_and_values():
    transcript = "So, um, I think the the main point is clear"
    audio_bytes = _make_wav_bytes(duration_seconds=6.0)  # 10 words / 0.1 min = 100 wpm
    metrics = compute_metrics(transcript, audio_bytes, "audio/wav")
    assert set(metrics.keys()) == {"filler_word_rate", "words_per_minute", "repetition_count", "word_count"}
    assert metrics["word_count"] == 10
    assert metrics["filler_word_rate"] == 0.1
    assert metrics["repetition_count"] == 1
    assert metrics["words_per_minute"] == 100


def test_compute_metrics_survives_missing_audio():
    # No audio bytes -> words_per_minute is None, but filler/repetition/word_count are
    # unaffected. This partial result is preferred over failing the recording outright.
    metrics = compute_metrics("um, I think the the plan works", None, None)
    assert metrics["words_per_minute"] is None
    assert metrics["word_count"] == 7
    assert metrics["repetition_count"] == 1
