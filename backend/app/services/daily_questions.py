"""
v4 Epic H Step 1 — the global daily-question system (backend logic).

ONE shared "question of the day" per mode (interview / story), assigned lazily
on the first request of the day that needs it and stored in `daily_questions`
so every later request that day just reads it. No cron, no scheduled job —
same "no background worker" philosophy as the rest of this backend (see
docs/CLAUDE.md's "Background processing" section).

Key properties (see docs/CLAUDE.md's "v4 scope" / "Daily questions" sections):

* **Day boundary is US Eastern (`America/New_York`), DST-aware** — real IANA
  rules via `zoneinfo`, NOT a fixed UTC-5 offset. `eastern_today()` below.
  Colloquially "EST"; implemented as true US Eastern with spring/fall
  transitions. This is an *interpretation* of "daily" and is flagged for the
  human to confirm.

* **Structural no-repeat guarantee** — a question's `used_date` is set the
  instant it's assigned, so it's never assigned again, for anyone. This is why
  v4 needs no per-user "recently used" tracking at all.

* **Synchronous batch top-up** — when a mode's `used_date IS NULL` pool is
  empty, the triggering request generates 15 new questions via one Gemini call
  *synchronously* (the user is waiting), inserts them, and assigns from the new
  batch. Rare (<= once per ~15 days per mode).

* **Concurrency-safe assignment** — `insert into daily_questions ... on
  conflict (date, mode) do nothing returning question_id` makes the database
  the single arbiter of who assigns a given day's question. Only the request
  whose insert wins marks its candidate `used_date`; a request that loses the
  race re-reads the row and returns the winner's question, leaving its own
  candidate untouched and available for a future day.

Testability: `get_or_assign_daily_question` depends on a tiny `DailyQuestionStore`
protocol (and an injectable `generate_batch` / `today`), so `test_daily_questions.py`
drives it with an in-memory fake — no live Supabase or Gemini, same isolation
discipline as `test_processing.py` / `test_feedback.py`.
"""

from __future__ import annotations

import json
import logging
import random
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Callable, Protocol
from zoneinfo import ZoneInfo

from google.genai import types
from google.genai.errors import APIError
from postgrest.exceptions import APIError as PostgrestAPIError

from app.config import settings
from app.gemini_client import get_gemini_client
from app.supabase_client import get_service_client

logger = logging.getLogger(__name__)

# Only interview/story have a curated pool + a daily question. Miscellaneous is
# a free-topic mode with no question — matches the `daily_questions.mode` check
# constraint in 0008_daily_questions.sql.
DAILY_QUESTION_MODES: tuple[str, ...] = ("interview", "story")

# How many questions one synchronous top-up generates when a mode runs out.
QUESTION_BATCH_SIZE = 15

# Day boundary. America/New_York = true US Eastern, DST-aware — see module
# docstring. `zoneinfo` reads this from the IANA database (the `tzdata` package
# on platforms without a system copy — pinned in requirements.txt).
EASTERN = ZoneInfo("America/New_York")


