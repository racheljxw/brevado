import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/card';
import { DeleteAudioButton } from '@/components/delete-audio-button';
import { DownloadAudioButton } from '@/components/download-audio-button';
import { FavoriteStar } from '@/components/favorite-star';
import { ProfileButton } from '@/components/profile-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing, Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteRecordingAudio, regenerateReport } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatRecordedAt } from '@/lib/format-time';
import { formatMode } from '@/lib/modes';
import { TERMINAL_STATUSES } from '@/lib/recording-status';
import { fetchRecordings, setFavorite, shareRecordingAudio, type RecordingRow } from '@/lib/recordings';

// Phase 3 Step 1: rows are now tappable, pushing `history/[id]` for the full
// detail view (transcript/feedback/metrics/playback). `onPress` is threaded
// through rather than reading `useRouter()` in here so this stays a plain
// presentational component.
//
// Phase 3 Step 2: a `failed` row also gets its own "Regenerate report"
// affordance, nested inside the row's outer `Pressable` (which still
// navigates to the detail view on tap elsewhere in the row) — React
// Native's touch responder system gives the inner `Pressable` exclusive
// claim on its own taps, so pressing it doesn't also trigger navigation.
// The spec calls for this living in a 3-dot menu; a plain inline text
// action reads just as clearly at this app's scale and needs no new menu
// component, so that's what's here for now (consolidation into that menu is
// Epic D Part 4).
//
// v2 Epic D Part 3 — the card is restyled to the design screenshots:
//   - the recording `title` (Part 1/2) as the bold heading, with the
//     favorite star on the same line. NULL title -> a muted "Untitled
//     recording" fallback (see the CLAUDE.md "Recording titles" note on why
//     that over a truncated question).
//   - the question/prompt as a secondary `textSecondary` line; "No prompt"
//     (not blank) for miscellaneous, which has no question.
//   - a colour-coded mode pill (`modeInterview`/`modeStory`/
//     `modeMiscellaneous` bg + the matching `*Text` label tokens) on the
//     meta row, with the date/time right-aligned opposite it. No status
//     badge — the failed-row "Regenerate report" action keys off
//     `recording.status` directly, not a visible badge.
//   - the existing download/delete/regenerate actions are unchanged in
//     behaviour — only their icon tint was neutralised to theme tokens so
//     they don't clash with the restyled card. Consolidating them into a
//     3-dot menu (+ a new "Delete recording") is Part 4.
function modePillColors(mode: string): { backgroundColor: string; color: string } {
  switch (mode) {
    case 'interview':
      return { backgroundColor: Theme.colors.modeInterview, color: Theme.colors.modeInterviewText };
    case 'story':
      return { backgroundColor: Theme.colors.modeStory, color: Theme.colors.modeStoryText };
    case 'miscellaneous':
      return { backgroundColor: Theme.colors.modeMiscellaneous, color: Theme.colors.modeMiscellaneousText };
    default:
      return { backgroundColor: Theme.colors.border, color: Theme.colors.textPrimary };
  }
}

