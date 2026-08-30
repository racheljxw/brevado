import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HeaderBackLink } from '@/components/app-header';
import { FavoriteStar } from '@/components/favorite-star';
import { RecordingActionsMenu, type RecordingMenuAction } from '@/components/recording-actions-menu';
import { RecordingDetailBody } from '@/components/recording-detail-body';
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
  // state and only runs while the list tab itself is focused — it does
  // nothing for a screen further up the navigation stack, so a recording
  // regenerated from here (see `handleRegenerate` below) wouldn't otherwise
  // be seen moving through `processing` -> `done`/`failed` unless the user
  // backed out to History and back in. Same shape as the list's: a flat 1.5s
  // interval, gated on this screen being focused, that stops once
  // `recording.status` is terminal (`TERMINAL_STATUSES`) and silently
  // updates `recording` in place (no `screenState`/loading-spinner flicker)
  // rather than calling `load()`.
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

  // v4 Epic I — see the matching handler in `history/index.tsx`. Hands the
  // Record tab the original recording's id + mode + question via route params;
  // it enters a read-only re-practice state and writes `re_practice_of` on
  // upload.
  const handleRePractice = useCallback(() => {
    if (!recording) return;
    router.navigate({ pathname: '/', params: rePracticeNavParams(recording) });
  }, [recording, router]);

  const handleMenuAction = useCallback(
    (action: RecordingMenuAction) => {
      if (action === 're-practice') handleRePractice();
      else if (action === 'download') handleDownloadAudio();
      else if (action === 'delete-audio') handleDeleteAudio();
      else if (action === 'delete-recording') handleDeleteRecording();
      else if (action === 'regenerate') handleRegenerate();
    },
    [handleRePractice, handleDownloadAudio, handleDeleteAudio, handleDeleteRecording, handleRegenerate]
  );

  // v2 Epic D Part 2 — persist a user-edited title. A direct Supabase update
  // (`updateRecordingTitle`), not a backend endpoint — same call and same
  // reasoning as the favorite toggle: RLS already scopes it to this user and
  // there's no Gemini/Storage work involved (see the function's own doc
  // comment in src/lib/recordings.ts). Deliberately NOT optimistic, matching
  // `handleDeleteAudio`: `recording.title` only changes once the write has
  // actually landed, so a failed save never leaves a wrong title on screen.
  // Returns whether it persisted, so `TitleSection` knows whether to close.
  //
  // v2 Epic D Part 7: `updateRecordingTitle` now also sets
  // `title_edited_by_user = true` in the same write, so a subsequent
  // pipeline run (initial generation or "Regenerate report") never
  // overwrites this hand-set title — see that function's doc comment and
  // `backend/app/services/processing.py`.
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
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Header: the editable title (Part 2) sharing its line with the
                favorite star + 3-dot menu, mirroring the List card's heading
                row (Part 3/4) at a larger scale. */}
            <View style={styles.headerRow}>
              <TitleSection
                title={recording.title}
                onSave={handleSaveTitle}
                saving={savingTitle}
                saveError={titleSaveError}
                onCancelEdit={() => setTitleSaveError(null)}
              />
              <View style={styles.headerActions}>
                <FavoriteStar favorite={recording.favorite} onToggle={handleToggleFavorite} disabled={favoritePending} />
                {/* v2 Epic D Part 4 — the same 3-dot menu as the History list
                    card. Download / Delete audio / Delete recording, plus
                    Regenerate report when failed (also offered as the
                    prominent button in `ReportSection` below — kept in both
                    for menu parity with the list). The design screenshots
                    show separate inline "Download"/"Delete" text links here,
                    but Part 4 deliberately consolidated all row-level
                    actions into this menu for consistency with the list —
                    that decision stands through this restyle. */}
                <RecordingActionsMenu
                  canRePractice={canRePracticeRecording(recording)}
                  canDownload={!recording.audio_deleted && !!recording.audio_path}
                  canDeleteAudio={!recording.audio_deleted}
                  canRegenerate={recording.status === 'failed'}
                  busy={downloadingAudio || deletingAudio || deletingRecording || regenerating}
                  onSelect={handleMenuAction}
                />
              </View>
            </View>

            {/* Meta row: the colour-coded mode pill (Part 3 styling) on the
                left, the date/time right-aligned. No status badge — removed
                as redundant: `ReportSection` below already shows an explicit
                "still processing" / "Processing failed" notice for anything
                that isn't done, so a second status label up here duplicated
                that same information. */}
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
                `RecordingDetailBody` (v4 Epic J Part 2). */}
            <RecordingDetailBody
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
    // Gutter lives on the sections below, not here — a padded ScrollView
    // frame would clip the card drop shadows at its left/right edges. See
    // the matching note in `history/index.tsx`.
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
  scrollContent: {
    gap: Theme.spacing.lg,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  // Header row: title (flex) + the star/menu cluster pinned to the right —
  // same pattern as the List card's heading row, at a larger scale.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    // nudge onto the title's optical centre on its first line
    marginTop: Spacing.half,
  },
  // Meta row: mode pill on the left, date right-aligned — matching the List
  // card's `metaRow` layout (Part 3). No status badge (see the JSX comment
  // above where this renders).
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
