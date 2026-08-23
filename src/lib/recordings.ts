import { File } from 'expo-file-system';

import { supabase } from '@/lib/supabase';

const RECORDINGS_BUCKET = 'recordings-audio';

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