function RecordingListItem({
  recording,
  onPress,
  onToggleFavorite,
  favoritePending,
  onRegenerate,
  regenerating,
  regenerateError,
  onDeleteAudio,
  deletingAudio,
  deleteAudioError,
  onDownloadAudio,
  downloadingAudio,
  downloadAudioError,
}: {
  recording: RecordingRow;
  onPress: () => void;
  onToggleFavorite: () => void;
  favoritePending: boolean;
  onRegenerate: () => void;
  regenerating: boolean;
  regenerateError?: string;
  onDeleteAudio: () => void;
  deletingAudio: boolean;
  deleteAudioError?: string;
  onDownloadAudio: () => void;
  downloadingAudio: boolean;
  downloadAudioError?: string;
}) {
  const theme = useTheme();
  const modePill = modePillColors(recording.mode);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <Card style={styles.row}>
        {/* Heading: the recording title (or a muted fallback for a NULL
            title — a legacy row, or one where generation returned nothing),
            with the favorite star sharing the line. */}
        <View style={styles.titleRow}>
          <ThemedText
            type="smallBold"
            themeColor={recording.title ? 'text' : 'textSecondary'}
            numberOfLines={2}
            style={[styles.cardTitle, styles.titleFlex]}>
            {recording.title ?? 'Untitled recording'}
          </ThemedText>
          <FavoriteStar favorite={recording.favorite} onToggle={onToggleFavorite} disabled={favoritePending} size={20} />
        </View>

        {/* Phase 4 Step 5 exit-checkpoint review: the question/topic (real as
            of Phase 4 Steps 3-4 for interview/story; still null for
            miscellaneous) is meaningful context when scanning past sessions,
            so it gets a one-line, truncated preview here — the detail screen
            shows it in full. Epic D Part 3: miscellaneous (no question) shows
            a clear "No prompt" rather than blank space. */}
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.promptLine}>
          {recording.question ?? 'No prompt'}
        </ThemedText>

        {/* Meta row: the colour-coded mode pill on the left, the date/time
            right-aligned opposite it. */}
        <View style={styles.metaRow}>
          <View style={[styles.modePill, { backgroundColor: modePill.backgroundColor }]}>
            <ThemedText type="small" style={[styles.modePillText, { color: modePill.color }]}>
              {formatMode(recording.mode)}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.metaDate}>
            {formatRecordedAt(recording.created_at)}
          </ThemedText>
        </View>

        {/* Per-row audio actions — download (Step 6) and delete (Step 5).
            Nothing renders once audio_deleted is true — there's no audio
            left to act on, for either action. Behaviour unchanged in Part 3;
            these fold into a 3-dot menu in Part 4. */}
        {!recording.audio_deleted && (
          <View style={styles.audioActionsRow}>
            {recording.audio_path && (
              <DownloadAudioButton onDownload={onDownloadAudio} pending={downloadingAudio} size={18} />
            )}
            <DeleteAudioButton onDelete={onDeleteAudio} pending={deletingAudio} size={18} />
          </View>
        )}
        {downloadAudioError && (
          <ThemedText type="small" style={{ color: '#e5484d' }}>
            {downloadAudioError}
          </ThemedText>
        )}
        {deleteAudioError && (
          <ThemedText type="small" style={{ color: '#e5484d' }}>
            {deleteAudioError}
          </ThemedText>
        )}

        {recording.status === 'failed' && (
          <View style={styles.regenerateRow}>
            <Pressable onPress={onRegenerate} disabled={regenerating} hitSlop={8}>
              {regenerating ? (
                <ActivityIndicator size="small" color={theme.textSecondary} />
              ) : (
                <ThemedText type="link">Regenerate report</ThemedText>
              )}
            </Pressable>
            {regenerateError && (
              <ThemedText type="small" style={{ color: '#e5484d' }}>
                {regenerateError}
              </ThemedText>
            )}
          </View>
        )}
      </Card>
    </Pressable>
  );
}

