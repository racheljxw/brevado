"""
Phase 2 Step 6 unit checks for `app/services/processing.py`'s retry policy —
`_run_with_one_retry` specifically, which is pure orchestration logic with no
Supabase/Gemini calls of its own, so it's easy to unit-test in isolation the
same way `metrics.py`/`feedback.py` are (see docs/CLAUDE.md's "Background
processing" section). Full end-to-end pipeline behavior (Supabase reads/
writes, live Gemini calls) is exercised manually per the Step 6 test plan,
not here.

Each test hands `_run_with_one_retry` a small fake callable that fails a
controlled number of times before succeeding (or never succeeds), rather than
pointing GEMINI_MODEL at a bogus name and racing a live API call — deterministic
and repeatable, and exercises exactly the retry-count logic Step 6 cares about
without needing network access or a real API key.

Run from `backend/` with the dev deps installed:
    pip install -r requirements.txt -r requirements-dev.txt
    pytest
"""

import pytest

from app.services.feedback import FeedbackGenerationError
from app.services.processing import TranscriptionError, _run_with_one_retry


class _FlakyCall:
    """A callable that raises `error` for its first `fail_times` calls, then
    returns `"ok"`. Tracks how many times it was actually invoked so tests can
    assert `_run_with_one_retry` called it exactly as many times as expected —
    not zero (no retry attempted) and not more than twice (looping forever)."""

    def __init__(self, fail_times: int, error: Exception):
        self.fail_times = fail_times
        self.error = error
        self.calls = 0

    def __call__(self) -> str:
        self.calls += 1
        if self.calls <= self.fail_times:
            raise self.error
        return "ok"


def test_succeeds_on_first_attempt_no_retry():
    fn = _FlakyCall(fail_times=0, error=TranscriptionError("boom"))
    result = _run_with_one_retry("transcription", "rec-1", fn)
    assert result == "ok"
    assert fn.calls == 1  # never retried — first attempt already succeeded


def test_recovers_on_retry_after_one_transcription_failure():
    fn = _FlakyCall(fail_times=1, error=TranscriptionError("transient"))
    result = _run_with_one_retry("transcription", "rec-2", fn)
    assert result == "ok"
    assert fn.calls == 2  # first attempt failed, retry succeeded


def test_recovers_on_retry_after_one_feedback_failure():
    fn = _FlakyCall(fail_times=1, error=FeedbackGenerationError("transient"))
    result = _run_with_one_retry("feedback generation", "rec-3", fn)
    assert result == "ok"
    assert fn.calls == 2


def test_gives_up_after_retry_also_fails():
    error = TranscriptionError("persistent")
    fn = _FlakyCall(fail_times=99, error=error)  # never succeeds
    with pytest.raises(TranscriptionError):
        _run_with_one_retry("transcription", "rec-4", fn)
    assert fn.calls == 2  # exactly one retry attempted — not zero, not a loop


def test_unrelated_exception_is_not_retried():
    """`_run_with_one_retry` only catches TranscriptionError/FeedbackGenerationError —
    an unrelated error (e.g. a bug, or an infra error the caller didn't wrap) should
    propagate immediately, not be silently retried."""

    def fn():
        raise ValueError("not a retryable pipeline error")

    with pytest.raises(ValueError):
        _run_with_one_retry("transcription", "rec-5", fn)
