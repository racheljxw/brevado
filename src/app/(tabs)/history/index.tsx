import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { regenerateReport } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatRecordedAt } from '@/lib/format-time';
import { getStatusPresentation, TERMINAL_STATUSES } from '@/lib/recording-status';
import { fetchRecordings, type RecordingRow } from '@/lib/recordings';

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
// component, so that's what's here for now.
function RecordingListItem({
  recording,
  onPress,
  onRegenerate,
  regenerating,
  regenerateError,
}: {
  recording: RecordingRow;
  onPress: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
  regenerateError?: string;
}) {
  const theme = useTheme();
  const status = getStatusPresentation(recording.status, theme);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <View style={styles.rowHeader}>
          <ThemedText type="smallBold">{formatRecordedAt(recording.created_at)}</ThemedText>
          <View style={[styles.statusBadge, { backgroundColor: status.backgroundColor }]}>
            <ThemedText type="smallBold" style={{ color: status.textColor }}>
              {status.label}
            </ThemedText>
          </View>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {recording.mode}
        </ThemedText>

        {recording.status === 'failed' && (
          <View style={styles.regenerateRow}>
            <Pressable onPress={onRegenerate} disabled={regenerating} hitSlop={8}>
              {regenerating ? (
                <ActivityIndicator size="small" color={theme.textSecondary} />
              ) : (
                <ThemedText type="linkPrimary">Regenerate report</ThemedText>
              )}
            </Pressable>
            {regenerateError && (
              <ThemedText type="small" style={{ color: '#e5484d' }}>
                {regenerateError}
              </ThemedText>
            )}
          </View>
        )}
      </ThemedView>
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

  const showInitialLoading = loading && recordings === null;
  const showEmpty = !loading && !error && recordings?.length === 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ThemedText type="subtitle" style={styles.title}>
          History
        </ThemedText>

        {error && (
          <ThemedView type="backgroundElement" style={styles.errorCard}>
            <ThemedText type="small">{error}</ThemedText>
            <Pressable onPress={load}>
              <ThemedText type="linkPrimary">Retry</ThemedText>
            </Pressable>
          </ThemedView>
        )}

        {showInitialLoading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : showEmpty ? (
          <View style={styles.centerFill}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
              No recordings yet. Head to the Home tab and record your first practice session.
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
                onRegenerate={() => handleRegenerate(item.id)}
                regenerating={regeneratingIds.has(item.id)}
                regenerateError={regenerateErrors[item.id]}
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
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.three,
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
