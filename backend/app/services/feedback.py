"""
Mode-aware Gemini feedback generation.

Given a transcript and the deterministic metrics computed from it (see
`app/services/metrics.py`), this module builds a mode-specific prompt and asks Gemini,
in a single call, for: a short `feedback_summary`, `feedback_strengths` /
`feedback_improvements` point lists, a short 2-4 word recording `title`, three 0-100
scores (`impact_score`, `clarity_score`, `structure_score`), and a `grammar_issue_count`
(a Clarity grounding input, not a displayed score). Everything is folded into one call to
avoid extra cost/latency.

Every field is extracted reliably because the call uses Gemini's structured-output mode
(`response_mime_type="application/json"` + an explicit `response_schema`), so the reply
is valid JSON rather than prose we'd have to parse out of a delimiter. A JSON-parse
failure or an empty `feedback_summary` raises `FeedbackGenerationError` (retried once by
`_run_with_one_retry`); a missing `title`, an unusable strengths/improvements list, or an
out-of-range score is NOT a failure — that field comes back `None`, is logged, and the
recording still completes.

Score prompt design: `impact_score` and `structure_score` use genuinely mode-specific
guidance; `clarity_score` is one holistic judgment grounded by — not averaged from — the
deterministic filler/repetition rates and the model's own grammar assessment. Each score
also carries a per-metric calibration rubric (`_IMPACT_CALIBRATION` /
`_CLARITY_CALIBRATION` / `_STRUCTURE_CALIBRATION`) so a given percentage means the same
thing across calls. The written feedback justifies that qualitative reasoning without
repeating the numbers, and never comments on speaking rate (the app tracks that
elsewhere).

`build_feedback_prompt` is pure string-building with no network call, so it's unit-tested
in isolation (see `test_feedback.py`); the live Gemini call is not exercised in tests.
"""

import json
import logging
from dataclasses import dataclass

from google.genai import types
from google.genai.errors import APIError

from app.config import settings
from app.gemini_client import get_gemini_client

logger = logging.getLogger(__name__)

# Structured-output schema for the single feedback call. Constraining the response to
# this object is what makes extracting every field reliable. Every key is `required`
# because structured output is most reliable when the model must produce all of them;
# `generate_feedback` still validates each leniently (a missing/out-of-range score, or an
# unusable strengths/improvements list, becomes `None` and never fails the recording —
# only a bad `feedback_summary` does).
_FEEDBACK_RESPONSE_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "title": types.Schema(type=types.Type.STRING),
        "impact_score": types.Schema(type=types.Type.INTEGER),
        "clarity_score": types.Schema(type=types.Type.INTEGER),
        "structure_score": types.Schema(type=types.Type.INTEGER),
        "grammar_issue_count": types.Schema(type=types.Type.INTEGER),
        "feedback_summary": types.Schema(type=types.Type.STRING),
        "feedback_strengths": types.Schema(
            type=types.Type.ARRAY, items=types.Schema(type=types.Type.STRING)
        ),
        "feedback_improvements": types.Schema(
            type=types.Type.ARRAY, items=types.Schema(type=types.Type.STRING)
        ),
    },
    required=[
        "title",
        "impact_score",
        "clarity_score",
        "structure_score",
        "grammar_issue_count",
        "feedback_summary",
        "feedback_strengths",
        "feedback_improvements",
    ],
)

# A title longer than this is the model ignoring "2-4 words" — kept anyway (the user can
# edit it) but logged so it's visible.
_MAX_REASONABLE_TITLE_LEN = 120

# Scores are integers on this inclusive scale. A value outside it (or a non-integer) is
# treated as a generation miss for that one score — stored NULL, logged, never a failure.
_SCORE_MIN = 0
_SCORE_MAX = 100


@dataclass
class GeneratedFeedback:
    """Result of the single Gemini feedback call.

    `summary` is always non-empty (an empty one raises `FeedbackGenerationError`) and is
    stored in the `feedback` column. Every other field is `None` when the model returned
    nothing usable for it — tolerated, not a failure. `strengths` / `improvements` are
    lists of prose points. The three scores are integers 0-100 when present;
    `grammar_issue_count` is a non-negative integer (a Clarity grounding input, not a
    displayed score).
    """

    summary: str
    title: str | None
    strengths: list[str] | None = None
    improvements: list[str] | None = None
    impact_score: int | None = None
    clarity_score: int | None = None
    structure_score: int | None = None
    grammar_issue_count: int | None = None

# Mode-specific evaluation criteria: interview answers are judged on directness/structure,
# stories on narrative arc/pacing, miscellaneous on general clarity/conciseness.
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

# Mode-specific guidance for `impact_score` — a genuinely different judgment per mode,
# not one instruction with the mode name swapped in: interview impact is whether the
# answer landed as a response, story impact is engagement/cohesion, miscellaneous is
# substance.
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

