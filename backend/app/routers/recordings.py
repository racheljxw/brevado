"""
Endpoints the Expo app calls once it already owns a `recordings` row.

Upload and row creation happen entirely on the frontend, directly against
Supabase (see `src/lib/recordings.ts`). This router only covers what comes
after: kicking off processing, manually retrying it after a failure,
deleting a recording's audio, and permanently deleting a whole recording
(row + audio together).
"""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from postgrest.exceptions import APIError

from app.auth import get_current_user_id
from app.config import RECORDINGS_BUCKET
from app.services.processing import process_recording
from app.supabase_client import get_service_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recordings", tags=["recordings"])


def _fetch_authorized_recording(client, recording_id: str, user_id: str) -> dict:
    """Fetches `recording_id` and confirms it belongs to `user_id`.

    Shared by `/process`, `/regenerate`, and the audio-delete endpoint. A
    nonexistent recording and one that belongs to another user return the
    *same* 403 — a caller's token must not be able to tell those apart.
    Selects `audio_path`/`audio_deleted` too so the delete endpoint doesn't
    need a second round-trip.
    """
    try:
        result = (
            client.table("recordings")
            .select("id, user_id, status, audio_path, audio_deleted")
            .eq("id", recording_id)
            .maybe_single()
            .execute()
        )
    except APIError:
        # Most commonly a malformed (non-UUID) recording_id. Same 403 as a
        # genuine no-match, deliberately.
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

    # Runs after this response is sent — see app/services/processing.py.
    background_tasks.add_task(process_recording, recording_id)

    return {"id": recording_id}


@router.post("/{recording_id}/regenerate", status_code=202)
def regenerate_report(
    recording_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, str]:
    """The manual "Regenerate report" action for a recording that's still
    `failed` after the pipeline's automatic inline retry.

    Only valid from `failed` (the mirror image of `/process`, which is only
    valid from `pending`); anything else 409s. Schedules the exact same
    `process_recording()` pipeline — no separate code path. That function
    flips status back to `processing` first and overwrites
    transcript/metrics/feedback as each stage completes, so a fresh call is a
    clean full re-attempt with nothing to reset first.
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


@router.delete("/{recording_id}/audio", status_code=200)
def delete_audio(
    recording_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, bool]:
    """Delete a recording's audio file but keep the row (transcript, feedback
    and metrics survive). This is what frees a cap slot: the active-recording
    count only counts rows with `audio_deleted = false`.
    """
    client = get_service_client()
    recording = _fetch_authorized_recording(client, recording_id, user_id)

    if recording.get("audio_deleted"):
        return {"audio_deleted": True}

    audio_path = recording.get("audio_path")
    if audio_path:
        try:
            client.storage.from_(RECORDINGS_BUCKET).remove([audio_path])
        except Exception as exc:
            logger.error(
                "delete_audio: failed to delete '%s' from Storage for recording %s: %s",
                audio_path,
                recording_id,
                exc,
            )
            raise HTTPException(status_code=502, detail="Could not delete audio from storage. Try again.")

    client.table("recordings").update({"audio_deleted": True, "audio_path": None}).eq("id", recording_id).execute()

    return {"audio_deleted": True}


@router.delete("/{recording_id}", status_code=200)
def delete_recording(
    recording_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, bool]:
    """Permanently delete a whole recording: its Storage audio file (if it
    still has one) AND the `recordings` row itself. Irreversible — the
    frontend gates it behind a confirmation dialog.

    A backend endpoint rather than a direct client call for the same reason
    as `delete_audio`: a Storage delete and a DB write both have to happen
    and must not disagree, and the `recordings-audio` bucket has no
    client-side delete RLS policy. The row delete uses the service-role
    client (which bypasses RLS), so no `recordings` DELETE RLS policy exists.

    Idempotent: once the row is gone, a repeat call returns success rather
    than erroring. A row belonging to another user still returns 403.
    """
    client = get_service_client()

    try:
        result = (
            client.table("recordings")
            .select("id, user_id, audio_path, audio_deleted")
            .eq("id", recording_id)
            .maybe_single()
            .execute()
        )
        recording = None if result is None else result.data
    except APIError:
        # Malformed (non-UUID) id, or a no-rows response on some postgrest
        # versions. Treat as already-gone rather than leaking whether the id
        # is real.
        return {"deleted": True}

    if recording is None:
        return {"deleted": True}

    if recording["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not authorized for this recording.")

    audio_path = recording.get("audio_path")
    if not recording.get("audio_deleted") and audio_path:
        try:
            client.storage.from_(RECORDINGS_BUCKET).remove([audio_path])
        except Exception as exc:
            logger.error(
                "delete_recording: failed to delete audio '%s' from Storage for recording %s: %s",
                audio_path,
                recording_id,
                exc,
            )
            raise HTTPException(status_code=502, detail="Could not delete audio from storage. Try again.")

    client.table("recordings").delete().eq("id", recording_id).execute()

    return {"deleted": True}
