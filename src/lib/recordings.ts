import { File } from 'expo-file-system';

import { supabase } from '@/lib/supabase';

const RECORDINGS_BUCKET = 'recordings-audio';

// Mirrors MAX_RECORDINGS_PER_USER in backend/app/config.py — kept as a
// separate constant here for the same reason RECORDINGS_BUCKET above is:
// this frontend and the backend are separate projects with no shared module
// to import a constant from (see docs/CLAUDE.md's "Backend" section).
// Checked before a new recording starts (src/app/(tabs)/index.tsx, Phase 3
// Step 3) and enforced again, independently, by a Postgres trigger
// (supabase/migrations/0004_recording_cap_enforcement.sql) as a safety
// net — see docs/CLAUDE.md's Audio retention section for why this one
// number ends up duplicated in three places, and update all three if it
// ever changes.
export const MAX_RECORDINGS_PER_USER = 30;

const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  m4a: 'audio/m4a',
  caf: 'audio/x-caf',
  wav: 'audio/wav',
  '3gp': 'audio/3gpp',
};

// Which step of uploadRecording() failed, so the UI can explain what's being
// retried (and, for 'insert', know the audio itself is already safely stored).
export type RecordingUploadStage = 'upload' | 'insert';

export class RecordingUploadError extends Error {
  stage: RecordingUploadStage;

  constructor(stage: RecordingUploadStage, message: string) {
    super(message);
    this.name = 'RecordingUploadError';
    this.stage = stage;
  }
}

// Only the columns the Step 6 history list needs. Widen this (or select('*'))
// once Phase 3's detail view needs transcript/feedback/metrics too.
// `favorite` was added in Phase 3 Step 4 — the list needs it directly (not
// just the detail screen) since the star toggle now lives on both.
export type RecordingRow = {
  id: string;
  mode: string;
  status: string;
  created_at: string;
  favorite: boolean;
};

export async function fetchRecordings(userId: string): Promise<RecordingRow[]> {
  const { data, error } = await supabase
    .from('recordings')
    .select('id, mode, status, created_at, favorite')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    throw error;
  }
  return data ?? [];
}

/**
 * Toggles the `favorite` marker on a single recording (Phase 3 Step 4).
 *
 * A direct Supabase update, not a backend endpoint — same judgment call as
 * `getActiveRecordingCount` above: RLS ("Users can update their own
 * recordings", 0001_initial_schema.sql) already scopes this to the calling
 * user, there's no Gemini/Storage/other-service work involved (unlike
 * `/process` and `/regenerate`, which exist as backend endpoints precisely
 * *because* they kick off Gemini calls the backend holds the API key for),
 * and `favorite` is purely a personal marker with no logic attached to it
 * anywhere else in the app (see docs/CLAUDE.md's History section) — so a
 * backend round-trip would add latency without adding correctness or any
 * shared logic worth centralizing.
 */
export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  const { error } = await supabase.from('recordings').update({ favorite }).eq('id', id);
  if (error) {
    throw error;
  }
}

/**
 * Counts the current user's recordings that still count against the cap
 * (`audio_deleted = false`) — see `MAX_RECORDINGS_PER_USER` above.
 *
 * A direct Supabase query rather than a backend endpoint, deliberately: RLS
 * ("Users can view their own recordings", 0001_initial_schema.sql) already
 * scopes this correctly to the calling user, so there's nothing a backend
 * round-trip would add here beyond latency — see docs/CLAUDE.md's Audio
 * retention section for the fuller reasoning. `head: true` means Supabase
 * returns just the count, not the matching rows.
 */
export async function getActiveRecordingCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('recordings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('audio_deleted', false);
  if (error) {
    throw error;
  }
  return count ?? 0;
}

// Shape stored in `recordings.metrics` (Phase 2 Step 4) — see
// docs/CLAUDE.md's "Metrics" section for what each field means and why
// `words_per_minute` in particular can come back null.
export type RecordingMetrics = {
  filler_word_rate: number | null;
  words_per_minute: number | null;
  repetition_count: number | null;
  word_count: number | null;
};

