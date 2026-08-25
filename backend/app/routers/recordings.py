"""
Endpoints the Expo app calls once it already owns a `recordings` row.

As of Phase 2 Step 2, upload + row creation still happen entirely on the
frontend, directly against Supabase (see `src/lib/recordings.ts`) — this
router only covers what comes after that: kicking off processing. See
docs/CLAUDE.md's "AI processing endpoint" section for the full picture.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from postgrest.exceptions import APIError

from app.auth import get_current_user_id
from app.services.processing import process_recording
from app.supabase_client import get_service_client

router = APIRouter(prefix="/recordings", tags=["recordings"])


@router.post("/{recording_id}/process", status_code=202)
def start_processing(
    recording_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, str]:
    client = get_service_client()

    try:
        result = (
            client.table("recordings")
            .select("id, user_id, status")
            .eq("id", recording_id)
            .maybe_single()
            .execute()
        )
    except APIError:
        # Most commonly a malformed (non-UUID) recording_id, which Postgres
        # rejects before it ever gets a chance to not-match any row. Same
        # response as the two cases below, deliberately — see next comment.
        raise HTTPException(status_code=403, detail="Not authorized for this recording.")

    recording = None if result is None else result.data

    if recording is None or recording["user_id"] != user_id:
        # Identical status + message whether the recording doesn't exist at
        # all or exists but belongs to someone else — a token for one user
        # should never be able to distinguish those two cases, existence
        # included, from this response.
        raise HTTPException(status_code=403, detail="Not authorized for this recording.")

    if recording["status"] != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Recording is already '{recording['status']}', not 'pending' — refusing to reprocess.",
        )

    # Returns immediately; the actual work (still a stub as of this step —
    # see app/services/processing.py) runs after this response is sent.
    background_tasks.add_task(process_recording, recording_id)

    return {"id": recording_id}
