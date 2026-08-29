import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioPlaybackControls } from '@/components/audio-playback-controls';
import { Card } from '@/components/card';
import { FavoriteStar } from '@/components/favorite-star';
import { RecordingActionsMenu, type RecordingMenuAction } from '@/components/recording-actions-menu';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing, Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteRecording, deleteRecordingAudio, regenerateReport } from '@/lib/api';
import { formatRecordedAt } from '@/lib/format-time';
import { formatMode } from '@/lib/modes';
import { getStatusPresentation, TERMINAL_STATUSES } from '@/lib/recording-status';
import {
  fetchRecordingById,
  getRecordingAudioUrl,
  setFavorite,
  shareRecordingAudio,
  updateRecordingTitle,
  type RecordingDetail,
  type RecordingMetrics,
} from '@/lib/recordings';

type ScreenState = 'loading' | 'not-found' | 'error' | 'loaded';
type AudioState = 'idle' | 'loading' | 'ready' | 'error';

// Turns the stored metrics shape (see docs/CLAUDE.md's "Metrics" section)
// into the display strings this screen shows — `filler_word_rate` is a
// fraction (0.08) that needs converting to a percentage here, and any field
// can individually be null (most commonly `words_per_minute`, when audio
// duration couldn't be read — see the "Failure handling" bullet there).
function formatMetrics(metrics: RecordingMetrics | null) {
  if (!metrics) return null;
  return {
    fillerRate: metrics.filler_word_rate != null ? `${Math.round(metrics.filler_word_rate * 100)}%` : '—',
    wordsPerMinute: metrics.words_per_minute != null ? `${metrics.words_per_minute} wpm` : '—',
    repetitionCount: metrics.repetition_count != null ? `${metrics.repetition_count}` : '—',
  };
}

function BackLink() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.back()} hitSlop={8}>
      <ThemedText type="link">‹ Back to History</ThemedText>
    </Pressable>
  );
}