# Mode-specific guidance for `structure_score`, consistent with how MODE_CRITERIA frames
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

# Guidance for `clarity_score` and `grammar_issue_count` — not mode-specific. The key
# instruction is that clarity is ONE holistic judgment, not a mechanical average: the
# deterministic filler/repetition rates and the model's own grammar assessment are inputs
# to that impression, not terms to average.
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

# Per-metric calibration anchors. Without a fixed reference for what a given percentage
# represents, the model drifts between calls. Each block describes a genuinely different
# thing — Impact is about whether the content landed, Clarity about how easily it could
# be followed, Structure about how it was organized — not one rubric with the label
# swapped. Bands sit at the 50/60/70/80/90 marks; scores in between interpolate.
_IMPACT_CALIBRATION = (
    "Calibration for impact_score:\n"
    "  50 — On topic but surface-level or generic; a listener leaves without a distinct takeaway.\n"
    "  60 — A real point exists but is under-developed or half-buried in tangents; it lands weakly.\n"
    "  70 — A clear, relevant point with at least one concrete detail; a listener takes something "
    "away, though it isn't especially memorable.\n"
    "  80 — Pointed and well-substantiated with specific detail and an unmistakable takeaway; only "
    "minor missed chances to go deeper.\n"
    "  90 — Compelling: a sharp, specific, fully-developed point that would stick with a listener "
    "and leave a strong impression of the speaker."
)
_CLARITY_CALIBRATION = (
    "Calibration for clarity_score:\n"
    "  50 — Followable only with effort: padded or meandering phrasing, heavy filler or repetition, "
    "or several grammar slips that force re-reading.\n"
    "  60 — The gist comes through, but wordiness, vague word choice, or recurring filler regularly "
    "slow a listener down.\n"
    "  70 — Generally easy to follow; occasional filler, a run-on, or an imprecise word, but nothing "
    "that obscures the meaning.\n"
    "  80 — Tight and articulate: points land in clean, well-formed sentences with little filler and "
    "no grammar distractions.\n"
    "  90 — Effortless: every sentence is economical and precise, no filler or notable repetition, "
    "phrasing a listener never has to work at."
)
_STRUCTURE_CALIBRATION = (
    "Calibration for structure_score:\n"
    "  50 — Hard to track the throughline: points arrive out of order, the speaker backtracks, or a "
    "story is nearly all setup or a rushed ending.\n"
    "  60 — A loose shape is present, but transitions are abrupt or the main point isn't framed "
    "until late.\n"
    "  70 — A recognizable arc — opening, development, close — with mostly logical ordering; a "
    "couple of loose transitions or a soft ending.\n"
    "  80 — Deliberately organized: the point or premise is set up front (or a story's setup is well "
    "proportioned), support follows in a sensible order, and it closes cleanly.\n"
    "  90 — Tightly built: every part is in the right place and earns it, transitions are seamless, "
    "and the opening and close frame each other."
)


class FeedbackGenerationError(Exception):
    """Raised when generating feedback for a recording fails or yields nothing usable.

    Mirrors `TranscriptionError` in `app/services/processing.py`: covers the Gemini call
    itself erroring and a technically-successful response with no usable feedback summary.
    Caught specifically in `process_recording` so a bad feedback response can never fall
    through to a `done` status with empty/placeholder feedback attached — and, unlike a
    transcription failure, it must never discard the transcript/metrics that already
    succeeded and were already written to the row before this step ran.
    """


