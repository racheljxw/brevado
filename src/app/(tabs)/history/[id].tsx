import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HeaderBackLink } from '@/components/app-header';
import { FavoriteStar } from '@/components/favorite-star';
import { RecordingActionsMenu, type RecordingMenuAction } from '@/components/recording-actions-menu';
import { RecordingDetailBody } from '@/components/recording-detail-body';
import { ScrollFade, SCROLL_FADE_HEIGHT } from '@/components/scroll-fade';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TitleSection } from '@/components/title-section';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing, Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteRecording, deleteRecordingAudio, regenerateReport } from '@/lib/api';
import { formatRecordedAt } from '@/lib/format-time';
import { formatMode, modePillColors } from '@/lib/modes';
import { TERMINAL_STATUSES } from '@/lib/recording-status';
import {
  canRePracticeRecording,
  fetchRecordingById,
  rePracticeNavParams,
  setFavorite,
  shareRecordingAudio,
  updateRecordingTitle,
  type RecordingDetail,
} from '@/lib/recordings';

type ScreenState = 'loading' | 'not-found' | 'error' | 'loaded';

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
  // Title editing is opened from the 3-dot menu's "Rename title" item, so the
  // parent owns this flag.
  const [titleEditing, setTitleEditing] = useState(false);

  // Only the response matching the most recently *issued* request is ever
  // applied, so a slower, older fetch resolving after a newer one can't
  // briefly overwrite fresh state. Shared with the silent poll below.
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

  // This screen's own poll, so a recording regenerated from here (see
  // `handleRegenerate`) is seen moving through `processing` -> `done`/`failed`
  // without backing out to the list and returning. The list's polling only
  // runs while the list tab is focused, so it doesn't cover this screen. Flat
  // 1.5s interval, gated on focus, stops once `recording.status` is terminal;
  // updates `recording` in place with no loading-spinner flicker.
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
      // Reflect the pipeline restarting immediately rather than waiting for
      // the next poll tick — `process_recording()` flips status straight to
      // `processing` as its first step, so this mirrors what the backend is
      // about to do and reuses the existing processing UI.
      setRecording((prev) => (prev ? { ...prev, status: 'processing' } : prev));
    } catch (err) {
      setRegenerateError(err instanceof Error ? err.message : 'Could not start regeneration.');
    } finally {
      setRegenerating(false);
    }
  }, [recording]);

  // Optimistic-then-persist: flip local state immediately so the star
  // responds without waiting on a round-trip, then persist and revert on
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

  // No confirmation, not optimistic: fires immediately on tap, and
  // `recording.audio_deleted` only flips once the backend confirms.
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

  // `shareRecordingAudio` resolves the same way whether the user shared the
  // file or dismissed the share sheet, so a cancel needs no special-casing —
  // only a genuine failure lands in `downloadAudioError`.
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

  // Permanently delete the whole recording (row + audio). Gated behind a
  // confirmation dialog in `RecordingActionsMenu` before it reaches here. On
  // success there's nothing left to show, so navigate back to the list (which
  // refetches on focus); on failure, stay put with an inline error.
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

  // Hands the Record tab the original recording's id + mode + question via
  // route params; it enters a read-only re-practice state and writes
  // `re_practice_of` on upload.
  const handleRePractice = useCallback(() => {
    if (!recording) return;
    router.navigate({ pathname: '/', params: rePracticeNavParams(recording) });
  }, [recording, router]);

  const handleMenuAction = useCallback(
    (action: RecordingMenuAction) => {
      if (action === 're-practice') handleRePractice();
      else if (action === 'rename') {
        setTitleSaveError(null);
        setTitleEditing(true);
      } else if (action === 'download') handleDownloadAudio();
      else if (action === 'delete-audio') handleDeleteAudio();
      else if (action === 'delete-recording') handleDeleteRecording();
      else if (action === 'regenerate') handleRegenerate();
    },
    [handleRePractice, handleDownloadAudio, handleDeleteAudio, handleDeleteRecording, handleRegenerate]
  );

  // Persist a user-edited title via `updateRecordingTitle` (a direct Supabase
  // update). Not optimistic: `recording.title` only changes once the write
  // has landed, so a failed save never leaves a wrong title on screen.
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

  const modePill = recording ? modePillColors(recording.mode) : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <HeaderBackLink label="Back to History" onPress={() => router.back()} />

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

        {screenState === 'loaded' && recording && modePill && (
          <View style={styles.scrollArea}>
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {/* Header: the editable title sharing its line with the favorite
                star + 3-dot menu, mirroring the List card's heading row at a
                larger scale. */}
            <View style={styles.headerRow}>
              <TitleSection
                title={recording.title}
                editing={titleEditing}
                onSave={handleSaveTitle}
                saving={savingTitle}
                saveError={titleSaveError}
                onEndEdit={() => {
                  setTitleEditing(false);
                  setTitleSaveError(null);
                }}
              />
              <View style={styles.headerActions}>
                <FavoriteStar favorite={recording.favorite} onToggle={handleToggleFavorite} disabled={favoritePending} />
                {/* The same 3-dot menu as the History list card. Regenerate
                    report (when failed) is also offered as the prominent
                    button in `ReportSection` below — kept in both for parity
                    with the list. */}
                <RecordingActionsMenu
                  canRePractice={canRePracticeRecording(recording)}
                  canRename
                  canDownload={!recording.audio_deleted && !!recording.audio_path}
                  canDeleteAudio={!recording.audio_deleted}
                  canRegenerate={recording.status === 'failed'}
                  busy={downloadingAudio || deletingAudio || deletingRecording || regenerating}
                  onSelect={handleMenuAction}
                  edgeAlign
                />
              </View>
            </View>

            {/* Meta row: the colour-coded mode pill on the left, the date/time
                right-aligned. No status badge — `ReportSection` below already
                shows an explicit "still processing" / "Processing failed"
                notice for anything that isn't done. */}
            <View style={styles.metaRow}>
              <View style={[styles.modePillBox, { backgroundColor: modePill.backgroundColor }]}>
                <ThemedText type="small" style={[styles.modePillText, { color: modePill.color }]}>
                  {formatMode(recording.mode)}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {formatRecordedAt(recording.created_at)}
              </ThemedText>
            </View>

            {(downloadAudioError || deleteAudioError || deleteRecordingError) && (
              <View style={styles.actionErrors}>
                {downloadAudioError && (
                  <ThemedText type="small" style={styles.errorText}>
                    {downloadAudioError}
                  </ThemedText>
                )}
                {deleteAudioError && (
                  <ThemedText type="small" style={styles.errorText}>
                    {deleteAudioError}
                  </ThemedText>
                )}
                {deleteRecordingError && (
                  <ThemedText type="small" style={styles.errorText}>
                    {deleteRecordingError}
                  </ThemedText>
                )}
              </View>
            )}

            {/* Question -> Audio -> Scores/Feedback/Transcript. Shared with
                each accordion panel on the re-practice chain screen via
                `RecordingDetailBody`. */}
            <RecordingDetailBody
              recording={recording}
              onRegenerate={handleRegenerate}
              regenerating={regenerating}
              regenerateError={regenerateError}
            />
          </ScrollView>
          <ScrollFade style={styles.topFade} />
          </View>
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
    // Gutter lives on the scroll content, not here — a padded ScrollView
    // frame would clip the card drop shadows at its left/right edges.
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  actionErrors: {
    gap: Spacing.one,
  },
  errorText: {
    color: '#e5484d',
  },
  centerText: {
    textAlign: 'center',
  },
  // Relative wrapper for the header `ScrollFade` overlay.
  scrollArea: {
    flex: 1,
  },
  topFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SCROLL_FADE_HEIGHT,
  },
  scrollContent: {
    gap: Theme.spacing.lg,
    paddingHorizontal: Spacing.four,
    paddingTop: SCROLL_FADE_HEIGHT + Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  // Header row: title (flex) + the star/menu cluster pinned to the right.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // nudge onto the title's optical centre on its first line
    marginTop: Spacing.half,
  },
  // Meta row: mode pill on the left, date right-aligned.
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  modePillBox: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Theme.radius.pill,
  },
  modePillText: {
    fontSize: 12,
    lineHeight: 16,
  },
});