// v2 Epic D Part 2 — inline title editing. Mirrors the custom-question
// pencil-edit in `src/app/(tabs)/index.tsx`'s `QuestionArea` (Epic C Part 3):
// display state = the text + a pencil; tapping the pencil opens a bordered
// input box (Theme tokens, icon submit) pre-filled with the current value;
// confirm saves, "Cancel" reverts. That pattern isn't extracted into a shared
// component (it lives inline in `QuestionArea`), so this mirrors its
// behaviour rather than importing it.
//
// `title` is nullable — a recording from before Part 1, or one where
// generation returned nothing usable. Editing then just starts from an empty
// field (display shows a muted "Untitled recording"), so a user can set a
// title on an older recording for the first time. Validation matches custom
// questions exactly: non-empty after trim, nothing else.
//
// The component owns the in-progress `draft` + its local validation error and
// whether the box is open (`editing`); the parent owns the persisted `title`
// and the async save (`saving` / `saveError`). `onSave` resolves `true` once
// the write has actually persisted, which is the signal to close the editor —
// so a failed save keeps the box open with the error shown, and the displayed
// title only ever changes after Supabase confirms.
function TitleSection({
  title,
  onSave,
  saving,
  saveError,
  onCancelEdit,
}: {
  title: string | null;
  onSave: (next: string) => Promise<boolean>;
  saving: boolean;
  saveError: string | null;
  onCancelEdit: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  function beginEditing() {
    setDraft(title ?? '');
    setDraftError(null);
    setEditing(true);
  }

  async function submitDraft() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraftError('Enter a title.');
      return;
    }
    setDraftError(null);
    const ok = await onSave(trimmed);
    if (ok) setEditing(false);
  }

  function cancelEditing() {
    setEditing(false);
    setDraft('');
    setDraftError(null);
    onCancelEdit();
  }

  if (editing) {
    return (
      <View style={styles.titleEditSection}>
        <View style={styles.titleInputBox}>
          <TextInput
            style={styles.titleInputField}
            placeholder="Recording title"
            placeholderTextColor="#56453D80"
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              if (draftError) setDraftError(null);
            }}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submitDraft}
            editable={!saving}
          />
          {saving ? (
            <ActivityIndicator style={styles.titleSubmit} color={Theme.colors.accent} />
          ) : (
            <Pressable
              onPress={submitDraft}
              hitSlop={8}
              style={({ pressed }) => [styles.titleSubmit, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Save title">
              <SymbolView name="arrow.up.circle.fill" size={26} tintColor={Theme.colors.accent} />
            </Pressable>
          )}
        </View>
        {(draftError || saveError) && (
          <ThemedText type="small" style={{ color: '#e5484d' }}>
            {draftError ?? saveError}
          </ThemedText>
        )}
        <Pressable
          onPress={cancelEditing}
          hitSlop={8}
          disabled={saving}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="link">Cancel</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.titleRow}>
      <ThemedText
        type="subtitle"
        themeColor={title ? 'text' : 'textSecondary'}
        style={styles.titleText}>
        {title ?? 'Untitled recording'}
      </ThemedText>
      <Pressable
        onPress={beginEditing}
        hitSlop={8}
        style={({ pressed }) => [styles.titleEditPencil, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Edit title">
        <SymbolView name="pencil" size={18} tintColor={Theme.colors.textSecondary} />
      </Pressable>
    </View>
  );
}

// Audio playback section: reused as-is regardless of the recording's
// `status` — audio finishes uploading (and the row is created) *before*
// backend processing ever starts, so it exists for a pending/processing/
// failed recording just as much as a done one. Only `audio_deleted` changes
// what this renders.
//
// v2 Epic D Part 4 — the "Download audio" / "Delete audio" rows that used to
// live here are gone; those actions (plus "Delete recording" and, when
// failed, "Regenerate report") now live in the header's `RecordingActionsMenu`.
// This section is purely playback again.
function AudioSection({ recording }: { recording: RecordingDetail }) {
  const theme = useTheme();
  const [audioState, setAudioState] = useState<AudioState>('idle');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const loadAudioUrl = useCallback(() => {
    if (!recording.audio_path) return;
    setAudioState('loading');
    setAudioError(null);
    getRecordingAudioUrl(recording.audio_path)
      .then((url) => {
        setAudioUrl(url);
        setAudioState('ready');
      })
      .catch((err) => {
        setAudioError(err instanceof Error ? err.message : 'Could not load audio.');
        setAudioState('error');
      });
  }, [recording.audio_path]);

  useEffect(() => {
    if (recording.audio_deleted || !recording.audio_path) return;
    loadAudioUrl();
  }, [recording.audio_deleted, recording.audio_path, loadAudioUrl]);

  if (recording.audio_deleted) {
    return (
      <Card style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          Audio deleted — this recording&apos;s audio file has been removed to free up space. Its transcript and
          feedback (below) aren&apos;t affected.
        </ThemedText>
      </Card>
    );
  }

  if (!recording.audio_path) {
    // Shouldn't happen — a row is only ever created after a successful
    // upload (see src/lib/recordings.ts) — but don't let a missing path
    // crash the screen.
    return (
      <Card style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          No audio is available for this recording.
        </ThemedText>
      </Card>
    );
  }

  if (audioState === 'loading' || audioState === 'idle') {
    return (
      <View style={styles.centerRow}>
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    );
  }

  if (audioState === 'error') {
    return (
      <Card style={styles.card}>
        <ThemedText type="small">{audioError ?? 'Could not load audio.'}</ThemedText>
        <Pressable onPress={loadAudioUrl}>
          <ThemedText type="link">Retry</ThemedText>
        </Pressable>
      </Card>
    );
  }

  return <AudioPlaybackControls uri={audioUrl!} />;
}

// The transcript/metrics/feedback section — only meaningful once the
// pipeline has actually run (see docs/CLAUDE.md's "AI processing endpoint"
// section). `failed` shows its own explanation instead (there's genuinely
// nothing to show — a transcription failure marks the row failed with
// nothing else attempted); `pending`/`processing` shows a plain "still
// working" notice since a row can be tapped into straight from History
// before the pipeline finishes.
function ReportSection({
  recording,
  onRegenerate,
  regenerating,
  regenerateError,
}: {
  recording: RecordingDetail;
  onRegenerate: () => void;
  regenerating: boolean;
  regenerateError: string | null;
}) {
  const theme = useTheme();

  if (recording.status === 'failed') {
    return (
      <Card style={styles.card}>
        <ThemedText type="smallBold" style={{ color: '#e5484d' }}>
          Processing failed
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          This recording has no transcript, metrics, or feedback — generating its report failed even after an
          automatic retry.
        </ThemedText>
        {regenerateError && (
          <ThemedText type="small" style={{ color: '#e5484d' }}>
            {regenerateError}
          </ThemedText>
        )}
        <Pressable
          style={({ pressed }) => [
            styles.regenerateButton,
            { borderColor: theme.text },
            (pressed || regenerating) && styles.pressed,
          ]}
          disabled={regenerating}
          onPress={onRegenerate}>
          {regenerating ? (
            <ActivityIndicator size="small" color={theme.text} />
          ) : (
            <ThemedText type="smallBold">Regenerate report</ThemedText>
          )}
        </Pressable>
      </Card>
    );
  }

  if (recording.status === 'pending' || recording.status === 'processing') {
    return (
      <Card style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          Still processing — transcript, metrics, and feedback will appear here once it&apos;s done.
        </ThemedText>
      </Card>
    );
  }

  const metrics = formatMetrics(recording.metrics);

  return (
    <>
      <View style={styles.section}>
        <ThemedText type="smallBold">Transcript</ThemedText>
        <ThemedText type="default">{recording.transcript ?? 'Not available.'}</ThemedText>
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Metrics</ThemedText>
        {metrics ? (
          <Card style={styles.card}>
            <View style={styles.metricRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Filler words
              </ThemedText>
              <ThemedText type="smallBold">{metrics.fillerRate}</ThemedText>
            </View>
            <View style={styles.metricRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Pace
              </ThemedText>
              <ThemedText type="smallBold">{metrics.wordsPerMinute}</ThemedText>
            </View>
            <View style={styles.metricRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Repetitions
              </ThemedText>
              <ThemedText type="smallBold">{metrics.repetitionCount}</ThemedText>
            </View>
          </Card>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Not available.
          </ThemedText>
        )}
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Feedback</ThemedText>
        <ThemedText type="default">{recording.feedback ?? 'Not available.'}</ThemedText>
      </View>
    </>
  );
}

export default function RecordingDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const theme = useTheme();
  const router = useRouter();

  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [recording, setRecording] = useState<RecordingDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [favoritePending, setFavoritePending] = useState(false);
  const [deletingAudio, setDeletingAudio] = useState(false);
  const [deleteAudioError, setDeleteAudioError] = useState<string | null>(null);
  const [downloadingAudio, setDownloadingAudio] = useState(false);
  const [downloadAudioError, setDownloadAudioError] = useState<string | null>(null);
  const [deletingRecording, setDeletingRecording] = useState(false);
  const [deleteRecordingError, setDeleteRecordingError] = useState<string | null>(null);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleSaveError, setTitleSaveError] = useState<string | null>(null);

  // Shared with the silent poll below, same purpose as the History list's
  // own `requestSeqRef` (Phase 2 Step 7): only the response matching the
  // most recently *issued* request is ever applied, so a slower, older
  // fetch resolving after a newer one can't briefly overwrite fresh state.
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!id) {
      setScreenState('not-found');
      return;
    }
    const requestId = ++requestSeqRef.current;
    setScreenState('loading');
    setLoadError(null);
    try {
      const row = await fetchRecordingById(id);
      if (requestId !== requestSeqRef.current) return;
      if (!row) {
        setScreenState('not-found');
        return;
      }
      setRecording(row);
      setScreenState('loaded');
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      setLoadError(err instanceof Error ? err.message : 'Could not load this recording.');
      setScreenState('error');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Phase 3 Step 2: this screen's own analogue of the History list's Step 7
  // polling. The list's polling is scoped to whatever's in the list's own
  // state and only runs while the list tab is focused — it does nothing for
  // a screen further up the stack, so a recording regenerated from here
  // (see `handleRegenerate` below) wouldn't otherwise be seen moving through
  // `processing` -> `done`/`failed` unless the user backed out to History
  // and back in. Same shape as the list's: a flat 1.5s interval, gated on
  // this screen being focused, that stops once `recording.status` is
  // terminal (`TERMINAL_STATUSES`) and silently updates `recording` in place
  // (no `screenState`/loading-spinner flicker) rather than calling `load()`.
  const recordingRef = useRef<RecordingDetail | null>(null);
  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useFocusEffect(
    useCallback(() => {
      const interval = setInterval(() => {
        const current = recordingRef.current;
        if (!id || !current || TERMINAL_STATUSES.has(current.status)) return;
        const requestId = ++requestSeqRef.current;
        fetchRecordingById(id)
          .then((row) => {
            if (requestId !== requestSeqRef.current || !row) return;
            setRecording(row);
          })
          .catch(() => {
            // A transient poll failure shouldn't interrupt an otherwise-
            // healthy pipeline run or flip the whole screen into an error
            // state — the manual Retry action already covers a genuine
            // load failure; this tick just tries again in 1.5s.
          });
      }, 1500);
      return () => clearInterval(interval);
    }, [id])
  );

  const handleRegenerate = useCallback(async () => {
    if (!recording) return;
    setRegenerating(true);
    setRegenerateError(null);
    try {
      await regenerateReport(recording.id);
      // Optimistically reflect the pipeline restarting immediately, rather
      // than waiting for the next poll tick — `process_recording()` flips
      // status straight to `processing` as its first step (see
      // `backend/app/services/processing.py`), so this mirrors exactly what
      // the backend is about to do and reuses the pending/processing UI
      // already built into this component (status badge + the "still
      // processing" branch above) with no new "regenerating" display needed.
      setRecording((prev) => (prev ? { ...prev, status: 'processing' } : prev));
    } catch (err) {
      setRegenerateError(err instanceof Error ? err.message : 'Could not start regeneration.');
    } finally {
      setRegenerating(false);
    }
  }, [recording]);

  // Phase 3 Step 4 — same optimistic-then-persist pattern as the History
  // list's `handleToggleFavorite` (`history/index.tsx`): flip local state
  // immediately so the star responds without waiting on a round-trip, then
  // persist via the same `setFavorite` direct Supabase update, reverting on
  // failure.
  const handleToggleFavorite = useCallback(async () => {
    if (!recording) return;
    const nextFavorite = !recording.favorite;
    setRecording((prev) => (prev ? { ...prev, favorite: nextFavorite } : prev));
    setFavoritePending(true);
    try {
      await setFavorite(recording.id, nextFavorite);
    } catch {
      setRecording((prev) => (prev ? { ...prev, favorite: !nextFavorite } : prev));
    } finally {
      setFavoritePending(false);
    }
  }, [recording]);

  // Phase 3 Step 5 — same "no confirmation, not optimistic" reasoning as the
  // History list's `handleDeleteAudio` (`history/index.tsx`): fires
  // immediately on tap, and `recording.audio_deleted` only flips once the
  // backend confirms the delete actually completed.
  const handleDeleteAudio = useCallback(async () => {
    if (!recording) return;
    setDeletingAudio(true);
    setDeleteAudioError(null);
    try {
      await deleteRecordingAudio(recording.id);
      setRecording((prev) => (prev ? { ...prev, audio_deleted: true, audio_path: null } : prev));
    } catch (err) {
      setDeleteAudioError(err instanceof Error ? err.message : 'Could not delete audio — try again.');
    } finally {
      setDeletingAudio(false);
    }
  }, [recording]);

  // Phase 3 Step 6 — same "not an error" reasoning as the list's
  // `handleDownloadAudio` (`history/index.tsx`): `shareRecordingAudio`
  // resolves the same way whether the user actually shared the file or
  // dismissed the share sheet, so there's nothing to special-case for a
  // cancel here either — only a genuine failure lands in `downloadAudioError`.
  const handleDownloadAudio = useCallback(async () => {
    if (!recording?.audio_path) {
      setDownloadAudioError('No audio file to download.');
      return;
    }
    setDownloadingAudio(true);
    setDownloadAudioError(null);
    try {
      await shareRecordingAudio(recording.audio_path);
    } catch (err) {
      setDownloadAudioError(err instanceof Error ? err.message : 'Could not download audio — try again.');
    } finally {
      setDownloadingAudio(false);
    }
  }, [recording]);

  // v2 Epic D Part 4 — permanently delete the whole recording (row + audio).
  // Gated behind a confirmation dialog in `RecordingActionsMenu` before it
  // reaches here — the irreversible loss of transcript/feedback/metrics is
  // why this one action confirms where "Delete audio" doesn't. Not
  // optimistic: on success there's nothing left to show, so we navigate back
  // to the list (which refetches on focus, so the row — and its freed cap
  // slot — reflect immediately). On failure, stay put with an inline error.
  const handleDeleteRecording = useCallback(async () => {
    if (!recording) return;
    setDeletingRecording(true);
    setDeleteRecordingError(null);
    try {
      await deleteRecording(recording.id);
      router.back();
    } catch (err) {
      setDeleteRecordingError(err instanceof Error ? err.message : 'Could not delete recording — try again.');
      setDeletingRecording(false);
    }
  }, [recording, router]);

  const handleMenuAction = useCallback(
    (action: RecordingMenuAction) => {
      if (action === 'download') handleDownloadAudio();
      else if (action === 'delete-audio') handleDeleteAudio();
      else if (action === 'delete-recording') handleDeleteRecording();
      else if (action === 'regenerate') handleRegenerate();
    },
    [handleDownloadAudio, handleDeleteAudio, handleDeleteRecording, handleRegenerate]
  );

  // v2 Epic D Part 2 — persist a user-edited title. A direct Supabase update
  // (`updateRecordingTitle`), not a backend endpoint — same call and same
  // reasoning as the favorite toggle: RLS already scopes it to this user and
  // there's no Gemini/Storage work involved (see the function's own doc
  // comment in src/lib/recordings.ts). Deliberately NOT optimistic, matching
  // `handleDeleteAudio`: `recording.title` only changes once the write has
  // actually landed, so a failed save never leaves a wrong title on screen.
  // Returns whether it persisted, so `TitleSection` knows whether to close.
  const handleSaveTitle = useCallback(
    async (nextTitle: string): Promise<boolean> => {
      if (!recording) return false;
      setSavingTitle(true);
      setTitleSaveError(null);
      try {
        await updateRecordingTitle(recording.id, nextTitle);
        setRecording((prev) => (prev ? { ...prev, title: nextTitle } : prev));
        return true;
      } catch (err) {
        setTitleSaveError(err instanceof Error ? err.message : 'Could not save title — try again.');
        return false;
      } finally {
        setSavingTitle(false);
      }
    },
    [recording]
  );

  const status = recording ? getStatusPresentation(recording.status, theme) : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.backRow}>
          <BackLink />
        </View>

        {screenState === 'loading' && (
          <View style={styles.centerFill}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        )}

        {screenState === 'not-found' && (
          <View style={styles.centerFill}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              This recording couldn&apos;t be found. It may have been removed, or it isn&apos;t yours.
            </ThemedText>
          </View>
        )}

        {screenState === 'error' && (
          <View style={styles.centerFill}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {loadError ?? 'Could not load this recording.'}
            </ThemedText>
            <Pressable onPress={load}>
              <ThemedText type="link">Retry</ThemedText>
            </Pressable>
          </View>
        )}

        {screenState === 'loaded' && recording && status && (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <TitleSection
              title={recording.title}
              onSave={handleSaveTitle}
              saving={savingTitle}
              saveError={titleSaveError}
              onCancelEdit={() => setTitleSaveError(null)}
            />

            <View style={styles.headerRow}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {formatRecordedAt(recording.created_at)}
              </ThemedText>
              <View style={styles.headerRowRight}>
                <View style={[styles.statusBadge, { backgroundColor: status.backgroundColor }]}>
                  <ThemedText type="smallBold" style={{ color: status.textColor }}>
                    {status.label}
                  </ThemedText>
                </View>
                <FavoriteStar favorite={recording.favorite} onToggle={handleToggleFavorite} disabled={favoritePending} />
                {/* v2 Epic D Part 4 — the same 3-dot menu as the History list
                    card. Download / Delete audio / Delete recording, plus
                    Regenerate report when failed (also offered as the
                    prominent button in `ReportSection` below — kept in both
                    for menu parity with the list). */}
                <RecordingActionsMenu
                  canDownload={!recording.audio_deleted && !!recording.audio_path}
                  canDeleteAudio={!recording.audio_deleted}
                  canRegenerate={recording.status === 'failed'}
                  busy={downloadingAudio || deletingAudio || deletingRecording || regenerating}
                  onSelect={handleMenuAction}
                />
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.modeLabel}>
              {formatMode(recording.mode)}
            </ThemedText>

            {(downloadAudioError || deleteAudioError || deleteRecordingError) && (
              <View style={styles.actionErrors}>
                {downloadAudioError && (
                  <ThemedText type="small" style={styles.actionErrorText}>
                    {downloadAudioError}
                  </ThemedText>
                )}
                {deleteAudioError && (
                  <ThemedText type="small" style={styles.actionErrorText}>
                    {deleteAudioError}
                  </ThemedText>
                )}
                {deleteRecordingError && (
                  <ThemedText type="small" style={styles.actionErrorText}>
                    {deleteRecordingError}
                  </ThemedText>
                )}
              </View>
            )}

            {/* Phase 4 Step 5 exit-checkpoint review: `question` was already
                fetched (`fetchRecordingById` selects it) but never rendered —
                a gap left over from when every recording had `question: null`
                (pre-Phase-4). A pool-picked or custom-typed question (Phase 4
                Steps 3-4) is meaningful context for the transcript/feedback
                below, so it's shown in full here, right under mode. Still
                absent for miscellaneous, which has no question. */}
            {recording.question && (
              <View style={styles.section}>
                <ThemedText type="smallBold">Question</ThemedText>
                <ThemedText type="default">{recording.question}</ThemedText>
              </View>
            )}

            <View style={styles.section}>
              <AudioSection recording={recording} />
            </View>

            <ReportSection
              recording={recording}
              onRegenerate={handleRegenerate}
              regenerating={regenerating}
              regenerateError={regenerateError}
            />
          </ScrollView>
        )}

        {Platform.OS === 'web' && <WebBadge />}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
  },
  backRow: {
    paddingTop: Spacing.three,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  centerRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.four,
  },
  actionErrors: {
    gap: Spacing.one,
    marginTop: -Spacing.one,
  },
  actionErrorText: {
    color: '#e5484d',
  },
  centerText: {
    textAlign: 'center',
  },
  scrollContent: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  titleText: {
    flexShrink: 1,
  },
  titleEditPencil: {
    // nudge the pencil onto the first line's optical centre, same as
    // QuestionArea's `editPencil`.
    marginTop: Spacing.one,
  },
  titleEditSection: {
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  titleInputBox: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    backgroundColor: Theme.colors.card,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radius.lg,
    paddingLeft: Theme.spacing.lg,
    paddingRight: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
  },
  titleInputField: {
    flex: 1,
    minHeight: 32,
    paddingVertical: Theme.spacing.xs,
    fontFamily: Theme.typography.fontFamily.regular,
    fontSize: 20,
    lineHeight: 26,
    color: Theme.colors.textPrimary,
  },
  titleSubmit: {
    paddingVertical: Theme.spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  headerRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  modeLabel: {
    marginTop: -Spacing.one,
  },
  statusBadge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.three,
  },
  section: {
    gap: Spacing.two,
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  regenerateButton: {
    alignSelf: 'flex-start',
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.7,
  },
});
