"""
v4 Epic H Step 1 — the daily-question endpoint.

`GET /questions/daily?mode=interview|story` returns the one shared
"question of the day" for that mode, assigning it lazily if this is the first
request of the day (see `app/services/daily_questions.py`).

Auth: standard bearer-token verification only — this data is NOT user-specific
(every user gets the same question), so there's no ownership check, unlike the
`/recordings/*` endpoints. The token is still required so the endpoint isn't
open to the world.

Consumed by the Record flow's `fetchDailyQuestion` (`src/lib/api.ts`) as of
Epic H Step 2.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user_id
from app.services.daily_questions import (
    DAILY_QUESTION_MODES,
    DailyQuestionError,
    get_or_assign_daily_question,
)

router = APIRouter(prefix="/questions", tags=["questions"])


@router.get("/daily")
def daily_question(
    mode: str = Query(..., description="interview or story"),
    _user_id: str = Depends(get_current_user_id),
) -> dict[str, str]:
    if mode not in DAILY_QUESTION_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"mode must be one of {list(DAILY_QUESTION_MODES)}.",
        )

    try:
        question = get_or_assign_daily_question(mode)
    except DailyQuestionError as exc:
        # Almost always a transient Gemini failure during a rare pool top-up —
        # the caller can retry.
        raise HTTPException(status_code=502, detail=str(exc))

    return {"id": question.id, "mode": question.mode, "text": question.text}