def _format_metrics_grounding(metrics: dict | None) -> str:
    """Turns the `compute_metrics` output into a natural-language grounding sentence.

    Only the filler-word and repetition signals are surfaced — they ground the Clarity
    judgment. Words-per-minute is deliberately omitted: speaking rate must not appear in
    the written feedback, so the model never sees it here. Handles `metrics` being `None`,
    or an individual field being `None`, by omitting what isn't known.
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

    `question` handles both cases: a real interview/story prompt, or "no specific question"
    for miscellaneous (or any recording where `question` is null — it's nullable for every
    mode).
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
        '"title": a short 2-4 word label for this recording, written like a note or '
        'journal-entry title in title case — e.g. "Challenging Coworker", "Unplanned Trip", '
        f'"Day Recap". Not a sentence, no trailing punctuation. {title_guidance}\n\n'
        f'"impact_score": an integer 0-100. {impact_guidance}\n{_IMPACT_CALIBRATION}\n\n'
        f'"clarity_score": an integer 0-100. {_CLARITY_GUIDANCE}\n{_CLARITY_CALIBRATION}\n\n'
        f'"structure_score": an integer 0-100. {structure_guidance}\n{_STRUCTURE_CALIBRATION}\n\n'
        '"grammar_issue_count": a non-negative integer — the count of notable grammatical '
        "errors described in the clarity guidance above (0 if none).\n\n"
        f"{_SCORE_SCALE}\n\n"
        '"feedback_summary": 1-2 sentences of plain-prose overview of how the recording went '
        "overall. No headers, bullet points, or numeric scores.\n\n"
        '"feedback_strengths": an array of strings — a few distinct, concrete things that '
        "worked, each one specific to something the speaker actually said or did (never "
        'generic praise like "good effort" or "keep practicing"). Together they should '
        "justify the qualitative reasoning behind the impact, clarity, and structure "
        "assessment above — what made those aspects land — without restating the numeric "
        "scores. A few real points is enough; do not pad the list to a fixed count.\n\n"
        '"feedback_improvements": an array of strings — several distinct, concrete areas to '
        "improve, each tied to a specific moment in this recording and phrased as actionable "
        "guidance rather than vague filler. Explain the reasoning behind where impact, "
        "clarity, or structure fell short, but do not restate the numeric scores themselves "
        "— the app shows those separately. Do not comment on the speaker's speaking rate or "
        "words per minute anywhere in the feedback. A few real points is enough; do not "
        "pad.\n\n"
        "Base all three feedback fields on the same reasoning as the scores, and reference "
        "concrete moments from the transcript rather than advice that could apply to any "
        "recording. Be encouraging but honest."
    )


def _coerce_score(raw: object, field_name: str) -> int | None:
    """Validates one 0-100 score from the Gemini JSON response.

    Returns `None` (and logs) for anything missing, non-integer, or out of range — a
    per-score generation miss is tolerated exactly like a missing `title`, never a reason to
    fail or retry the recording. Only a bad `feedback_summary` field does that.
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


def _coerce_string_list(raw: object, field_name: str) -> list[str] | None:
    """Validates one array-of-strings field (`feedback_strengths` /
    `feedback_improvements`) from the Gemini JSON response.

    Non-string entries are dropped and each kept entry is stripped. Returns `None` (and
    logs) when the value isn't a list or has no usable entries left — a per-list miss is
    tolerated like a missing score, never a reason to fail the recording.
    """
    if raw is None:
        logger.warning("feedback: %s missing from response — storing NULL", field_name)
        return None
    if not isinstance(raw, list):
        logger.warning("feedback: %s was not a list (%s) — storing NULL", field_name, type(raw).__name__)
        return None
    items = [text for text in (str(entry).strip() for entry in raw if isinstance(entry, str)) if text]
    if not items:
        logger.warning("feedback: %s had no usable entries — storing NULL", field_name)
        return None
    return items


def generate_feedback(
    transcript: str, metrics: dict | None, mode: str, question: str | None
) -> GeneratedFeedback:
    """Sends a mode-aware feedback prompt to Gemini and returns a feedback summary, its
    strengths/improvements lists, a short recording title, and the scores — all extracted
    from one structured-JSON response.

    Raises `FeedbackGenerationError` if the call fails, the response isn't valid JSON, or
    `feedback_summary` is empty/missing — never returns an empty or placeholder summary. A
    missing `title`, an unusable strengths/improvements list, or an out-of-range score is
    NOT an error: that field comes back `None` and the caller stores the recording `done`
    anyway.
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

    summary = str(parsed.get("feedback_summary") or "").strip()
    if not summary:
        logger.error("feedback: Gemini returned an empty feedback_summary field")
        raise FeedbackGenerationError("Gemini returned an empty feedback_summary field.")

    # Lenient: an unusable strengths/improvements list is stored NULL, never a failure —
    # mirrors title/score handling.
    strengths = _coerce_string_list(parsed.get("feedback_strengths"), "feedback_strengths")
    improvements = _coerce_string_list(parsed.get("feedback_improvements"), "feedback_improvements")

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

    # Each score validated leniently — a missing/garbage one is stored NULL, never a failure.
    impact_score = _coerce_score(parsed.get("impact_score"), "impact_score")
    clarity_score = _coerce_score(parsed.get("clarity_score"), "clarity_score")
    structure_score = _coerce_score(parsed.get("structure_score"), "structure_score")
    grammar_issue_count = _coerce_issue_count(parsed.get("grammar_issue_count"))

    logger.info(
        "feedback: generation succeeded (%d chars summary, %s strengths, %s improvements, "
        "title=%r, impact=%s, clarity=%s, structure=%s, grammar_issues=%s)",
        len(summary),
        len(strengths) if strengths is not None else None,
        len(improvements) if improvements is not None else None,
        title,
        impact_score,
        clarity_score,
        structure_score,
        grammar_issue_count,
    )
    return GeneratedFeedback(
        summary=summary,
        title=title,
        strengths=strengths,
        improvements=improvements,
        impact_score=impact_score,
        clarity_score=clarity_score,
        structure_score=structure_score,
        grammar_issue_count=grammar_issue_count,
    )
