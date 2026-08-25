"""
Phase 2 Step 5: mode-aware Gemini feedback generation — the last previously-stubbed
piece of the processing pipeline. Given an already-real transcript and already-computed
deterministic metrics (see `app/services/metrics.py`), this module builds a mode-specific
prompt and asks Gemini for free-text coaching feedback (structured/criteria-based scoring
is explicitly Phase 5, not this step — see docs/CLAUDE.md's "Metrics" section and
docs/PROJECT_PLAN.md Section 3).

Kept as its own module rather than folded into `processing.py`, mirroring the choice
already made for `metrics.py`: `build_feedback_prompt` is pure string-building logic with
no Supabase/Gemini/network calls of its own, so it's easy to unit-test in isolation (see
`test_feedback.py`) independent of the actual Gemini call, which needs a live API key and
isn't exercised in tests.

Reuses the same Gemini client and model config as transcription
(`app/gemini_client.py`, `settings.gemini_model`) — no reason for a second model here:
this is a single text-in/text-out call, well within what Flash handles, and keeping one
model id for the whole pipeline means Step 3's "model got renamed, bump one config value"
story (see docs/CLAUDE.md's "AI processing endpoint" section) covers this call too, rather
than needing to track two model ids independently.
"""

import logging

from google.genai.errors import APIError

from app.config import settings
from app.gemini_client import get_gemini_client

logger = logging.getLogger(__name__)

# Mode-specific evaluation criteria, per docs/PROJECT_PLAN.md Section 3: interview answers
# are judged on directness/structure, stories on narrative arc/pacing, miscellaneous on
# general clarity/conciseness. Recordings are always mode='miscellaneous' with question=null
# today (Phase 4 hasn't built real mode selection yet — see docs/CLAUDE.md's "Current
# phase"), but all three branches are built now so Phase 4 doesn't need this rebuilt.
MODE_CRITERIA: dict[str, str] = {
    "interview": (
        "This is an interview-practice answer. Evaluate it primarily on directness and "
        "structure: did the speaker answer the question directly (rather than talking "
        "around it), and was the response organized clearly — e.g. a clear point stated "
        "up front, logical supporting structure, a concise close — rather than rambling?"
    ),
    "story": (
        "This is a story told for practice. Evaluate it primarily on narrative arc and "
        "pacing: does it have a clear beginning, middle, and end; does tension or "
        "interest build and resolve; and is it paced well (not rushing the payoff or "
        "dragging out the setup)?"
    ),
    "miscellaneous": (
        "This is a free-topic practice recording with no fixed question. Evaluate it "
        "primarily on general clarity and conciseness: is the main point clear, is the "
        "response well organized, and is it free of unnecessary padding or tangents?"
    ),
}


class FeedbackGenerationError(Exception):
    """Raised when generating feedback for a recording fails or yields nothing usable.

    Mirrors `TranscriptionError` in `app/services/processing.py`: covers the Gemini call
    itself erroring and a technically-successful response with no usable feedback text.
    Caught specifically in `process_recording` so a bad feedback response can never fall
    through to a `done` status with empty/placeholder feedback attached — and, unlike a
    transcription failure, it must never discard the transcript/metrics that already
    succeeded and were already written to the row before this step ran.
    """


