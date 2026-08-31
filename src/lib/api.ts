import { supabase } from '@/lib/supabase';

const apiUrl = process.env.EXPO_PUBLIC_API_URL;

export class ProcessingRequestError extends Error {}

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

/**
 * Shared by every backend `recordings` call in this module: a bearer-token
 * request with no body against a path on the backend's recordings router.
 */
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
 * The one shared "question of the day" for a mode, from the backend's
 * `GET /questions/daily?mode=interview|story`. Assigned server-side, identical
 * for every user that day, and retired the instant it's assigned so it never
 * repeats.
 *
 * The returned `id` is the `questions` row's PK — the caller stores it as
 * `recordings.question_id` alongside the text. A `502` is almost always a
 * transient Gemini failure during a rare pool top-up; the screen shows the
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
 * has a `recordings` row. The backend schedules the work as a background task
 * and responds 202 immediately — this function returns once that
 * acknowledgment arrives, not once processing is done. Poll the row's status
 * to see it finish.
 */
export async function startProcessing(recordingId: string): Promise<void> {
  return postRecordingAction(recordingId, 'process');
}

/**
 * The manual "Regenerate report" action for a recording that's `failed` even
 * after the pipeline's own automatic inline retry. Calls
 * `POST /recordings/{id}/regenerate`, which only accepts a `failed` recording
 * (409 otherwise) and schedules the same background pipeline as
 * `startProcessing`. Status goes `failed` -> `processing` -> `done`/`failed`;
 * callers should poll to reflect that.
 */
export async function regenerateReport(recordingId: string): Promise<void> {
  return postRecordingAction(recordingId, 'regenerate');
}

/**
 * Deletes a recording's audio (Storage file + the `audio_deleted`/`audio_path`
 * row fields) while keeping the row. This is what frees a slot under
 * `MAX_RECORDINGS_PER_USER`.
 *
 * A backend endpoint rather than two direct Supabase calls: a Storage delete
 * and a DB update both have to happen, and a partial failure between two
 * independent client calls would leave them disagreeing with no clean retry.
 * No confirmation prompt — the caller invokes this the moment the user taps
 * delete.
 */
export async function deleteRecordingAudio(recordingId: string): Promise<void> {
  return authorizedRecordingRequest(`/recordings/${recordingId}/audio`, 'DELETE', 'delete-audio');
}

/**
 * Permanently deletes a whole recording: the `recordings` row AND its Storage
 * audio file. More destructive than `deleteRecordingAudio`, which keeps the
 * row (and its transcript/feedback/metrics). Idempotent — calling it again
 * once the row is gone returns success.
 *
 * Unlike `deleteRecordingAudio`, the UI gates this behind a confirmation
 * dialog (in `RecordingActionsMenu`): losing the transcript/feedback/metrics
 * is a bigger, irreversible loss than losing the re-exportable audio file.
 */
export async function deleteRecording(recordingId: string): Promise<void> {
  return authorizedRecordingRequest(`/recordings/${recordingId}`, 'DELETE', 'delete-recording');
}
