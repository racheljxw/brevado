"""
Unit checks for `app/services/daily_questions.py` — no live Supabase or Gemini.

`get_or_assign_daily_question` takes injectable `store` / `generate_batch` /
`today` seams, so these tests drive it with an in-memory `FakeStore` that
models the `(date, mode)` uniqueness the real concurrency guard relies on.

Run from `backend/` with the dev deps installed:
    pip install -r requirements.txt -r requirements-dev.txt
    pytest
"""

from datetime import date, datetime, timezone

import pytest

from app.services import daily_questions as dq
from app.services.daily_questions import (
    DailyQuestionError,
    Question,
    _dedupe_new_questions,
    eastern_today,
    get_or_assign_daily_question,
)

DAY = date(2026, 8, 29)


# ---------------------------------------------------------------------------
# eastern_today — DST-aware day boundary
# ---------------------------------------------------------------------------


def test_eastern_today_is_dst_aware_not_a_fixed_offset():
    # The SAME UTC wall-clock time (04:30) lands on different local calendar
    # dates in winter vs. summer — which can only be true if the offset actually
    # changes with DST (EST = UTC-5, EDT = UTC-4), not a year-round UTC-5.
    winter = datetime(2026, 1, 15, 4, 30, tzinfo=timezone.utc)
    summer = datetime(2026, 7, 15, 4, 30, tzinfo=timezone.utc)
    assert eastern_today(winter) == date(2026, 1, 14)  # 23:30 EST, prev day
    assert eastern_today(summer) == date(2026, 7, 15)  # 00:30 EDT, same day


def test_eastern_today_around_spring_forward_transition():
    # DST starts 2026-03-08 at 02:00 local (07:00 UTC). Either side of it is
    # still March 8 in Eastern.
    before = datetime(2026, 3, 8, 6, 30, tzinfo=timezone.utc)  # 01:30 EST
    after = datetime(2026, 3, 8, 8, 30, tzinfo=timezone.utc)  # 04:30 EDT
    assert eastern_today(before) == date(2026, 3, 8)
    assert eastern_today(after) == date(2026, 3, 8)


def test_eastern_today_treats_naive_datetime_as_utc():
    assert eastern_today(datetime(2026, 1, 15, 4, 30)) == date(2026, 1, 14)


# ---------------------------------------------------------------------------
# _dedupe_new_questions
# ---------------------------------------------------------------------------


def test_dedupe_drops_case_insensitive_and_intra_batch_duplicates_and_empties():
    existing = ["Tell me about a time you failed."]
    new = [
        "  tell me about a TIME you failed.  ",  # dup of existing (case/space)
        "A genuinely new question?",
        "A genuinely new question?",  # dup within the batch
        "   ",  # empty after strip
        "Another new one.",
    ]
    assert _dedupe_new_questions(new, existing) == [
        "A genuinely new question?",
        "Another new one.",
    ]


# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------


class FakeStore:
    """Models exactly what `SupabaseDailyQuestionStore` does, including the
    `(day, mode)` uniqueness that makes `try_assign` a real race arbiter."""

    def __init__(self, questions: list[Question] | None = None):
        self._questions: dict[str, Question] = {}
        self._used: dict[str, date] = {}
        self._assigned: dict[tuple[date, str], str] = {}
        self._gen_counter = 0
        for q in questions or []:
            self._questions[q.id] = q

    def get_assigned(self, day, mode):
        qid = self._assigned.get((day, mode))
        return self._questions.get(qid) if qid else None

    def list_unused(self, mode):
        return [
            q for qid, q in self._questions.items() if q.mode == mode and qid not in self._used
        ]

    def existing_question_texts(self, mode):
        return [q.text for q in self._questions.values() if q.mode == mode]

    def insert_questions(self, mode, texts):
        out = []
        for t in texts:
            self._gen_counter += 1
            q = Question(id=f"gen-{self._gen_counter}", mode=mode, text=t)
            self._questions[q.id] = q
            out.append(q)
        return out

    def try_assign(self, day, mode, question_id):
        key = (day, mode)
        if key in self._assigned:
            return False
        self._assigned[key] = question_id
        return True

    def mark_used(self, question_id, day):
        self._used[question_id] = day

    def get_question(self, question_id):
        return self._questions.get(question_id)


def _pool(mode: str, n: int) -> list[Question]:
    return [Question(id=f"{mode}-{i}", mode=mode, text=f"{mode} question {i}") for i in range(n)]


def _boom_generator(mode, existing):  # pragma: no cover - should never be called
    raise AssertionError("generate_batch should not have been called")


