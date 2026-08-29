import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { QuestionMode } from '@/lib/questions';
import { supabase } from '@/lib/supabase';

const RECORDINGS_BUCKET = 'recordings-audio';

// The `recordings.mode` check constraint's full set of values (0001_initial_
// schema.sql) — QuestionMode ('interview' | 'story', src/lib/questions.ts)
// plus 'miscellaneous', which has no associated question. Exported so
// callers threading a selected mode through to uploadRecording() (Phase 4
// Step 3 — src/app/(tabs)/index.tsx) have one shared type instead of each
// redeclaring the same three literals.
export type RecordingMode = QuestionMode | 'miscellaneous';

// Mirrors MAX_RECORDINGS_PER_USER in backend/app/config.py — kept as a
// separate constant here for the same reason RECORDINGS_BUCKET above is:
// this frontend and the backend are separate projects with no shared module
// to import a constant from (see docs/CLAUDE.md's "Backend" section).
// Checked before a new recording starts (src/app/(tabs)/index.tsx —
// originally the record button in Phase 3 Step 3, relocated to the mode
// selection screen's `handleSelectMode` in Phase 4 Step 2, same file either
// way) and enforced again, independently, by a Postgres trigger
// (supabase/migrations/0004_recording_cap_enforcement.sql) as a safety
// net — see docs/CLAUDE.md's Recording cap section for why this one
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
// `audio_deleted` was added in Phase 3 Step 5 — the list needs to know
// whether a row still has audio to show/hide the delete action and (Step 6)
// the download action correctly per row. `audio_path` was added in Step 6 —
// the list needs the actual Storage path to download from, not just the
// boolean; the detail screen already selected it (`RecordingDetail` below).
// `question` was added in the Phase 4 Step 5 exit-checkpoint review — the
// detail screen already selected and stored it (`RecordingDetail` below,
// since Phase 3 Step 1) but neither screen actually rendered it, a gap left
// over from when every recording had `question: null` (pre-Phase-4). Now
// that Interview/Story carry a real chosen or custom-typed question (Phase
// 4 Steps 3-4), the list shows a one-line preview per row too, not just the
// detail screen.
// `title` was added in v2 Epic D Part 3 — the restyled list card shows it as
// each row's bold heading (nullable: null for recordings from before Part 1,
// or where generation returned nothing usable — the card falls back to
// "Untitled recording" then). The detail screen selects it via
// `RecordingDetail` below (Part 1/2).
export type RecordingRow = {
  id: string;
  mode: string;
  question: string | null;
  title: string | null;
  status: string;
  created_at: string;
  favorite: boolean;
  audio_deleted: boolean;
  audio_path: string | null;
};

