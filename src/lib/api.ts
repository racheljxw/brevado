import { supabase } from '@/lib/supabase';

const apiUrl = process.env.EXPO_PUBLIC_API_URL;

export class ProcessingRequestError extends Error {}

/**
 * Kicks off backend processing for a recording that's already uploaded and
 * has a `recordings` row (see `uploadRecording` in `src/lib/recordings.ts`).
 *
 * Calls the FastAPI backend's `POST /recordings/{id}/process`
 * (`backend/app/routers/recordings.py`), sending the current Supabase
 * access token as a bearer token so the backend can verify who's asking.
 * The backend schedules the actual work as a `BackgroundTasks` call and
 * responds 202 immediately — this function returns as soon as that
 * acknowledgment arrives, not once processing is done. As of Phase 2 Step 2
 * the work itself is a stub (see `backend/app/services/processing.py`).
 */
export async function startProcessing(recordingId: string): Promise<void> {
  if (!apiUrl) {
    throw new ProcessingRequestError(
      'Missing EXPO_PUBLIC_API_URL. Copy .env.example to .env and set it, then restart the dev server.'
    );
  }

  const { data, error: sessionError } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (sessionError || !accessToken) {
    throw new ProcessingRequestError('No active session — cannot authorize the processing request.');
  }

  const response = await fetch(`${apiUrl}/recordings/${recordingId}/process`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ProcessingRequestError(`Backend rejected the processing request (${response.status}): ${body}`);
  }
}
