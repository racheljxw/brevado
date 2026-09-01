import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { supabase } from '@/lib/supabase';

const RECORDINGS_BUCKET = 'recordings-audio';

// The full set of values allowed by the `recordings.mode` check constraint.
// 'interview' / 'story' have a curated question pool + a daily question;
// 'miscellaneous' is free-topic with no question.
export type RecordingMode = 'interview' | 'story' | 'miscellaneous';

// Duplicated as MAX_RECORDINGS_PER_USER in backend/app/config.py and again in
// the cap-enforcement migration — the frontend, backend and Postgres can't
// share a constant. Checked before a new recording starts, and enforced
// independently by a Postgres trigger as a backstop. If it changes, update
// all three.
export const MAX_RECORDINGS_PER_USER = 30;

const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  m4a: 'audio/m4a',
  caf: 'audio/x-caf',
  wav: 'audio/wav',
  '3gp': 'audio/3gpp',
};

// Which step of uploadRecording() failed, so the UI can explain what's being
// retried — and, for 'insert', that the audio itself is already safely stored.
export type RecordingUploadStage = 'upload' | 'insert';

export class RecordingUploadError extends Error {
  stage: RecordingUploadStage;

  constructor(stage: RecordingUploadStage, message: string) {
    super(message);
    this.name = 'RecordingUploadError';
    this.stage = stage;
  }
}

// The columns the History list and the Streaks tab need. The Streaks tab has
// no query of its own — it aggregates the score / metrics columns client-side
// over this same fetch, which is why they're selected here even though the
// History screens don't read them. The detail screens use their own wider
// queries (`RECORDING_DETAIL_COLUMNS` below) rather than growing this one.
//
// Nullable score/metrics fields: an older recording, or one where a given
// score missed generation, stays null and is excluded from every Streaks
// aggregation.
export type RecordingRow = {
  id: string;
  mode: string;
  question: string | null;
  // The `questions` pool row this recording answered. Null for custom-typed
  // questions and miscellaneous. Read by History's "Re-practice this question"
  // so the new attempt can carry the same pool question_id.
  question_id: string | null;
  title: string | null;
  // Set on a re-practice recording's upload — the id of the recording its
  // 3-dot menu was opened from. Read by `buildChains`
  // (src/lib/re-practice-chains.ts) to group a question's attempts into one
  // History list card. Null for every normal recording.
  re_practice_of: string | null;
  status: string;
  created_at: string;
  favorite: boolean;
  audio_deleted: boolean;
  audio_path: string | null;
  impact_score: number | null;
  clarity_score: number | null;
  structure_score: number | null;
  grammar_issue_count: number | null;
  metrics: RecordingMetrics | null;
};

// Whether History's 3-dot menu should offer "Re-practice this question":
// Interview/Story only (never Miscellaneous), and only when there's a question
// to re-practice — a pool `question_id` or custom `question` text.
export function canRePracticeRecording(recording: {
  mode: string;
  question: string | null;
  question_id: string | null;
}): boolean {
  const modeHasQuestions = recording.mode === 'interview' || recording.mode === 'story';
  return modeHasQuestions && (!!recording.question || !!recording.question_id);
}

// The params the Record screen (src/app/(tabs)/index.tsx) reads to enter its
// read-only "re-practice" state. Shared by the History list and detail 3-dot
// menus so both hand the Record screen the same shape. `rpTs` is a nonce so
// re-practicing the same recording twice in a row still re-triggers the
// consume effect (which dedupes on it).
export function rePracticeNavParams(recording: {
  id: string;
  mode: string;
  question: string | null;
  question_id: string | null;
}): Record<string, string> {
  return {
    rpSource: recording.id,
    rpMode: recording.mode,
    rpQuestion: recording.question ?? '',
    rpQuestionId: recording.question_id ?? '',
    rpTs: String(Date.now()),
  };
}

export async function fetchRecordings(userId: string): Promise<RecordingRow[]> {
  const { data, error } = await supabase
    .from('recordings')
    .select(
      'id, mode, question, question_id, title, re_practice_of, status, created_at, favorite, audio_deleted, audio_path, impact_score, clarity_score, structure_score, grammar_issue_count, metrics'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    throw error;
  }
  return data ?? [];
}

