import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { formatRecordedAt } from '@/lib/format-time';
import { getStatusPresentation } from '@/lib/recording-status';
import { fetchRecordings, type RecordingRow } from '@/lib/recordings';

// A row is done polling for status once it lands here — see the `load()`
// interval below.
const TERMINAL_STATUSES = new Set(['done', 'failed']);

// Phase 3 Step 1: rows are now tappable, pushing `history/[id]` for the full
// detail view (transcript/feedback/metrics/playback). `onPress` is threaded
// through rather than reading `useRouter()` in here so this stays a plain
// presentational component.
function RecordingListItem({ recording, onPress }: { recording: RecordingRow; onPress: () => void }) {
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
