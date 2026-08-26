"""
Endpoints the Expo app calls once it already owns a `recordings` row.

As of Phase 2 Step 2, upload + row creation still happen entirely on the
frontend, directly against Supabase (see `src/lib/recordings.ts`) — this
router only covers what comes after that: kicking off processing, and (as of
Phase 3 Step 2) manually retrying it after a failure. See docs/CLAUDE.md's
"AI processing endpoint" and "Background processing" sections for the full
picture.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from postgrest.exceptions import APIError

from app.auth import get_current_user_id
from app.services.processing import process_recording
from app.supabase_client import get_service_client

router = APIRouter(prefix="/recordings", tags=["recordings"])


def _fetch_authorized_recording(client, recording_id: str, user_id: str) -> dict:
    """Fetches `recording_id` and confirms it belongs to `user_id`.

    Shared by `/process` and `/regenerate` so both endpoints give a caller an
    identical, indistinguishable 403 whether the recording doesn't exist at
    all or exists but belongs to someone else — a token for one user should
    never be able to tell those two cases apart from the response.
    """
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
        # response as the case below, deliberately.
        raise HTTPException(status_code=403, detail="Not authorized for this recording.")

    recording = None if result is None else result.data

    if recording is None or recording["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not authorized for this recording.")

    return recording


@router.post("/{recording_id}/process", status_code=202)
def start_processing(
    recording_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, str]:
    client = get_service_client()
    recording = _fetch_authorized_recording(client, recording_id, user_id)

    if recording["status"] != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Recording is already '{recording['status']}', not 'pending' — refusing to reprocess.",
        )

    # Returns immediately; the actual work (transcription, metrics, feedback — see
    # app/services/processing.py) runs after this response is sent.
    background_tasks.add_task(process_recording, recording_id)

    return {"id": recording_id}


@router.post("/{recording_id}/regenerate", status_code=202)
def regenerate_report(
    recording_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, str]:
    """Phase 3 Step 2 — the manual "Regenerate report" action for a recording
    that's `failed` even after Phase 2 Step 6's automatic inline retry.

    Only valid from `failed` (the mirror image of `/process`, which is only
    valid from `pending`) — anything else 409s rather than being silently
    reprocessed. Schedules the exact same `process_recording()` pipeline as
    `/process`, no separate "regenerate" code path: that function already
    flips status back to `processing` as its very first step and overwrites
    transcript/metrics/feedback unconditionally as each stage completes, so a
    fresh call is a clean, full re-attempt (transcribe -> metrics -> feedback,
    with its own independent one-inline-retry per stage) with nothing extra
    to reset first — see docs/CLAUDE.md's "Background processing" section for
    the full reasoning.
    """
    client = get_service_client()
    recording = _fetch_authorized_recording(client, recording_id, user_id)

    if recording["status"] != "failed":
        raise HTTPException(
            status_code=409,
            detail=f"Recording is '{recording['status']}', not 'failed' — nothing to regenerate.",
        )

    background_tasks.add_task(process_recording, recording_id)

    return {"id": recording_id}