# ---------------------------------------------------------------------------
# get_or_assign_daily_question
# ---------------------------------------------------------------------------


def test_rejects_unsupported_mode():
    with pytest.raises(DailyQuestionError):
        get_or_assign_daily_question("miscellaneous", store=FakeStore(), today=DAY)


def test_fast_path_returns_existing_assignment_without_generating():
    store = FakeStore(_pool("interview", 3))
    store._assigned[(DAY, "interview")] = "interview-1"

    result = get_or_assign_daily_question(
        "interview", store=store, generate_batch=_boom_generator, today=DAY
    )

    assert result.id == "interview-1"
    # Fast path must not have marked anything used or re-assigned.
    assert store._used == {}


def test_assigns_from_unused_pool_and_retires_the_chosen_question():
    store = FakeStore(_pool("story", 4))

    result = get_or_assign_daily_question(
        "story", store=store, generate_batch=_boom_generator, today=DAY
    )

    assert result.mode == "story"
    assert result.id in {"story-0", "story-1", "story-2", "story-3"}
    assert store._assigned[(DAY, "story")] == result.id
    assert store._used == {result.id: DAY}  # exactly one question retired
    # The other three remain available.
    assert len(store.list_unused("story")) == 3


def test_exhaustion_triggers_synchronous_batch_generation_then_assigns():
    store = FakeStore([])  # empty pool
    calls: list[tuple[str, list[str]]] = []

    def generator(mode, existing):
        calls.append((mode, existing))
        return [f"fresh {mode} q {i}" for i in range(dq.QUESTION_BATCH_SIZE)]

    result = get_or_assign_daily_question(
        "interview", store=store, generate_batch=generator, today=DAY
    )

    assert calls == [("interview", [])]
    assert result.id.startswith("gen-")
    assert store._assigned[(DAY, "interview")] == result.id
    assert store._used == {result.id: DAY}
    # 15 generated, 1 assigned/retired -> 14 still available.
    assert len(store.list_unused("interview")) == dq.QUESTION_BATCH_SIZE - 1


def test_exhaustion_with_unusable_generation_raises():
    store = FakeStore([])

    with pytest.raises(DailyQuestionError):
        get_or_assign_daily_question(
            "interview", store=store, generate_batch=lambda mode, existing: [], today=DAY
        )
    assert (DAY, "interview") not in store._assigned


# --- concurrency guard ------------------------------------------------------


class RacingFakeStore(FakeStore):
    """A competitor request assigns `competitor_qid` the moment we first try to
    assign — so our `try_assign` loses exactly once, then behaves normally."""

    def __init__(self, questions, competitor_qid):
        super().__init__(questions)
        self._competitor_qid = competitor_qid
        self._raced = False

    def try_assign(self, day, mode, question_id):
        if not self._raced:
            self._raced = True
            self._assigned[(day, mode)] = self._competitor_qid
            self._used[self._competitor_qid] = day
            return False
        return super().try_assign(day, mode, question_id)


def test_concurrency_guard_loser_uses_winners_question_and_does_not_retire_its_own(monkeypatch):
    q_ours = Question(id="q-ours", mode="interview", text="ours")
    q_comp = Question(id="q-comp", mode="interview", text="competitor")
    store = RacingFakeStore([q_ours, q_comp], competitor_qid="q-comp")

    # Force our candidate pick to be q_ours (the non-competitor) so the assertion
    # "our candidate was not retired" is meaningful.
    monkeypatch.setattr(dq.random, "choice", lambda seq: next(q for q in seq if q.id == "q-ours"))

    result = get_or_assign_daily_question(
        "interview", store=store, generate_batch=_boom_generator, today=DAY
    )

    assert result.id == "q-comp"  # we returned the winner's question
    assert store._used == {"q-comp": DAY}  # our candidate was NOT retired
    assert "q-ours" in {q.id for q in store.list_unused("interview")}


def test_concurrent_calls_resolve_to_the_same_question(monkeypatch):
    q_ours = Question(id="q-ours", mode="interview", text="ours")
    q_comp = Question(id="q-comp", mode="interview", text="competitor")
    store = RacingFakeStore([q_ours, q_comp], competitor_qid="q-comp")
    monkeypatch.setattr(dq.random, "choice", lambda seq: next(q for q in seq if q.id == "q-ours"))

    first = get_or_assign_daily_question(
        "interview", store=store, generate_batch=_boom_generator, today=DAY
    )
    # Second call now hits the fast path (row already assigned).
    second = get_or_assign_daily_question(
        "interview", store=store, generate_batch=_boom_generator, today=DAY
    )

    assert first.id == second.id == "q-comp"