export async function fetchRecordings(userId: string): Promise<RecordingRow[]> {
  const { data, error } = await supabase
    .from('recordings')
    .select('id, mode, question, title, status, created_at, favorite, audio_deleted, audio_path')
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
 * Saves a user-edited recording `title` (v2 Epic D Part 2).
 *
 * A direct Supabase update, not a backend endpoint — the same call the
 * favorite toggle makes (`setFavorite` above) and for the same reasons: RLS
 * ("Users can update their own recordings", 0001_initial_schema.sql) already
 * scopes the update to the calling user, and a title is a plain user-facing
 * label with no Gemini/Storage/other-service work and no logic attached to it
 * anywhere else in the app. Contrast `/process`, `/regenerate` and the audio
 * delete endpoint, which are all backend routes precisely because they touch
 * Gemini or do a Storage+DB pair that must not disagree — none of which
 * applies here. So a backend round-trip would only add latency.
 *
 * Also sets `title_edited_by_user: true` in the same write (v2 Epic D
 * Part 7, migration `0006_title_edited_by_user.sql`) — this is the ONLY
 * place a title is ever hand-set, so this is the one place that needs to
 * flip the flag. `process_recording` (backend/app/services/processing.py)
 * reads it and skips overwriting `title` on a later run (initial generation
 * or "Regenerate report") once it's true, so a user's hand-picked title
 * survives a regenerate instead of being silently replaced by a fresh
 * AI-generated one.
 *
 * The caller is responsible for trimming and rejecting an empty title before
 * calling this (see `history/[id].tsx`); this just writes what it's given.
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
//
// v3 Epic F Step 1: the recording DETAIL screen no longer displays these
// (the raw filler/WPM/repetition numbers were replaced by the three score
// badges — see `RecordingDetail` below), so `fetchRecordingById` stopped
// selecting `metrics`. The metrics still compute and store on every
// recording; this type stays for v3 Epic G, where Streaks → Clarity's
// detail screen surfaces them again as supporting badges (over the list
// query, which will widen for scores + metrics there).
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
  // v2 Epic D Part 1: auto-generated by the Gemini feedback call; null for
  // recordings from before that change or where generation returned nothing
  // usable. User-editable on the detail screen as of Part 2 — see
  // `updateRecordingTitle` above.
  title: string | null;
  transcript: string | null;
  feedback: string | null;
  // v3 Epic F Step 1: three 0-100 scores from the same Gemini feedback call,
  // shown as badges on the detail screen (Impact / Clarity / Structure, that
  // order). Null for a pre-v3 recording, or where generation returned nothing
  // usable for that one score (lenient — never fails the recording). Streaks
  // aggregation (Epic G) excludes any recording with a null score.
  impact_score: number | null;
  clarity_score: number | null;
  structure_score: number | null;
  // Not a displayed score — a Clarity grounding input the model assesses
  // itself. Selected here so Epic G's Clarity detail screen can show it.
  grammar_issue_count: number | null;
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
    .select(
      'id, mode, question, status, created_at, title, transcript, feedback, impact_score, clarity_score, structure_score, grammar_issue_count, audio_path, audio_deleted, favorite'
    )
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
 * Phase 3 Step 6 — downloads a recording's audio to a temp local file and
 * hands it to the native share sheet so the user can save/export it
 * wherever they want (Files app, AirDrop, Messages, etc.).
 *
 * Deliberately not a raw blob/data-URI download — per docs/PROJECT_PLAN.md's
 * approach, that pattern (works fine on web) is unreliable on iOS, which is
 * the only platform this app runs on via Expo Go (see docs/CLAUDE.md's
 * Conventions section). The reliable path is: get a signed Storage URL (the
 * same helper `AudioSection`'s playback already uses), download it to a
 * real file on-device with `expo-file-system`, then open the OS share sheet
 * on that local file with `expo-sharing` — the same two packages the
 * project plan calls for.
 *
 * The downloaded file goes in `Paths.cache`, not `Paths.document` — it only
 * needs to survive long enough for the share sheet to hand it off, and the
 * cache directory is the one the OS is allowed to reclaim under storage
 * pressure. It's named uniquely per call (`Date.now()`) so two downloads
 * fired close together (e.g. one per row, tapped quickly) can't collide on
 * the same path mid-flight, and it's deleted again once the share sheet
 * closes, whether or not anything was actually shared — no reason to
 * accumulate temp copies of already-uploaded audio in the cache.
 *
 * Cancelling the share sheet is NOT a failure worth surfacing: iOS's
 * `UIActivityViewController` (via `expo-sharing`'s native module) resolves
 * this same promise on a clean dismiss exactly the way it does on a
 * completed share — there is no separate "user cancelled" rejection to
 * catch. Only a genuine failure (no network, a bad/expired signed URL,
 * sharing unavailable on this device) throws here.
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
 * `mode`/`question` are threaded in by the caller as of Phase 4 Step 3 (see
 * src/app/(tabs)/index.tsx and src/lib/question-selection.ts) rather than
 * hardcoded here — miscellaneous still passes `question: null` (the only
 * combination the schema's check constraint allows without a question), and
 * interview/story pass the real selected question's text.
 */
export async function uploadRecording({
  userId,
  localUri,
  audioPath,
  mode,
  question,
}: {
  userId: string;
  localUri: string;
  /** Reuse a path from a previous failed attempt so retries overwrite rather than duplicate. */
  audioPath?: string;
  mode: RecordingMode;
  question: string | null;
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
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertError) {
    throw new RecordingUploadError('insert', insertError.message);
  }

  return { id: data.id as string, audioPath: path };
}
