import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioPlaybackControls } from '@/components/audio-playback-controls';
import { Card } from '@/components/card';
import { DeleteAudioButton } from '@/components/delete-audio-button';
import { DownloadAudioButton } from '@/components/download-audio-button';
import { FavoriteStar } from '@/components/favorite-star';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteRecordingAudio, regenerateReport } from '@/lib/api';
import { formatRecordedAt } from '@/lib/format-time';
import { formatMode } from '@/lib/modes';
import { getStatusPresentation, TERMINAL_STATUSES } from '@/lib/recording-status';
import {
  fetchRecordingById,
  getRecordingAudioUrl,
  setFavorite,
  shareRecordingAudio,
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
      <ThemedText type="linkPrimary">‹ Back to History</ThemedText>
    </Pressable>
  );
}

// Audio playback section: reused as-is regardless of the recording's
// `status` — audio finishes uploading (and the row is created) *before*
// backend processing ever starts, so it exists for a pending/processing/
// failed recording just as much as a done one. Only `audio_deleted` (Step 5,
// not built yet — see docs/CLAUDE.md's History section) changes what this
// renders, which is why that check is built now even though the flag is
// always false today.
function AudioSection({
  recording,
  onDeleteAudio,
  deletingAudio,
  deleteAudioError,
  onDownloadAudio,
  downloadingAudio,
  downloadAudioError,
}: {
  recording: RecordingDetail;
  onDeleteAudio: () => void;
  deletingAudio: boolean;
  deleteAudioError: string | null;
  onDownloadAudio: () => void;
  downloadingAudio: boolean;
  downloadAudioError: string | null;
}) {
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

  // Phase 3 Step 6 — the download/export action, rendered above delete
  // (below) for the same reason both exist in the list's `audioActionsRow`
  // side by side — this pairs naturally with delete as an "export before
  // delete" flow, though the two are fully independent (no forced
  // ordering, no dependency between them). Rendered in every playback state
  // just like delete — audio exists to download whether or not the
  // playback signed URL happened to load successfully.
  const downloadRow = (
    <View style={styles.deleteAudioRow}>
      <DownloadAudioButton onDownload={onDownloadAudio} pending={downloadingAudio} />
      <ThemedText type="small" themeColor="textSecondary">
        Download audio
      </ThemedText>
      {downloadAudioError && (
        <ThemedText type="small" style={{ color: '#e5484d' }}>
          {downloadAudioError}
        </ThemedText>
      )}
    </View>
  );

  // Phase 3 Step 5 — the delete action itself, rendered below playback
  // regardless of whether playback is still loading/ready/errored (audio
  // exists in all three of those states, so there's always something to
  // delete). No confirmation dialog, per an explicit product decision — see
  // docs/CLAUDE.md's History section.
  const deleteRow = (
    <View style={styles.deleteAudioRow}>
      <DeleteAudioButton onDelete={onDeleteAudio} pending={deletingAudio} />
      <ThemedText type="small" themeColor="textSecondary">
        Delete audio
      </ThemedText>
      {deleteAudioError && (
        <ThemedText type="small" style={{ color: '#e5484d' }}>
          {deleteAudioError}
        </ThemedText>
      )}
    </View>
  );

  if (audioState === 'loading' || audioState === 'idle') {
    return (
      <>
        <View style={styles.centerRow}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
        {downloadRow}
        {deleteRow}
      </>
    );
  }

  if (audioState === 'error') {
    return (
      <>
        <Card style={styles.card}>
          <ThemedText type="small">{audioError ?? 'Could not load audio.'}</ThemedText>
          <Pressable onPress={loadAudioUrl}>
            <ThemedText type="linkPrimary">Retry</ThemedText>
          </Pressable>
        </Card>
        {downloadRow}
        {deleteRow}
      </>
    );
  }

  return (
    <>
      <AudioPlaybackControls uri={audioUrl!} />
      {downloadRow}
      {deleteRow}
    </>
  );
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
              <ThemedText type="linkPrimary">Retry</ThemedText>
            </Pressable>
          </View>
        )}

        {screenState === 'loaded' && recording && status && (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.headerRow}>
              <ThemedText type="subtitle">{formatRecordedAt(recording.created_at)}</ThemedText>
              <View style={styles.headerRowRight}>
                <View style={[styles.statusBadge, { backgroundColor: status.backgroundColor }]}>
                  <ThemedText type="smallBold" style={{ color: status.textColor }}>
                    {status.label}
                  </ThemedText>
                </View>
                <FavoriteStar favorite={recording.favorite} onToggle={handleToggleFavorite} disabled={favoritePending} />
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.modeLabel}>
              {formatMode(recording.mode)}
            </ThemedText>

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
              <AudioSection
                recording={recording}
                onDeleteAudio={handleDeleteAudio}
                deletingAudio={deletingAudio}
                deleteAudioError={deleteAudioError}
                onDownloadAudio={handleDownloadAudio}
                downloadingAudio={downloadingAudio}
                downloadAudioError={downloadAudioError}
              />
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
  deleteAudioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  centerText: {
    textAlign: 'center',
  },
  scrollContent: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
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