def _format_metrics_grounding(metrics: dict | None) -> str:
    """Turns the `compute_metrics` output into a natural-language grounding sentence.

    Per docs/PROJECT_PLAN.md Section 3, deterministic metrics are fed into the feedback
    prompt as grounding text rather than left for Gemini to recount from the transcript
    itself — e.g. "spoke at approximately 142 words per minute", not "count how fast they
    talked". Handles `metrics` being entirely `None` (a total metrics-computation failure,
    see `processing.py`) and `words_per_minute` being `None` on its own (duration couldn't
    be determined, see `metrics.py`) by simply omitting what isn't known, never fabricating
    a number.
    """
    if not metrics:
        return (
            "Deterministic metrics could not be computed for this recording — base your "
            "feedback on the transcript alone, without referencing specific numbers."
        )

    parts: list[str] = []

    filler_rate = metrics.get("filler_word_rate")
    if filler_rate is not None:
        parts.append(f"used filler words (um, uh, like, etc.) in about {filler_rate * 100:.0f}% of their words")

    wpm = metrics.get("words_per_minute")
    if wpm is not None:
        parts.append(f"spoke at approximately {wpm} words per minute")

    repetition_count = metrics.get("repetition_count")
    if repetition_count is not None:
        if repetition_count > 0:
            plural = "s" if repetition_count != 1 else ""
            parts.append(
                f'immediately repeated a word or short phrase {repetition_count} time{plural} '
                f'(e.g. "the the" or "I think I think")'
            )
        else:
            parts.append("did not noticeably repeat words or phrases immediately after themselves")

    if not parts:
        return (
            "Deterministic metrics could not be computed for this recording — base your "
            "feedback on the transcript alone, without referencing specific numbers."
        )

    return "Automatically measured (not something you need to recount): the speaker " + "; ".join(parts) + "."


def build_feedback_prompt(mode: str, question: str | None, transcript: str, metrics: dict | None) -> str:
    """Pure prompt-building logic — no network call. Kept separate from `generate_feedback`
    so prompt construction can be unit-tested (see `test_feedback.py`) without a live Gemini
    call.

    `question` is written to naturally handle both cases: a real interview/story prompt, or
    "no specific question" for miscellaneous (or any recording where `question` is null) —
    see docs/CLAUDE.md's "Database" section on why `question` is nullable regardless of mode.
    """
    criteria = MODE_CRITERIA.get(mode, MODE_CRITERIA["miscellaneous"])

    if question:
        prompt_context = f'The speaker was responding to this prompt: "{question}"'
    else:
        prompt_context = (
            "The speaker chose their own topic — there is no fixed prompt to check their "
            "response against."
        )

    metrics_grounding = _format_metrics_grounding(metrics)

    return (
        "You are a public speaking coach giving feedback on a short practice recording, "
        "based only on its transcript below.\n\n"
        f"{criteria}\n\n"
        f"{prompt_context}\n\n"
        f"{metrics_grounding}\n\n"
        "Transcript:\n"
        f'"""\n{transcript}\n"""\n\n'
        "Write 2-4 short paragraphs of specific, actionable feedback in plain prose — no "
        "headers, bullet points, or numeric scores (structured scoring is a separate, "
        "later feature). Reference concrete things the speaker actually said; do not give "
        "generic advice that could apply to any recording. Weave in the automatically "
        "measured stats above where relevant (e.g. if filler words or repetition are "
        "notably high, or the pace is notably fast or slow) rather than ignoring them, but "
        "don't just restate the numbers verbatim — connect them to what actually happened "
        "in the speech. Be encouraging but honest: call out real weaknesses as well as "
        "strengths."
    )


def generate_feedback(transcript: str, metrics: dict | None, mode: str, question: str | None) -> str:
    """Sends a mode-aware feedback prompt to Gemini and returns free-text feedback.

    Raises `FeedbackGenerationError` on any failure — never returns an empty or
    placeholder string.
    """
    prompt = build_feedback_prompt(mode=mode, question=question, transcript=transcript, metrics=metrics)

    logger.info(
        "feedback: requesting feedback from Gemini model %s (mode=%s, has_question=%s)",
        settings.gemini_model,
        mode,
        question is not None,
    )

    try:
        response = get_gemini_client().models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
        )
    except APIError as exc:
        logger.error("feedback: Gemini feedback call failed: %s", exc)
        raise FeedbackGenerationError(f"Gemini API error: {exc}") from exc
    except Exception as exc:
        logger.error("feedback: unexpected error calling Gemini: %s", exc)
        raise FeedbackGenerationError(f"Unexpected error calling Gemini: {exc}") from exc

    feedback = (response.text or "").strip()
    if not feedback:
        logger.error("feedback: Gemini returned an empty feedback response")
        raise FeedbackGenerationError("Gemini returned an empty feedback response.")

    logger.info("feedback: generation succeeded (%d characters)", len(feedback))
    return feedback