// The full row, for the Phase 3 Step 1 detail screen — everything
// `RecordingRow` has plus the fields the list view doesn't need.
export type RecordingDetail = {
  id: string;
  mode: string;
  question: string | null;
  status: string;
  created_at: string;
  transcript: string | null;
  feedback: string | null;
  metrics: RecordingMetrics | null;
  audio_path: string | null;
  audio_deleted: boolean;
  favorite: boolean;
};

/**
 * Fetches a single recording by id for the detail screen.
 *
 * Deliberately doesn't filter by `user_id` itself — RLS ("Users can view
 * their own recordings", 0001_initial_schema.sql) already scopes the select
 * to `auth.uid()`, so a bad id and someone else's id both just come back as
 * no row, which `maybeSingle()` surfaces as `null` instead of throwing. That
 * gives the not-found screen for free rather than needing a second check.
 */
export async function fetchRecordingById(id: string): Promise<RecordingDetail | null> {
  const { data, error } = await supabase
    .from('recordings')
    .select('id, mode, question, status, created_at, transcript, feedback, metrics, audio_path, audio_deleted, favorite')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

/**
 * Signed, time-limited URL for playing back a recording's audio from the
 * private `recordings-audio` bucket. Storage RLS ("Users can read their own
 * audio files", 0002_storage_bucket.sql) means this only succeeds for the
 * calling user's own files, same as the table-level RLS above.
 */
export async function getRecordingAudioUrl(audioPath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .createSignedUrl(audioPath, 60 * 60); // 1 hour — comfortably longer than anyone spends on this screen
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? 'Could not create a playback link for this recording.');
  }
  return data.signedUrl;
}

function extensionOf(localUri: string): string {
  const match = localUri.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : 'm4a';
}

// Storage RLS only requires the first path segment to equal the uploader's
// user id (see supabase/migrations/0002_storage_bucket.sql) — the rest is a
// timestamp so we don't need a pre-existing recording id to name the file.
export function buildAudioPath(userId: string, localUri: string): string {
  return `${userId}/${Date.now()}.${extensionOf(localUri)}`;
}

/**
 * Uploads a locally-recorded audio file and creates its `recordings` row.
 *
 * Order of operations: upload to Storage first, then insert the DB row with
 * the resulting path. This is deliberate — a `recordings` row is only ever
 * created for audio that's already durably stored, so a failed/interrupted
 * upload can never leave a stray "pending" row with no audio behind it. The
 * one edge case this doesn't cover is the upload succeeding but the insert
 * itself failing (e.g. connection drops in between): that leaves an
 * orphaned file in Storage with no DB row pointing at it. That's the
 * accepted tradeoff — an untracked file some day cleaned up manually beats a
 * broken row a user can see. Passing back the same `audioPath` on retry (the
 * caller keeps it in state) means a retry after either failure overwrites
 * that same object instead of accumulating new ones.
 */
export async function uploadRecording({
  userId,
  localUri,
  audioPath,
}: {
  userId: string;
  localUri: string;
  /** Reuse a path from a previous failed attempt so retries overwrite rather than duplicate. */
  audioPath?: string;
}): Promise<{ id: string; audioPath: string }> {
  const path = audioPath ?? buildAudioPath(userId, localUri);

  const file = new File(localUri);
  const bytes = await file.bytes();

  const { error: uploadError } = await supabase.storage.from(RECORDINGS_BUCKET).upload(path, bytes, {
    contentType: CONTENT_TYPES_BY_EXTENSION[extensionOf(localUri)] ?? 'application/octet-stream',
    upsert: true,
  });
  if (uploadError) {
    throw new RecordingUploadError('upload', uploadError.message);
  }

  const { data, error: insertError } = await supabase
    .from('recordings')
    .insert({
      user_id: userId,
      audio_path: path,
      // Mode/question selection is Phase 4 — miscellaneous + no question is
      // the only combination the schema allows without that UI yet.
      mode: 'miscellaneous',
      question: null,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertError) {
    throw new RecordingUploadError('insert', insertError.message);
  }

  return { id: data.id as string, audioPath: path };
}
