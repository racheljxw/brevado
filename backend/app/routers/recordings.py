"""
Endpoints the Expo app calls once it already owns a `recordings` row.

As of Phase 2 Step 2, upload + row creation still happen entirely on the
frontend, directly against Supabase (see `src/lib/recordings.ts`) — this
router only covers what comes after that: kicking off processing, (as of
Phase 3 Step 2) manually retrying it after a failure, (as of Phase 3
Step 5) manually deleting a recording's audio, and (as of v2 Epic D
Part 4) permanently deleting a whole recording (row + audio together). See
docs/CLAUDE.md's "AI processing endpoint" and "Background processing"
sections for the full picture.
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

    Shared by `/process`, `/regenerate`, and the audio-delete endpoint so all
    three give a caller an identical, indistinguishable 403 whether the
    recording doesn't exist at all or exists but belongs to someone else — a
    token for one user should never be able to tell those two cases apart
    from the response. Selects `audio_path`/`audio_deleted` too (unused by
    `/process` and `/regenerate`, but cheap to include) so the delete
    endpoint below doesn't need a second round-trip just to get them.
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


@router.delete("/{recording_id}/audio", status_code=200)
def delete_audio(
    recording_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, bool]:
    """Manual audio delete, the actual mechanism that frees a
    cap slot (see docs/CLAUDE.md's "Recording cap" section — `getActiveRecordingCount`
    counts `audio_deleted = false` rows, so this is what makes that count drop).
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
    """v2 Epic D Part 4 — permanently delete a whole recording: its Storage
    audio file (if it still has one) AND the `recordings` row itself, together.

    Stronger than `DELETE /{id}/audio` (which keeps the row and only clears the
    audio, so the transcript/feedback/metrics survive): this removes
    everything, irreversibly. The frontend gates it behind a confirmation
    dialog for that reason — see docs/CLAUDE.md's History section.

    Why a backend endpoint and not a direct Supabase call from the client —
    the same reasoning as `delete_audio` above: a Storage delete and a DB
    write both have to happen and must not end up disagreeing, and the
    `recordings-audio` bucket has no client-side delete RLS policy
    (0002_storage_bucket.sql). The row delete here uses the service-role
    client, which bypasses RLS, so **no new `recordings` DELETE RLS policy is
    needed** (and none was added — the app never deletes a row from the
    client; 0001's "add one deliberately later" note is satisfied by routing
    deletion through this trusted endpoint instead).

    Recording cap: nothing special to do. Both the frontend pre-check
    (`getActiveRecordingCount`, src/lib/recordings.ts) and the Postgres
    backstop trigger (`enforce_recording_cap()`,
    0004_recording_cap_enforcement.sql) count rows where
    `audio_deleted = false` — a row that no longer exists simply isn't
    counted, so deleting it frees a cap slot for free, exactly as clearing
    `audio_deleted` does. No decrement, no bookkeeping.

    Idempotent (the "already deleted" double-tap case, same spirit as
    `delete_audio`'s early-return): once the row is gone a repeat call just
    returns success rather than erroring. A row that exists but belongs to
    someone else still returns 403.
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
        # versions — either way there's nothing to act on. Treat as
        # already-gone rather than leaking whether the id is real.
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
