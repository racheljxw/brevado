"""
Phase 2 Step 5 unit checks for `app/services/feedback.py` — pure prompt-building logic
only (`build_feedback_prompt` / `_format_metrics_grounding`), not the actual Gemini call,
which needs a live API key and isn't exercised here. Same spirit as `test_metrics.py`:
small, hand-written inputs checked against what the built prompt string should contain for
each of the three modes, per docs/CLAUDE.md's "AI processing endpoint" section.

Run from `backend/` with the dev deps installed:
    pip install -r requirements.txt -r requirements-dev.txt
    pytest
"""

from app.services.feedback import _format_metrics_grounding, build_feedback_prompt

SAMPLE_METRICS = {
    "filler_word_rate": 0.08,
    "words_per_minute": 142,
    "repetition_count": 3,
    "word_count": 210,
}


# --- metrics grounding text --------------------------------------------------------


def test_metrics_grounding_includes_filler_rate_and_wpm():
    grounding = _format_metrics_grounding(SAMPLE_METRICS)
    assert "8%" in grounding
    assert "142 words per minute" in grounding
    assert "3 times" in grounding


def test_metrics_grounding_singular_repetition():
    grounding = _format_metrics_grounding({**SAMPLE_METRICS, "repetition_count": 1})
    assert "1 time" in grounding
    assert "1 times" not in grounding


def test_metrics_grounding_zero_repetition_says_no_repeats():
    grounding = _format_metrics_grounding({**SAMPLE_METRICS, "repetition_count": 0})
    assert "did not noticeably repeat" in grounding


def test_metrics_grounding_handles_none_wpm():
    grounding = _format_metrics_grounding({**SAMPLE_METRICS, "words_per_minute": None})
    assert "words per minute" not in grounding
    assert "8%" in grounding  # other fields still included


def test_metrics_grounding_handles_totally_missing_metrics():
    grounding = _format_metrics_grounding(None)
    assert "could not be computed" in grounding
    assert "without referencing specific numbers" in grounding


# --- prompt construction: mode-specific criteria -----------------------------------


def test_prompt_includes_interview_criteria():
    prompt = build_feedback_prompt(
        mode="interview", question="Tell me about a time you led a team.", transcript="I led a team once.",
        metrics=SAMPLE_METRICS,
    )
    assert "directness and structure" in prompt
    assert "Tell me about a time you led a team." in prompt


def test_prompt_includes_story_criteria():
    prompt = build_feedback_prompt(
        mode="story", question="Tell a story about overcoming a challenge.",
        transcript="It was a dark and stormy night.", metrics=SAMPLE_METRICS,
    )
    assert "narrative arc and pacing" in prompt
    assert "Tell a story about overcoming a challenge." in prompt


def test_prompt_includes_miscellaneous_criteria():
    prompt = build_feedback_prompt(
        mode="miscellaneous", question=None, transcript="Just thinking out loud today.",
        metrics=SAMPLE_METRICS,
    )
    assert "general clarity and conciseness" in prompt


# --- prompt construction: question vs. no question ---------------------------------


def test_prompt_handles_null_question_regardless_of_mode():
    # A null question is still possible for interview/story even post-Phase-4 (e.g. a
    # lookup edge case), not just miscellaneous (which always passes question=null) — the
    # prompt must handle this gracefully for every mode.
    prompt = build_feedback_prompt(
        mode="interview", question=None, transcript="Some answer.", metrics=SAMPLE_METRICS,
    )
    assert "no fixed prompt" in prompt
    assert 'responding to this prompt' not in prompt


def test_prompt_includes_question_when_present():
    prompt = build_feedback_prompt(
        mode="interview", question="Why do you want this role?", transcript="Some answer.",
        metrics=SAMPLE_METRICS,
    )
    assert "Why do you want this role?" in prompt
    assert "no fixed prompt" not in prompt


# --- prompt construction: transcript and metrics grounding are present -------------


def test_prompt_includes_transcript_verbatim():
    transcript = "This is exactly what the speaker said, word for word."
    prompt = build_feedback_prompt(mode="miscellaneous", question=None, transcript=transcript, metrics=SAMPLE_METRICS)
    assert transcript in prompt


def test_prompt_includes_metrics_grounding():
    prompt = build_feedback_prompt(
        mode="miscellaneous", question=None, transcript="Some text.", metrics=SAMPLE_METRICS,
    )
    assert "8%" in prompt
    assert "142 words per minute" in prompt


def test_prompt_handles_missing_metrics_gracefully():
    prompt = build_feedback_prompt(mode="miscellaneous", question=None, transcript="Some text.", metrics=None)
    assert "could not be computed" in prompt


def test_prompt_requests_prose_not_structured_output():
    prompt = build_feedback_prompt(mode="miscellaneous", question=None, transcript="Some text.", metrics=SAMPLE_METRICS)
    assert "numeric scores" in prompt
