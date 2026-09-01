"""
Unit checks for `app/services/feedback.py` — the pure prompt-building and
response-coercion logic, not the live Gemini call. Small hand-written inputs
checked against what the built prompt should contain for each mode.

Run from `backend/` with the dev deps installed:
    pip install -r requirements.txt -r requirements-dev.txt
    pytest
"""

from app.services.feedback import (
    _FEEDBACK_RESPONSE_SCHEMA,
    _coerce_issue_count,
    _coerce_score,
    _coerce_string_list,
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


def test_metrics_grounding_includes_filler_rate_and_repetition():
    grounding = _format_metrics_grounding(SAMPLE_METRICS)
    assert "8%" in grounding
    assert "3 times" in grounding


def test_metrics_grounding_omits_words_per_minute():
    # Speaking rate must not reach the written feedback, so the model never sees it.
    grounding = _format_metrics_grounding(SAMPLE_METRICS)
    assert "words per minute" not in grounding
    assert "142" not in grounding


def test_metrics_grounding_singular_repetition():
    grounding = _format_metrics_grounding({**SAMPLE_METRICS, "repetition_count": 1})
    assert "1 time" in grounding
    assert "1 times" not in grounding


def test_metrics_grounding_zero_repetition_says_no_repeats():
    grounding = _format_metrics_grounding({**SAMPLE_METRICS, "repetition_count": 0})
    assert "did not noticeably repeat" in grounding


def test_metrics_grounding_handles_none_filler_rate():
    grounding = _format_metrics_grounding({**SAMPLE_METRICS, "filler_word_rate": None})
    assert "8%" not in grounding
    assert "3 times" in grounding  # other fields still included


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
    # A null question is possible for interview/story too (a lookup edge case), not just
    # miscellaneous — the prompt must handle it gracefully for every mode.
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
    # The grounding sentence never carries the WPM figure (only the "don't mention rate"
    # instruction refers to words-per-minute at all).
    assert "142" not in prompt


def test_prompt_handles_missing_metrics_gracefully():
    prompt = build_feedback_prompt(mode="miscellaneous", question=None, transcript="Some text.", metrics=None)
    assert "could not be computed" in prompt


def test_prompt_requests_prose_feedback_no_numeric_scores():
    prompt = build_feedback_prompt(mode="miscellaneous", question=None, transcript="Some text.", metrics=SAMPLE_METRICS)
    assert "numeric scores" in prompt


# --- prompt construction: title --------------------------------------------------


def test_prompt_asks_for_a_json_object_with_feedback_fields_and_title():
    prompt = build_feedback_prompt(
        mode="interview", question="Why this role?", transcript="Some answer.", metrics=SAMPLE_METRICS,
    )
    assert "JSON object" in prompt
    assert '"feedback_summary"' in prompt
    assert '"feedback_strengths"' in prompt
    assert '"feedback_improvements"' in prompt
    assert '"title"' in prompt
    assert "2-4 word label" in prompt


def test_prompt_feedback_grounded_in_scores_without_restating_them():
    prompt = build_feedback_prompt(
        mode="interview", question="Why this role?", transcript="Some answer.", metrics=SAMPLE_METRICS,
    )
    assert "do not restate the numeric scores" in prompt
    assert "impact, clarity, and structure assessment" in prompt


def test_prompt_forbids_speaking_rate_commentary_in_feedback():
    prompt = build_feedback_prompt(
        mode="story", question="Tell a story.", transcript="Once upon a time.", metrics=SAMPLE_METRICS,
    )
    assert "Do not comment on the speaker's speaking rate or words per minute" in prompt


def test_prompt_includes_per_metric_calibration_bands():
    prompt = build_feedback_prompt(
        mode="miscellaneous", question=None, transcript="t", metrics=SAMPLE_METRICS,
    )
    assert "Calibration for impact_score:" in prompt
    assert "Calibration for clarity_score:" in prompt
    assert "Calibration for structure_score:" in prompt
    # Each band block is genuinely different guidance, not the same text relabelled.
    assert "distinct takeaway" in prompt  # impact 50
    assert "force re-reading" in prompt  # clarity 50
    assert "track the throughline" in prompt  # structure 50


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
        "feedback_summary",
        "feedback_strengths",
        "feedback_improvements",
        "title",
        "impact_score",
        "clarity_score",
        "structure_score",
        "grammar_issue_count",
    }
    props = _FEEDBACK_RESPONSE_SCHEMA.properties
    assert set(props) == expected
    assert set(_FEEDBACK_RESPONSE_SCHEMA.required) == expected


# --- prompt construction: scores ------------------------------------------------


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


# --- strengths / improvements list coercion (lenient parsing) --------------------


def test_coerce_string_list_keeps_non_empty_strings_and_strips():
    assert _coerce_string_list(["  Clear opening  ", "Concrete example"], "feedback_strengths") == [
        "Clear opening",
        "Concrete example",
    ]


def test_coerce_string_list_drops_non_string_and_blank_entries():
    assert _coerce_string_list(["Real point", "", 7, None, "  "], "feedback_strengths") == ["Real point"]


def test_coerce_string_list_rejects_non_list_and_empty():
    assert _coerce_string_list(None, "feedback_strengths") is None
    assert _coerce_string_list("just a string", "feedback_strengths") is None
    assert _coerce_string_list([], "feedback_improvements") is None
    assert _coerce_string_list(["", "   "], "feedback_improvements") is None
