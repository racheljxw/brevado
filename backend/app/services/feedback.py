"""
Phase 2 Step 5: mode-aware Gemini feedback generation — the last previously-stubbed
piece of the processing pipeline. Given an already-real transcript and already-computed
deterministic metrics (see `app/services/metrics.py`), this module builds a mode-specific
prompt and asks Gemini for free-text coaching feedback (structured/criteria-based scoring
is explicitly Phase 5, not this step — see docs/CLAUDE.md's "Metrics" section and
docs/PROJECT_PLAN.md Section 3).

v2 Epic D Part 1 / v3 Epic F Step 1: the same single Gemini call now *also* returns a short
2-4 word recording `title` ("Challenging Coworker", "Day Recap") AND three 0-100 scores —
`impact_score`, `clarity_score`, `structure_score` — plus a `grammar_issue_count` (a
Clarity grounding input, not a displayed score). All folded into this one call, not extra
requests, to avoid cost/latency. Reliability of extracting every field comes from Gemini's
structured-output mode: the call passes `response_mime_type="application/json"` plus an
explicit `response_schema`, so the response is constrained to valid JSON we can `json.loads`
— not a fragile delimiter we'd have to split on. A JSON-parse failure or an empty `feedback`
field is treated as a feedback failure (raises `FeedbackGenerationError`, so
`_run_with_one_retry` retries once); an empty/missing `title`, or any missing/out-of-range
score, is NOT a failure — `generate_feedback` returns that field as `None`, logs it, and the
recording still completes normally (same lenient degradation as metrics — see `processing.py`
and docs/CLAUDE.md's "v3 scope" / "Metrics" sections).

Score prompt design (docs/CLAUDE.md's "v3 scope"): `impact_score` and `structure_score` use
genuinely mode-specific guidance (`MODE_IMPACT_GUIDANCE` / `MODE_STRUCTURE_GUIDANCE`);
`clarity_score` is one holistic judgment (`_CLARITY_GUIDANCE`) grounded by — not averaged
from — the deterministic filler/repetition rates already in the metrics grounding plus the
model's own grammar assessment (`grammar_issue_count`).

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

import json
import logging
from dataclasses import dataclass

from google.genai import types
from google.genai.errors import APIError

from app.config import settings
from app.gemini_client import get_gemini_client

logger = logging.getLogger(__name__)

# Structured-output schema for the single feedback call (v2 Epic D Part 1; extended in v3
# Epic F Step 1). Constraining the response to this object is what makes extracting every
# field from one call reliable — no delimiter parsing, no "the model wrapped it in prose"
# failure mode.
#
# v3 adds `impact_score` / `clarity_score` / `structure_score` (each an integer 0-100 —
# see docs/CLAUDE.md's "v3 scope") and `grammar_issue_count` (a non-negative integer the
# model assesses itself, a Clarity grounding input — not a displayed score). All four are
# in `required` for the same reason `title` is: structured output is most reliable when the
# model must produce every key. `generate_feedback` still validates each leniently — a
# missing/out-of-range score becomes `None` and never fails the recording (only a bad
# `feedback` field does).
_FEEDBACK_RESPONSE_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "feedback": types.Schema(type=types.Type.STRING),
        "title": types.Schema(type=types.Type.STRING),
        "impact_score": types.Schema(type=types.Type.INTEGER),
        "clarity_score": types.Schema(type=types.Type.INTEGER),
        "structure_score": types.Schema(type=types.Type.INTEGER),
        "grammar_issue_count": types.Schema(type=types.Type.INTEGER),
    },
    required=[
        "feedback",
        "title",
        "impact_score",
        "clarity_score",
        "structure_score",
        "grammar_issue_count",
    ],
)

# A title longer than this is the model ignoring "2-4 words" — kept anyway (Part 2 lets the
# user edit it) but logged so it's visible.
_MAX_REASONABLE_TITLE_LEN = 120

# Scores are integers on this inclusive scale. A value outside it (or a non-integer) is
# treated as a generation miss for that one score — stored NULL, logged, never a failure.
_SCORE_MIN = 0
_SCORE_MAX = 100


@dataclass
class GeneratedFeedback:
    """Result of the single Gemini feedback call (feedback + title + v3 scores).

    `feedback` is always non-empty (an empty one raises `FeedbackGenerationError` instead).
    Every other field is `None` when the model returned nothing usable for it — a tolerated
    outcome, not a failure: the recording still completes with feedback and whatever else
    did parse. `impact_score` / `clarity_score` / `structure_score` are integers 0-100 when
    present; `grammar_issue_count` is a non-negative integer (a Clarity grounding input, not
    a displayed score — see docs/CLAUDE.md's "v3 scope").
    """

    feedback: str
    title: str | None
    impact_score: int | None = None
    clarity_score: int | None = None
    structure_score: int | None = None
    grammar_issue_count: int | None = None

# Mode-specific evaluation criteria, per docs/PROJECT_PLAN.md Section 3: interview answers
# are judged on directness/structure, stories on narrative arc/pacing, miscellaneous on
# general clarity/conciseness. All three branches were built in Phase 2 Step 5, before
# Phase 4's real mode/question selection existed (every recording was still
# mode='miscellaneous', question=null then) — Phase 4 didn't need this rebuilt, and a real
# interview/story mode+question now flows into this exactly as originally designed.
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

# v3 Epic F Step 1: mode-specific guidance for the `impact_score`. Deliberately worded to
# be a genuinely different judgment per mode, not one instruction with the mode name swapped
# in — interview impact is about whether the answer landed as a response, story impact is
# about engagement/cohesion, miscellaneous impact is about substance.
MODE_IMPACT_GUIDANCE: dict[str, str] = {
    "interview": (
        "Impact here is whether the answer actually landed as a response to the question: "
        "did it address what was asked directly (not a near-miss or a dodge), give a "
        "concrete and substantive answer rather than a vague or generic one, and leave a "
        "listener with a clear takeaway about the speaker?"
    ),
    "story": (
        "Impact here is how cohesive and engaging the story was as a whole: did it hold "
        "together as one narrative with a point, build and pay off interest or tension, and "
        "make a listener actually want to keep listening rather than tune out?"
    ),
    "miscellaneous": (
        "Impact here is the substance and coherence of the take: did the speaker say "
        "something genuinely worth hearing — a real idea, opinion, or observation developed "
        "with some depth — rather than filling time, and did the take hold together as a "
        "coherent whole?"
    ),
}

# v3 Epic F Step 1: mode-specific guidance for the `structure_score` — a mode-aware
# organization/coherence judgment, consistent with how MODE_CRITERIA already frames
# structure for the prose feedback.
MODE_STRUCTURE_GUIDANCE: dict[str, str] = {
    "interview": (
        "Structure here is organization: a clear point stated up front, logically ordered "
        "support, and a clean close — versus rambling, backtracking, or burying the answer."
    ),
    "story": (
        "Structure here is narrative shape: a clear beginning, middle, and end, with setup, "
        "development, and resolution in a sensible order and proportion — not all setup, not "
        "a rushed payoff."
    ),
    "miscellaneous": (
        "Structure here is organization: moving through the points in a sensible order with "
        "clear connections between them, versus jumping around and losing the thread."
    ),
}

# v3 Epic F Step 1: guidance for the `clarity_score` and `grammar_issue_count`. Not
# mode-specific. The key instruction is that clarity is ONE holistic judgment, not a
# mechanical average of the sub-metrics — the deterministic filler/repetition rates (in the
# metrics grounding above) and the model's own grammar assessment are inputs to that
# impression, not terms to average.
_CLARITY_GUIDANCE = (
    "Give one holistic judgment of how clear and easy to follow the speech was overall — "
    "how readily a listener could grasp the point and track the reasoning. This is your own "
    "overall impression, NOT a mechanical average of any numbers. Weigh conciseness (tight "
    "vs. padded), word choice, sentence construction, and the automatically measured "
    "filler-word and repetition rates above as inputs to that impression. Separately, assess "
    "the speaker's grammar yourself from the transcript and return grammar_issue_count as "
    "the count of notable grammatical errors you notice (subject-verb agreement, tense, "
    "malformed sentences, and the like) — do not count transcription artifacts or the normal "
    "informality of spoken language. More grammar issues should pull the clarity score down, "
    "but they are one factor among several, not the whole score."
)

_SCORE_SCALE = (
    "Use the full 0-100 range for the three scores: 0 = very poor, 50 = mediocre, 75 = "
    "solid, 90+ = genuinely excellent. Judge honestly against a high bar — don't cluster "
    "everything in the 70s-80s, and don't default to round multiples of 5 or 10."
)


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
    impact_guidance = MODE_IMPACT_GUIDANCE.get(mode, MODE_IMPACT_GUIDANCE["miscellaneous"])
    structure_guidance = MODE_STRUCTURE_GUIDANCE.get(mode, MODE_STRUCTURE_GUIDANCE["miscellaneous"])

    if question:
        prompt_context = f'The speaker was responding to this prompt: "{question}"'
    else:
        prompt_context = (
            "The speaker chose their own topic — there is no fixed prompt to check their "
            "response against."
        )

    metrics_grounding = _format_metrics_grounding(metrics)

    # Title guidance keys off whether there's a question at all, not the mode name:
    # miscellaneous always has question=None, and an interview/story recording with a null
    # question (a lookup edge case) correctly falls through to the transcript-only branch
    # too — there's nothing else to summarise in that case.
    if question:
        title_guidance = (
            "You may draw on the prompt and how the speaker responded to it for context, "
            "but do not just restate the prompt."
        )
    else:
        title_guidance = (
            "There is no prompt for this recording, so derive the title entirely from what "
            "the speaker actually talks about in the transcript."
        )

    return (
        "You are a public speaking coach giving feedback on a short practice recording, "
        "based only on its transcript below.\n\n"
        f"{criteria}\n\n"
        f"{prompt_context}\n\n"
        f"{metrics_grounding}\n\n"
        "Transcript:\n"
        f'"""\n{transcript}\n"""\n\n'
        "Respond with a single JSON object with exactly these keys:\n\n"
        '"feedback": 2-4 short paragraphs of specific, actionable feedback in plain prose — '
        "no headers, bullet points, or numeric scores in the prose itself (the scores are "
        "separate keys below). Reference concrete things the speaker actually said; do not "
        "give generic advice that could apply to any recording. Weave in the automatically "
        "measured stats above where relevant (e.g. if filler words or repetition are "
        "notably high, or the pace is notably fast or slow) rather than ignoring them, but "
        "don't just restate the numbers verbatim — connect them to what actually happened "
        "in the speech. Be encouraging but honest: call out real weaknesses as well as "
        "strengths.\n\n"
        '"title": a short 2-4 word label for this recording, written like a note or '
        'journal-entry title in title case — e.g. "Challenging Coworker", "Unplanned Trip", '
        f'"Day Recap". Not a sentence, no trailing punctuation. {title_guidance}\n\n'
        f'"impact_score": an integer 0-100. {impact_guidance}\n\n'
        f'"clarity_score": an integer 0-100. {_CLARITY_GUIDANCE}\n\n'
        f'"structure_score": an integer 0-100. {structure_guidance}\n\n'
        '"grammar_issue_count": a non-negative integer — the count of notable grammatical '
        "errors described in the clarity guidance above (0 if none).\n\n"
        f"{_SCORE_SCALE}"
    )


def _coerce_score(raw: object, field_name: str) -> int | None:
    """Validates one 0-100 score from the Gemini JSON response.

    Returns `None` (and logs) for anything missing, non-integer, or out of range — a
    per-score generation miss is tolerated exactly like a missing `title`, never a reason to
    fail or retry the recording. Only a bad `feedback` field does that.
    """
    if raw is None:
        logger.warning("feedback: %s missing from response — storing NULL", field_name)
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        logger.warning("feedback: %s was not an integer (%r) — storing NULL", field_name, raw)
        return None
    if not (_SCORE_MIN <= value <= _SCORE_MAX):
        logger.warning("feedback: %s out of range 0-100 (%r) — storing NULL", field_name, value)
        return None
    return value


def _coerce_issue_count(raw: object) -> int | None:
    """Like `_coerce_score`, but for `grammar_issue_count` — a non-negative integer with no
    upper bound. `None` (logged) for missing / non-integer / negative.
    """
    if raw is None:
        logger.warning("feedback: grammar_issue_count missing from response — storing NULL")
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        logger.warning("feedback: grammar_issue_count was not an integer (%r) — storing NULL", raw)
        return None
    if value < 0:
        logger.warning("feedback: grammar_issue_count was negative (%r) — storing NULL", value)
        return None
    return value


def generate_feedback(
    transcript: str, metrics: dict | None, mode: str, question: str | None
) -> GeneratedFeedback:
    """Sends a mode-aware feedback prompt to Gemini and returns free-text feedback plus a
    short recording title, extracted from one structured-JSON response.

    Raises `FeedbackGenerationError` if the call fails, the response isn't valid JSON, or
    the `feedback` field is empty/missing — never returns an empty or placeholder feedback
    string. A missing/empty `title` is NOT an error: `GeneratedFeedback.title` comes back
    `None` and the caller stores the recording as `done` with a null title anyway.
    """
    prompt = build_feedback_prompt(mode=mode, question=question, transcript=transcript, metrics=metrics)

    logger.info(
        "feedback: requesting feedback+title from Gemini model %s (mode=%s, has_question=%s)",
        settings.gemini_model,
        mode,
        question is not None,
    )

    try:
        response = get_gemini_client().models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=_FEEDBACK_RESPONSE_SCHEMA,
            ),
        )
    except APIError as exc:
        logger.error("feedback: Gemini feedback call failed: %s", exc)
        raise FeedbackGenerationError(f"Gemini API error: {exc}") from exc
    except Exception as exc:
        logger.error("feedback: unexpected error calling Gemini: %s", exc)
        raise FeedbackGenerationError(f"Unexpected error calling Gemini: {exc}") from exc

    # With a response_schema set, the SDK already deserializes the reply into
    # `response.parsed` (a dict here, since the schema isn't a Pydantic model). Prefer that;
    # fall back to hand-parsing `response.text` if it's somehow absent.
    parsed = getattr(response, "parsed", None)
    if not isinstance(parsed, dict):
        raw = (response.text or "").strip()
        try:
            parsed = json.loads(raw)
        except ValueError as exc:
            # ValueError covers json.JSONDecodeError. With response_mime_type=application/json
            # + a schema this should not happen, but if it does it's a real, new failure
            # mode — treat it as a feedback failure so `_run_with_one_retry` gets a shot.
            logger.error("feedback: could not parse Gemini JSON response (%s); raw prefix=%r", exc, raw[:200])
            raise FeedbackGenerationError(f"Gemini feedback response was not valid JSON: {exc}") from exc

    if not isinstance(parsed, dict):
        logger.error("feedback: Gemini response was not a JSON object; got %r", type(parsed).__name__)
        raise FeedbackGenerationError("Gemini feedback response JSON was not an object.")

    feedback = str(parsed.get("feedback") or "").strip()
    if not feedback:
        logger.error("feedback: Gemini returned an empty feedback field")
        raise FeedbackGenerationError("Gemini returned an empty feedback field.")

    # Lenient: a bad/empty title never fails the recording — mirrors metrics handling.
    title: str | None = " ".join(str(parsed.get("title") or "").split()).strip(" .")
    if not title:
        logger.warning(
            "feedback: generation succeeded but no usable title was returned — "
            "storing feedback with title=None (recording is NOT failed over this)"
        )
        title = None
    elif len(title) > _MAX_REASONABLE_TITLE_LEN:
        logger.warning("feedback: title looks unexpectedly long (%d chars): %r", len(title), title)

    # v3 Epic F Step 1: three 0-100 scores + a grammar-issue count from the same response.
    # Each validated leniently — a missing/garbage one is stored NULL, never a failure.
    impact_score = _coerce_score(parsed.get("impact_score"), "impact_score")
    clarity_score = _coerce_score(parsed.get("clarity_score"), "clarity_score")
    structure_score = _coerce_score(parsed.get("structure_score"), "structure_score")
    grammar_issue_count = _coerce_issue_count(parsed.get("grammar_issue_count"))

    logger.info(
        "feedback: generation succeeded (%d chars feedback, title=%r, impact=%s, "
        "clarity=%s, structure=%s, grammar_issues=%s)",
        len(feedback),
        title,
        impact_score,
        clarity_score,
        structure_score,
        grammar_issue_count,
    )
    return GeneratedFeedback(
        feedback=feedback,
        title=title,
        impact_score=impact_score,
        clarity_score=clarity_score,
        structure_score=structure_score,
        grammar_issue_count=grammar_issue_count,
    )
