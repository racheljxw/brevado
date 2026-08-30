import { supabase } from '@/lib/supabase';

const apiUrl = process.env.EXPO_PUBLIC_API_URL;

export class ProcessingRequestError extends Error {}

/**
 * Shared by every backend `recordings` call in this module — `startProcessing`
 * / `regenerateReport` (POST, expect 202), `deleteRecordingAudio` and
 * `deleteRecording` (DELETE, expect 200). All are the same shape: a
 * bearer-token request with no body against a path on the same backend router
 * (`backend/app/routers/recordings.py`). Kept private; callers use the named
 * exports below so call sites stay self-explanatory.
 */
function requireApiUrl(): string {
  if (!apiUrl) {
    throw new ProcessingRequestError(
      'Missing EXPO_PUBLIC_API_URL. Copy .env.example to .env and set it, then restart the dev server.'
    );
  }
  return apiUrl;
}

async function requireAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) {
    throw new ProcessingRequestError('No active session — cannot authorize the request.');
  }
  return accessToken;
}

async function authorizedRecordingRequest(
  path: string,
  method: 'POST' | 'DELETE',
  actionLabel: string
): Promise<void> {
  const base = requireApiUrl();
  const accessToken = await requireAccessToken();

  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ProcessingRequestError(`Backend rejected the ${actionLabel} request (${response.status}): ${body}`);
  }
}

/**
 * v4 Epic H Step 2 — the one shared "question of the day" for a mode, from the
 * FastAPI backend's `GET /questions/daily?mode=interview|story`
 * (`backend/app/routers/questions.py` → `app/services/daily_questions.py`).
 *
 * This replaces v1's client-side `pickQuestionForMode` (deleted): the question
 * is now assigned server-side, identical for every user that day, and a pool
 * question is retired the instant it's assigned so it never repeats. The
 * returned `id` is the `questions` row's PK — the caller stores it as
 * `recordings.question_id` alongside the text so History (Epic I) can group
 * re-practice attempts. Custom typed-in questions have no `id` and store
 * `question_id: null`.
 *
 * Bearer-token auth like the `recordings` calls, but no ownership check on the
 * backend — the data isn't user-specific. A `502` here is almost always a
 * transient Gemini failure during a rare pool top-up; the screen surfaces the
 * message with a "Try again".
 */
export type DailyQuestion = { id: string; mode: string; text: string };

export async function fetchDailyQuestion(mode: 'interview' | 'story'): Promise<DailyQuestion> {
  const base = requireApiUrl();
  const accessToken = await requireAccessToken();

  const response = await fetch(`${base}/questions/daily?mode=${encodeURIComponent(mode)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ProcessingRequestError(
      `Couldn't load today's question (${response.status}): ${body}`
    );
  }

  return (await response.json()) as DailyQuestion;
}

function postRecordingAction(recordingId: string, action: 'process' | 'regenerate'): Promise<void> {
  return authorizedRecordingRequest(`/recordings/${recordingId}/${action}`, 'POST', action);
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
  return authorizedRecordingRequest(`/recordings/${recordingId}/audio`, 'DELETE', 'delete-audio');
}

/**
 * v2 Epic D Part 4 — permanently deletes a whole recording: the `recordings`
 * row AND its Storage audio file, together. Stronger and more destructive
 * than `deleteRecordingAudio` above, which keeps the row (and its
 * transcript/feedback/metrics) and only clears the audio file.
 *
 * Calls `DELETE /recordings/{id}` — a backend endpoint, not a direct Supabase
 * call, for the same reason as `deleteRecordingAudio`: a Storage delete + a
 * DB write both have to happen and must not disagree, and Storage has no
 * client-side delete policy (see the `delete_recording` docstring in
 * `backend/app/routers/recordings.py`). The endpoint is idempotent — calling
 * it again once the row is gone returns success, not an error.
 *
 * Unlike `deleteRecordingAudio`, the UI DOES gate this behind a confirmation
 * dialog (in `RecordingActionsMenu`) — losing the transcript/feedback/metrics
 * permanently is a meaningfully bigger, irreversible loss than losing just
 * the re-exportable audio file, so a stray menu tap shouldn't be enough.
 */
export async function deleteRecording(recordingId: string): Promise<void> {
  return authorizedRecordingRequest(`/recordings/${recordingId}`, 'DELETE', 'delete-recording');
}