export default function HistoryScreen() {
  const { user } = useAuth();
  const theme = useTheme();
  const router = useRouter();

  // null = not fetched yet, distinct from "fetched and empty".
  const [recordings, setRecordings] = useState<RecordingRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 3 Step 2: per-row "Regenerate report" state — keyed by recording
  // id since any number of failed rows could be regenerated independently
  // (each gets its own in-flight spinner / error message, not a single
  // list-wide one).
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [regenerateErrors, setRegenerateErrors] = useState<Record<string, string>>({});

  // Phase 3 Step 4 — per-row favorite-toggle in-flight state, same shape as
  // the regenerate state above (independent per row, keyed by id).
  const [favoritingIds, setFavoritingIds] = useState<Set<string>>(new Set());

  // Phase 3 Step 5 — per-row audio-delete in-flight/error state, same shape
  // as the regenerate state above.
  const [deletingAudioIds, setDeletingAudioIds] = useState<Set<string>>(new Set());
  const [deleteAudioErrors, setDeleteAudioErrors] = useState<Record<string, string>>({});

  // Phase 3 Step 6 — per-row audio-download in-flight/error state, same
  // shape as delete/regenerate above (independent per row, keyed by id).
  const [downloadingAudioIds, setDownloadingAudioIds] = useState<Set<string>>(new Set());
  const [downloadAudioErrors, setDownloadAudioErrors] = useState<Record<string, string>>({});

  // Step 7: monotonically-increasing id for each `load()` call, so a
  // response can tell whether a *newer* request has been issued since it
  // went out. The interval below can have more than one `fetchRecordings()`
  // in flight at once (e.g. a manual pull-to-refresh landing mid-poll), and
  // network timing doesn't guarantee they resolve in the order they were
  // sent — without this, a slower, older request resolving after a faster,
  // newer one briefly overwrites fresh state with stale status (the
  // flashing bug flagged in Step 3's review). Only the response matching the
  // most recently *issued* request is applied; anything else is discarded
  // as stale. A ref, not state, since bumping it should never itself
  // trigger a re-render.
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    const requestId = ++requestSeqRef.current;
    setError(null);
    try {
      const rows = await fetchRecordings(user.id);
      if (requestId !== requestSeqRef.current) return; // a newer request has since been issued — discard
      setRecordings(rows);
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not load your history.');
    } finally {
      if (requestId === requestSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [user]);

  // Refetch every time this tab gains focus (e.g. arriving here right after
  // an upload from the Home tab, or backing out of a detail screen), not
  // just on first mount — a plain mount effect wouldn't see recordings
  // created since the screen last loaded, since tabs stay mounted in the
  // background rather than remounting on switch.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // A ref (not state) so the poll interval below can read the latest list
  // on every tick without needing to be torn down and recreated each time
  // `recordings` changes.
  const recordingsRef = useRef<RecordingRow[] | null>(null);
  useEffect(() => {
    recordingsRef.current = recordings;
  }, [recordings]);

  // Phase 2 Step 7 (was a flat "poll while anything's in flight" loop since
  // Step 2): refetch on an interval while any row is still pending/
  // processing, so status visibly moves pending -> processing -> done
  // without a manual pull-to-refresh. Only runs while this tab is focused.
  //
  // Per-row stop condition: fetching is one query for the whole list, not
  // one request per row, so there's no separate "stop polling this row"
  // switch to build — the granularity that matters is whether *any* row is
  // still non-terminal, which is what `stillInFlight` checks. Once every
  // row has reached `done`/`failed` (TERMINAL_STATUSES), this stops firing
  // `load()` at all. A finished row riding along in an in-flight tick's
  // response costs nothing extra (same one query either way), so there's no
  // benefit to scoping the query itself down to just the non-terminal rows
  // at this app's scale (max 30 rows/user) — that'd be added complexity for
  // no real savings.
  useFocusEffect(
    useCallback(() => {
      const interval = setInterval(() => {
        const rows = recordingsRef.current ?? [];
        const stillInFlight = rows.some((row) => !TERMINAL_STATUSES.has(row.status));
        if (stillInFlight) {
          load();
        }
      }, 1500);
      return () => clearInterval(interval);
    }, [load])
  );

  function handleRefresh() {
    setRefreshing(true);
    load();
  }

  async function handleRegenerate(id: string) {
    setRegeneratingIds((prev) => new Set(prev).add(id));
    setRegenerateErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await regenerateReport(id);
      // Optimistically flip this row to 'processing' (what
      // `process_recording()` sets as its first step regardless of entry
      // point — see `src/lib/api.ts`) so it reads as back in progress
      // immediately and so the polling effect above — which already
      // refetches whenever *any* row is non-terminal — picks it up on its
      // very next tick instead of waiting on a stale 'failed' row to be
      // overwritten by a slower background update.
      setRecordings((prev) => prev?.map((row) => (row.id === id ? { ...row, status: 'processing' } : row)) ?? prev);
    } catch (err) {
      setRegenerateErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Could not regenerate.',
      }));
    } finally {
      setRegeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // Phase 3 Step 4: optimistic, responsive favorite toggle — flip local
  // state immediately (no waiting on a refetch/poll tick), then persist via
  // `setFavorite` (direct Supabase update, see src/lib/recordings.ts). On
  // failure, revert the optimistic flip rather than leaving the UI showing
  // a state that didn't actually save.
  async function handleToggleFavorite(id: string, nextFavorite: boolean) {
    setRecordings((prev) => prev?.map((row) => (row.id === id ? { ...row, favorite: nextFavorite } : row)) ?? prev);
    setFavoritingIds((prev) => new Set(prev).add(id));
    try {
      await setFavorite(id, nextFavorite);
    } catch {
      // Revert — the update didn't actually persist.
      setRecordings((prev) => prev?.map((row) => (row.id === id ? { ...row, favorite: !nextFavorite } : row)) ?? prev);
    } finally {
      setFavoritingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // Phase 3 Step 5 — no confirmation dialog before this fires, per an
  // explicit product decision (see docs/CLAUDE.md's History section):
  // tapping delete calls the backend immediately, no "are you sure?" step.
  // Unlike the favorite toggle above, this is NOT optimistic — local state
  // only flips to audio_deleted once the backend confirms the delete
  // actually completed (Storage object gone + row updated; see
  // `delete_audio` in `backend/app/routers/recordings.py`). Flipping it
  // eagerly and reverting on failure would risk briefly showing "audio
  // deleted" for audio that's still there, or the reverse.
  async function handleDeleteAudio(id: string) {
    setDeletingAudioIds((prev) => new Set(prev).add(id));
    setDeleteAudioErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await deleteRecordingAudio(id);
      setRecordings((prev) => prev?.map((row) => (row.id === id ? { ...row, audio_deleted: true } : row)) ?? prev);
    } catch (err) {
      setDeleteAudioErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Could not delete audio — try again.',
      }));
    } finally {
      setDeletingAudioIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // Phase 3 Step 6 — downloads a recording's audio and opens the native
  // share sheet (see `shareRecordingAudio` in src/lib/recordings.ts for the
  // full flow and why a cancelled share sheet isn't treated as a failure
  // here — the promise resolves the same way on cancel as on a completed
  // share, so there's nothing to special-case in this handler). Guards on
  // `audioPath` even though the button is only rendered when one exists
  // (`RecordingListItem` above) — defensive, matching how the rest of this
  // file treats a theoretically-missing audio_path.
  async function handleDownloadAudio(id: string, audioPath: string | null) {
    if (!audioPath) {
      setDownloadAudioErrors((prev) => ({ ...prev, [id]: 'No audio file to download.' }));
      return;
    }
    setDownloadingAudioIds((prev) => new Set(prev).add(id));
    setDownloadAudioErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await shareRecordingAudio(audioPath);
    } catch (err) {
      setDownloadAudioErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Could not download audio — try again.',
      }));
    } finally {
      setDownloadingAudioIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const showInitialLoading = loading && recordings === null;
  const showEmpty = !loading && !error && recordings?.length === 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.headerRow}>
          <ThemedText type="subtitle" style={styles.title}>
            History
          </ThemedText>
          <ProfileButton />
        </View>

        {error && (
          <Card style={styles.errorCard}>
            <ThemedText type="small">{error}</ThemedText>
            <Pressable onPress={load}>
              <ThemedText type="link">Retry</ThemedText>
            </Pressable>
          </Card>
        )}

        {showInitialLoading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : showEmpty ? (
          <View style={styles.centerFill}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
              No recordings yet. Head to the Record tab and record your first practice session.
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={recordings ?? []}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <RecordingListItem
                recording={item}
                onPress={() => router.push({ pathname: '/history/[id]', params: { id: item.id } })}
                onToggleFavorite={() => handleToggleFavorite(item.id, !item.favorite)}
                favoritePending={favoritingIds.has(item.id)}
                onRegenerate={() => handleRegenerate(item.id)}
                regenerating={regeneratingIds.has(item.id)}
                regenerateError={regenerateErrors[item.id]}
                onDeleteAudio={() => handleDeleteAudio(item.id)}
                deletingAudio={deletingAudioIds.has(item.id)}
                deleteAudioError={deleteAudioErrors[item.id]}
                onDownloadAudio={() => handleDownloadAudio(item.id, item.audio_path)}
                downloadingAudio={downloadingAudioIds.has(item.id)}
                downloadAudioError={downloadAudioErrors[item.id]}
              />
            )}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.textSecondary} />
            }
          />
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    textAlign: 'center',
  },
  listContent: {
    gap: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.three,
  },
  row: {
    // Card supplies the fill (Theme.colors.card), inset border, radius
    // (Theme.radius.card) and shadow — this just adds the interior layout.
    gap: Spacing.two,
    padding: Spacing.three,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  titleFlex: {
    flexShrink: 1,
  },
  cardTitle: {
    // "smallBold" (Noto Sans bold) bumped up to a list-card heading size —
    // smaller than the detail screen's `subtitle`, larger than body.
    fontSize: 17,
    lineHeight: 22,
  },
  promptLine: {
    // pull the secondary line up snug under the heading
    marginTop: -Spacing.one,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  modePill: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Theme.radius.pill,
  },
  modePillText: {
    fontSize: 12,
    lineHeight: 16,
  },
  metaDate: {
    flexShrink: 1,
    textAlign: 'right',
  },
  audioActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.three,
  },
  regenerateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.half,
  },
  errorCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginBottom: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
});