/**
 * Toggles the `favorite` marker on a single recording.
 *
 * A direct Supabase update rather than a backend endpoint: RLS already scopes
 * it to the calling user, and `favorite` is a personal marker with no
 * Gemini/Storage work and no logic attached elsewhere, so a round-trip
 * through the backend would only add latency.
 */
export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  const { error } = await supabase.from('recordings').update({ favorite }).eq('id', id);
  if (error) {
    throw error;
  }
}

/**
 * Saves a user-edited recording `title`. A direct Supabase update, for the
 * same reasons as `setFavorite` above.
 *
 * Also sets `title_edited_by_user: true` in the same write — this is the only
 * place a title is ever hand-set. `process_recording`
 * (backend/app/services/processing.py) reads that flag and skips overwriting
 * `title` on a later run, so a hand-picked title survives a "Regenerate
 * report" instead of being replaced by a fresh AI-generated one.
 *
 * The caller trims and rejects an empty title before calling this; this just
 * writes what it's given.
 */
export async function updateRecordingTitle(id: string, title: string): Promise<void> {
  const { error } = await supabase
    .from('recordings')
    .update({ title, title_edited_by_user: true })
    .eq('id', id);
  if (error) {
    throw error;
  }
}

/**
 * Counts the current user's recordings that still count against the cap
 * (`audio_deleted = false`) — see `MAX_RECORDINGS_PER_USER` above.
 *
 * A direct Supabase query rather than a backend endpoint: RLS already scopes
 * it to the calling user. `head: true` returns just the count, not the rows.
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

// Shape stored in `recordings.metrics`. `words_per_minute` can be null when
// the audio duration couldn't be read. Not shown on the recording detail
// screen (the score badges replaced the raw numbers there); surfaced only on
// the Streaks → Clarity detail screen as windowed supporting badges.
export type RecordingMetrics = {
  filler_word_rate: number | null;
  words_per_minute: number | null;
  repetition_count: number | null;
  word_count: number | null;
};

// The full row for the detail screens — everything `RecordingRow` has plus
// transcript / feedback and the fields the list view doesn't need.
export type RecordingDetail = {
  id: string;
  mode: string;
  question: string | null;
  question_id: string | null;
  // The recording this is a re-practice of (null for a normal recording).
  // Selected so the chain detail screen can re-run `buildChains` over the
  // member details after a per-panel deletion.
  re_practice_of: string | null;
  status: string;
  created_at: string;
  // Auto-generated by the Gemini feedback call; null for older recordings or
  // where generation returned nothing usable. User-editable — see
  // `updateRecordingTitle` above.
  title: string | null;
  transcript: string | null;
  // A 1-2 sentence overview for newer recordings; the full original prose
  // block for ones generated before feedback was split into summary + lists.
  // `RecordingDetailBody` picks which way to render based on the two fields
  // below.
  feedback: string | null;
  // Distinct prose points. Null when generation returned nothing usable, and
  // always null for a legacy recording — that's the signal to fall back to
  // rendering `feedback` as one block.
  feedback_strengths: string[] | null;
  feedback_improvements: string[] | null;
  // Three 0-100 scores from the Gemini feedback call, shown as badges on the
  // detail screen. Null for an older recording or a score that missed
  // generation.
  impact_score: number | null;
  clarity_score: number | null;
  structure_score: number | null;
  // Not a displayed score — a Clarity grounding input the model assesses
  // itself. Selected so the Streaks → Clarity detail screen can show it.
  grammar_issue_count: number | null;
  audio_path: string | null;
  audio_deleted: boolean;
  favorite: boolean;
};

/**
 * Fetches a single recording by id for the detail screen.
 *
 * Doesn't filter by `user_id` — RLS already scopes the select to `auth.uid()`,
 * so a bad id and someone else's id both come back as no row, which
 * `maybeSingle()` surfaces as `null`. That gives the not-found screen for free.
 */
const RECORDING_DETAIL_COLUMNS =
  'id, mode, question, question_id, re_practice_of, status, created_at, title, transcript, feedback, feedback_strengths, feedback_improvements, impact_score, clarity_score, structure_score, grammar_issue_count, audio_path, audio_deleted, favorite';