def eastern_today(now: datetime | None = None) -> date:
    """The current calendar date in US Eastern time.

    `now` defaults to the real current UTC instant; tests pass a fixed one. A
    naive datetime is assumed to be UTC.
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(EASTERN).date()


@dataclass(frozen=True)
class Question:
    """A pool question, as returned to the caller / the endpoint."""

    id: str
    mode: str
    text: str


class DailyQuestionError(Exception):
    """Raised when a daily question can't be resolved or generated.

    Surfaces to the endpoint as a 502 — the caller can retry (the failure is
    almost always a transient Gemini error during a rare pool top-up).
    """


# ---------------------------------------------------------------------------
# Storage seam
# ---------------------------------------------------------------------------


class DailyQuestionStore(Protocol):
    """The small set of persistence operations `get_or_assign_daily_question`
    needs. `SupabaseDailyQuestionStore` is the real implementation; tests supply
    an in-memory fake."""

    def get_assigned(self, day: date, mode: str) -> Question | None: ...

    def list_unused(self, mode: str) -> list[Question]: ...

    def existing_question_texts(self, mode: str) -> list[str]: ...

    def insert_questions(self, mode: str, texts: list[str]) -> list[Question]: ...

    def try_assign(self, day: date, mode: str, question_id: str) -> bool: ...

    def mark_used(self, question_id: str, day: date) -> None: ...

    def get_question(self, question_id: str) -> Question | None: ...


class SupabaseDailyQuestionStore:
    """`DailyQuestionStore` backed by the service-role Supabase client."""

    # Bounds on the two "fetch a list" reads so they stay cheap as the pool
    # grows over years of top-ups. Any unused question is an equally valid
    # candidate, and the dedup prompt only needs a representative sample.
    _UNUSED_FETCH_LIMIT = 200
    _EXISTING_TEXTS_LIMIT = 200

    def __init__(self, client) -> None:
        self._client = client

    def get_assigned(self, day: date, mode: str) -> Question | None:
        try:
            result = (
                self._client.table("daily_questions")
                .select("question_id")
                .eq("date", day.isoformat())
                .eq("mode", mode)
                .maybe_single()
                .execute()
            )
        except PostgrestAPIError:
            return None
        row = None if result is None else result.data
        if not row:
            return None
        return self.get_question(row["question_id"])

    def list_unused(self, mode: str) -> list[Question]:
        result = (
            self._client.table("questions")
            .select("id, prompt_text")
            .eq("mode", mode)
            .is_("used_date", "null")
            .limit(self._UNUSED_FETCH_LIMIT)
            .execute()
        )
        return [Question(id=r["id"], mode=mode, text=r["prompt_text"]) for r in (result.data or [])]

    def existing_question_texts(self, mode: str) -> list[str]:
        result = (
            self._client.table("questions")
            .select("prompt_text")
            .eq("mode", mode)
            .order("created_at", desc=True)
            .limit(self._EXISTING_TEXTS_LIMIT)
            .execute()
        )
        return [r["prompt_text"] for r in (result.data or [])]

    def insert_questions(self, mode: str, texts: list[str]) -> list[Question]:
        payload = [{"mode": mode, "prompt_text": t} for t in texts]
        result = self._client.table("questions").insert(payload).execute()
        return [Question(id=r["id"], mode=mode, text=r["prompt_text"]) for r in (result.data or [])]

    def try_assign(self, day: date, mode: str, question_id: str) -> bool:
        """`insert ... on conflict (date, mode) do nothing returning ...`.

        Returns True iff *this* call inserted the row (won the race). supabase-py
        maps `ignore_duplicates=True` to `Prefer: resolution=ignore-duplicates`,
        and a conflict-ignored row is not returned, so `data` is `[row]` on a
        win and `[]` on a loss.
        """
        result = (
            self._client.table("daily_questions")
            .upsert(
                {"date": day.isoformat(), "mode": mode, "question_id": question_id},
                on_conflict="date,mode",
                ignore_duplicates=True,
            )
            .execute()
        )
        return bool(result.data)

    def mark_used(self, question_id: str, day: date) -> None:
        (
            self._client.table("questions")
            .update({"used_date": day.isoformat()})
            .eq("id", question_id)
            .execute()
        )

    def get_question(self, question_id: str) -> Question | None:
        try:
            result = (
                self._client.table("questions")
                .select("id, prompt_text, mode")
                .eq("id", question_id)
                .maybe_single()
                .execute()
            )
        except PostgrestAPIError:
            return None
        row = None if result is None else result.data
        if not row:
            return None
        return Question(id=row["id"], mode=row["mode"], text=row["prompt_text"])


# ---------------------------------------------------------------------------
# Synchronous batch generation (Gemini)
# ---------------------------------------------------------------------------

_QUESTION_BATCH_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "questions": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(type=types.Type.STRING),
        ),
    },
    required=["questions"],
)

_BATCH_GUIDANCE: dict[str, str] = {
    "interview": (
        "behavioral / competency interview questions — the kind a candidate answers with a "
        'short spoken story from their own experience ("Tell me about a time...", "Describe a '
        'situation where...", "What\'s a time you...")'
    ),
    "story": (
        "storytelling prompts that invite a short personal anecdote told out loud "
        '("Tell a story about...", "Describe a moment when...")'
    ),
}


def _dedupe_new_questions(new_texts: list[str], existing: list[str]) -> list[str]:
    """Whitespace-normalises, drops empties, and drops case-insensitive
    duplicates against the existing pool and within the batch itself."""
    seen = {" ".join(t.split()).lower() for t in existing}
    out: list[str] = []
    for raw in new_texts:
        text = " ".join(str(raw).split())
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


def generate_question_batch(mode: str, existing: list[str]) -> list[str]:
    """One synchronous Gemini call for `QUESTION_BATCH_SIZE` fresh questions.

    Structured-JSON response (same reliability pattern as feedback generation —
    see `app/services/feedback.py`), prompted with the existing pool so it
    avoids near-duplicates. Raises `DailyQuestionError` on any failure — the
    caller (a user waiting on a question) gets a 502 and can retry.
    """
    guidance = _BATCH_GUIDANCE.get(mode)
    if guidance is None:
        raise DailyQuestionError(f"No batch-generation guidance for mode {mode!r}.")

    existing_block = "\n".join(f"- {t}" for t in existing) or "(none yet)"
    prompt = (
        f"Generate {QUESTION_BATCH_SIZE} fresh {guidance}.\n\n"
        "Requirements:\n"
        "- Each is a single, self-contained sentence, answerable in about a minute of "
        "speaking.\n"
        "- Plain, direct tone. No numbering, no preamble.\n"
        "- Meaningfully different from each other AND from every existing question listed "
        "below — no paraphrases or near-duplicates.\n\n"
        f"Existing questions to avoid repeating:\n{existing_block}\n\n"
        f'Return a JSON object with a "questions" array of exactly {QUESTION_BATCH_SIZE} strings.'
    )

    logger.info(
        "daily_questions: requesting %d new %s questions from Gemini model %s",
        QUESTION_BATCH_SIZE,
        mode,
        settings.gemini_model,
    )

    try:
        response = get_gemini_client().models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=_QUESTION_BATCH_SCHEMA,
            ),
        )
    except APIError as exc:
        logger.error("daily_questions: Gemini question-batch call failed: %s", exc)
        raise DailyQuestionError(f"Gemini API error generating questions: {exc}") from exc
    except Exception as exc:  # noqa: BLE001 — any failure here is a generation failure
        logger.error("daily_questions: unexpected error generating questions: %s", exc)
        raise DailyQuestionError(f"Unexpected error generating questions: {exc}") from exc

    parsed = getattr(response, "parsed", None)
    if not isinstance(parsed, dict):
        raw = (getattr(response, "text", None) or "").strip()
        try:
            parsed = json.loads(raw)
        except ValueError as exc:
            logger.error("daily_questions: question-batch response was not valid JSON: %s", exc)
            raise DailyQuestionError(f"Question-batch response was not valid JSON: {exc}") from exc

    if not isinstance(parsed, dict) or not isinstance(parsed.get("questions"), list):
        raise DailyQuestionError("Question-batch response JSON had no 'questions' array.")

    texts = [str(q) for q in parsed["questions"] if str(q).strip()]
    logger.info("daily_questions: Gemini returned %d candidate %s questions", len(texts), mode)
    return texts


# ---------------------------------------------------------------------------
# The assignment orchestrator
# ---------------------------------------------------------------------------


def get_or_assign_daily_question(
    mode: str,
    *,
    store: DailyQuestionStore | None = None,
    generate_batch: Callable[[str, list[str]], list[str]] | None = None,
    today: date | None = None,
) -> Question:
    """Return today's question for `mode`, assigning it if this is the first
    request of the day. See the module docstring for the full algorithm.

    `store` / `generate_batch` / `today` are injection seams for tests; in
    production all three take their real defaults.
    """
    if mode not in DAILY_QUESTION_MODES:
        raise DailyQuestionError(
            f"Unsupported mode for daily questions: {mode!r} (expected one of {DAILY_QUESTION_MODES})."
        )

    store = store or SupabaseDailyQuestionStore(get_service_client())
    generate_batch = generate_batch or generate_question_batch
    day = today or eastern_today()

    # 1. Fast path — already assigned today.
    assigned = store.get_assigned(day, mode)
    if assigned is not None:
        return assigned

    # 2. Pick a candidate from the unused pool.
    candidates = store.list_unused(mode)

    # 3. Pool exhausted — generate a fresh batch SYNCHRONOUSLY, then pick from it.
    if not candidates:
        logger.info(
            "daily_questions: %s pool is exhausted — generating a batch of %d now",
            mode,
            QUESTION_BATCH_SIZE,
        )
        existing = store.existing_question_texts(mode)
        new_texts = _dedupe_new_questions(generate_batch(mode, existing), existing)
        if not new_texts:
            raise DailyQuestionError(
                f"Question generation for {mode!r} returned nothing usable after dedup."
            )
        candidates = store.insert_questions(mode, new_texts)
        if not candidates:
            raise DailyQuestionError(f"Failed to persist a generated question batch for {mode!r}.")

    candidate = random.choice(candidates)

    # 4. Concurrency guard — try to be the request that assigns today's question.
    if store.try_assign(day, mode, candidate.id):
        store.mark_used(candidate.id, day)
        logger.info(
            "daily_questions: assigned %s question %s for %s", mode, candidate.id, day.isoformat()
        )
        return candidate

    # 5. Lost the race — a concurrent request already assigned today's question.
    #    Return theirs; leave our candidate untouched (still unused) for a future day.
    assigned = store.get_assigned(day, mode)
    if assigned is None:
        raise DailyQuestionError(
            f"Lost the assignment race for {mode!r} on {day.isoformat()} but no assigned row was found."
        )
    logger.info(
        "daily_questions: concurrent assignment won by another request; using %s", assigned.id
    )
    return assigned
