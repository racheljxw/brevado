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

from app.services.feedback import (
    _FEEDBACK_RESPONSE_SCHEMA,
    _coerce_issue_count,
    _coerce_score,
    _format_metrics_grounding,
    build_feedback_prompt,
)

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


def test_prompt_requests_prose_feedback_no_numeric_scores():
    prompt = build_feedback_prompt(mode="miscellaneous", question=None, transcript="Some text.", metrics=SAMPLE_METRICS)
    assert "numeric scores" in prompt


# --- prompt construction: title (v2 Epic D Part 1) --------------------------------


def test_prompt_asks_for_a_json_object_with_feedback_and_title():
    prompt = build_feedback_prompt(
        mode="interview", question="Why this role?", transcript="Some answer.", metrics=SAMPLE_METRICS,
    )
    assert "JSON object" in prompt
    assert '"feedback"' in prompt
    assert '"title"' in prompt
    assert "2-4 word label" in prompt


def test_title_guidance_uses_question_context_when_a_question_is_present():
    prompt = build_feedback_prompt(
        mode="interview", question="Tell me about a conflict with a coworker.",
        transcript="My coworker and I disagreed.", metrics=SAMPLE_METRICS,
    )
    assert "draw on the prompt" in prompt
    assert "no prompt for this recording" not in prompt


def test_title_guidance_falls_back_to_transcript_when_no_question():
    prompt = build_feedback_prompt(
        mode="miscellaneous", question=None, transcript="Today I want to talk about my trip.",
        metrics=SAMPLE_METRICS,
    )
    assert "no prompt for this recording" in prompt
    assert "derive the title entirely from what" in prompt


def test_feedback_response_schema_requires_all_keys():
    expected = {
        "feedback",
        "title",
        "impact_score",
        "clarity_score",
        "structure_score",
        "grammar_issue_count",
    }
    props = _FEEDBACK_RESPONSE_SCHEMA.properties
    assert set(props) == expected
    assert set(_FEEDBACK_RESPONSE_SCHEMA.required) == expected


# --- prompt construction: v3 scores (Epic F Step 1) -------------------------------


def test_prompt_asks_for_the_three_scores_and_grammar_count():
    prompt = build_feedback_prompt(
        mode="interview", question="Why this role?", transcript="Some answer.", metrics=SAMPLE_METRICS,
    )
    assert '"impact_score"' in prompt
    assert '"clarity_score"' in prompt
    assert '"structure_score"' in prompt
    assert '"grammar_issue_count"' in prompt
    assert "0-100" in prompt


def test_impact_guidance_is_mode_specific():
    interview = build_feedback_prompt(
        mode="interview", question="Q?", transcript="t", metrics=SAMPLE_METRICS,
    )
    story = build_feedback_prompt(
        mode="story", question="Q?", transcript="t", metrics=SAMPLE_METRICS,
    )
    misc = build_feedback_prompt(
        mode="miscellaneous", question=None, transcript="t", metrics=SAMPLE_METRICS,
    )
    # Each mode's impact guidance leads with a genuinely different judgment.
    assert "landed as a response to the question" in interview
    assert "cohesive and engaging the story" in story
    assert "substance and coherence of the take" in misc
    assert "landed as a response to the question" not in story


def test_clarity_guidance_is_holistic_not_an_average():
    prompt = build_feedback_prompt(
        mode="miscellaneous", question=None, transcript="t", metrics=SAMPLE_METRICS,
    )
    assert "one holistic judgment" in prompt
    assert "NOT a mechanical average" in prompt
    assert "assess" in prompt and "grammar" in prompt


def test_structure_guidance_is_mode_specific():
    interview = build_feedback_prompt(mode="interview", question="Q?", transcript="t", metrics=None)
    story = build_feedback_prompt(mode="story", question="Q?", transcript="t", metrics=None)
    assert "point stated up front" in interview
    assert "beginning, middle, and end" in story


# --- score coercion (lenient parsing) --------------------------------------------


def test_coerce_score_accepts_in_range_integers():
    assert _coerce_score(0, "impact_score") == 0
    assert _coerce_score(100, "impact_score") == 100
    assert _coerce_score(73, "impact_score") == 73
    assert _coerce_score(88.0, "impact_score") == 88  # a float whole number is fine


def test_coerce_score_rejects_out_of_range_and_garbage():
    assert _coerce_score(101, "impact_score") is None
    assert _coerce_score(-1, "impact_score") is None
    assert _coerce_score("high", "impact_score") is None
    assert _coerce_score(None, "impact_score") is None


def test_coerce_issue_count_accepts_non_negative_integers():
    assert _coerce_issue_count(0) == 0
    assert _coerce_issue_count(5) == 5


def test_coerce_issue_count_rejects_negative_and_garbage():
    assert _coerce_issue_count(-2) is None
    assert _coerce_issue_count("lots") is None
    assert _coerce_issue_count(None) is None