export async function fetchRecordingById(id: string): Promise<RecordingDetail | null> {
  const { data, error } = await supabase
    .from('recordings')
    .select(RECORDING_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

/**
 * Full detail rows for a set of recording ids, for the re-practice chain
 * detail screen — one `.in('id', …)` query rather than N `fetchRecordingById`
 * calls. RLS scopes it to the caller, so an id that isn't theirs (or no
 * longer exists) simply doesn't come back; the caller treats a shrunken
 * result as members deleted elsewhere. Order isn't guaranteed; the caller
 * sorts.
 */
export async function fetchRecordingDetailsByIds(ids: string[]): Promise<RecordingDetail[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('recordings')
    .select(RECORDING_DETAIL_COLUMNS)
    .in('id', ids);
  if (error) {
    throw error;
  }
  return data ?? [];
}

/**
 * Signed, time-limited URL for playing back a recording's audio from the
 * private `recordings-audio` bucket. Storage RLS means this only succeeds for
 * the calling user's own files.
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
// user id — the rest is a timestamp, so naming the file doesn't need a
// pre-existing recording id.
export function buildAudioPath(userId: string, localUri: string): string {
  return `${userId}/${Date.now()}.${extensionOf(localUri)}`;
}

/**
 * Downloads a recording's audio to a temp local file and hands it to the
 * native share sheet so the user can save/export it (Files app, AirDrop,
 * Messages, etc.).
 *
 * Not a raw blob/data-URI download — that pattern is unreliable on iOS. The
 * reliable path is: get a signed Storage URL, download it to a real
 * on-device file with `expo-file-system`, then open the OS share sheet on
 * that file with `expo-sharing`.
 *
 * The temp file goes in `Paths.cache` (which the OS may reclaim under
 * storage pressure — fine, it only needs to outlive the share sheet), is
 * named uniquely per call so concurrent downloads can't collide, and is
 * deleted once the share sheet closes whether or not anything was shared.
 *
 * Cancelling the share sheet is not a failure worth surfacing: `expo-sharing`
 * resolves this promise the same way on a clean dismiss as on a completed
 * share. Only a genuine failure (no network, a bad signed URL, sharing
 * unavailable) throws.
 */
export async function shareRecordingAudio(audioPath: string): Promise<void> {
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error("Sharing isn't available on this device.");
  }

  const url = await getRecordingAudioUrl(audioPath);
  const extension = extensionOf(audioPath);
  const destination = new File(Paths.cache, `brevado-recording-${Date.now()}.${extension}`);

  const downloaded = await File.downloadFileAsync(url, destination, { idempotent: true });
  try {
    await Sharing.shareAsync(downloaded.uri, {
      mimeType: CONTENT_TYPES_BY_EXTENSION[extension] ?? 'application/octet-stream',
      dialogTitle: 'Save recording',
    });
  } finally {
    try {
      downloaded.delete();
    } catch {
      // Best-effort cleanup only — a leftover cache file isn't worth
      // surfacing an error over, and the OS can reclaim Paths.cache under
      // storage pressure regardless.
    }
  }
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
 *
 * `mode`/`question`/`questionId` are threaded in by the caller. Miscellaneous
 * passes `question: null`. For interview/story: a pool question from
 * `GET /questions/daily` passes both its `text` and its `questions` row id as
 * `questionId` (→ `recordings.question_id`); a custom typed-in question passes
 * only `question` text and leaves `questionId` null.
 *
 * `rePracticeOf` is the id of the original recording a re-practice attempt was
 * launched from (→ `recordings.re_practice_of`). It always points at the
 * recording the user tapped from, never a further-back ancestor — walking the
 * chain to a root is `buildChains`' job. Null for a normal recording.
 */
export async function uploadRecording({
  userId,
  localUri,
  audioPath,
  mode,
  question,
  questionId = null,
  rePracticeOf = null,
}: {
  userId: string;
  localUri: string;
  /** Reuse a path from a previous failed attempt so retries overwrite rather than duplicate. */
  audioPath?: string;
  mode: RecordingMode;
  question: string | null;
  /** The `questions` row id, when the question came from the daily-question pool. Null for custom / miscellaneous. */
  questionId?: string | null;
  /** The original recording this is a re-practice of. Null otherwise. */
  rePracticeOf?: string | null;
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
      mode,
      question,
      question_id: questionId,
      re_practice_of: rePracticeOf,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertError) {
    throw new RecordingUploadError('insert', insertError.message);
  }

  return { id: data.id as string, audioPath: path };
}
