import { supabase } from '@/lib/supabase';

const apiUrl = process.env.EXPO_PUBLIC_API_URL;

export class ProcessingRequestError extends Error {}

/**
 * Shared by `startProcessing` and `regenerateReport` — both are the same
 * shape of request (POST, bearer token, no body, expect 202) against
 * different paths on the same backend router
 * (`backend/app/routers/recordings.py`). Kept private; callers use the two
 * named exports below so call sites stay self-explanatory.
 */
async function postRecordingAction(recordingId: string, action: 'process' | 'regenerate'): Promise<void> {
  if (!apiUrl) {
    throw new ProcessingRequestError(
      'Missing EXPO_PUBLIC_API_URL. Copy .env.example to .env and set it, then restart the dev server.'
    );
  }

  const { data, error: sessionError } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (sessionError || !accessToken) {
    throw new ProcessingRequestError('No active session — cannot authorize the request.');
  }

  const response = await fetch(`${apiUrl}/recordings/${recordingId}/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ProcessingRequestError(`Backend rejected the ${action} request (${response.status}): ${body}`);
  }
}

/**
 * Kicks off backend processing for a recording that's already uploaded and
 * has a `recordings` row (see `uploadRecording` in `src/lib/recordings.ts`).
 *
 * Calls the FastAPI backend's `POST /recordings/{id}/process`
 * (`backend/app/routers/recordings.py`), sending the current Supabase
 * access token as a bearer token so the backend can verify who's asking.
 * The backend schedules the actual work as a `BackgroundTasks` call and
 * responds 202 immediately — this function returns as soon as that
 * acknowledgment arrives, not once processing is done. The full pipeline
 * (transcription, metrics, feedback) is real as of Phase 2 — see
 * `backend/app/services/processing.py`.
 */
export async function startProcessing(recordingId: string): Promise<void> {
  return postRecordingAction(recordingId, 'process');
}

/**
 * Phase 3 Step 2 — the manual "Regenerate report" action for a recording
 * that's `failed` even after the pipeline's own automatic inline retry (see
 * docs/CLAUDE.md's "Background processing" section). Calls
 * `POST /recordings/{id}/regenerate`, which only accepts a `failed`
 * recording (409 otherwise) and schedules the exact same background
 * pipeline as `startProcessing` above — same 202-immediately contract, same
 * "this function returns once the backend has accepted the request, not
 * once it's done" caveat. Unlike a fresh upload (which starts at `pending`
 * and only moves to `processing` once the background task actually picks it
 * up), `process_recording()` flips status straight to `processing` as its
 * first step regardless of entry point, so callers should expect
 * `failed` -> `processing` -> `done`/`failed` again, and should poll/refetch
 * to reflect that (see the History list and detail screen).
 */
export async function regenerateReport(recordingId: string): Promise<void> {
  return postRecordingAction(recordingId, 'regenerate');
}

/**
 * Phase 3 Step 5 — deletes a recording's audio (Storage file + the
 * `audio_deleted`/`audio_path` row fields), the actual mechanism that frees
 * a slot under `MAX_RECORDINGS_PER_USER` (see docs/CLAUDE.md's "Recording
 * cap" section).
 *
 * Calls `DELETE /recordings/{id}/audio` rather than doing this as two direct
 * Supabase calls (Storage delete + table update) the way `setFavorite`/
 * `getActiveRecordingCount` do — see the docstring on `delete_audio` in
 * `backend/app/routers/recordings.py` for the full reasoning: a Storage
 * delete and a DB update both need to happen here, and a partial failure
 * between two independent client calls would leave Storage and the DB
 * disagreeing with no clean way to retry. The backend owns getting that
 * ordering right and returns a single clear success/failure. No request
 * body, and no confirmation step before this is called (per an explicit
 * product decision — see docs/CLAUDE.md's History section) — the caller is
 * expected to invoke this the moment the user taps delete, not after an
 * "are you sure?" prompt.
 */
export async function deleteRecordingAudio(recordingId: string): Promise<void> {
  if (!apiUrl) {
    throw new ProcessingRequestError(
      'Missing EXPO_PUBLIC_API_URL. Copy .env.example to .env and set it, then restart the dev server.'
    );
  }

  const { data, error: sessionError } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (sessionError || !accessToken) {
    throw new ProcessingRequestError('No active session — cannot authorize the request.');
  }

  const response = await fetch(`${apiUrl}/recordings/${recordingId}/audio`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ProcessingRequestError(`Backend rejected the delete-audio request (${response.status}): ${body}`);
  }
}
