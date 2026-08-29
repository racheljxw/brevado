import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { Card } from '@/components/card';
import { MiniLineGraph } from '@/components/mini-line-graph';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing, Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { TERMINAL_STATUSES } from '@/lib/recording-status';
import { fetchRecordings, type RecordingRow } from '@/lib/recordings';
import {
  buildDailyAverages,
  buildGraphPoints,
  calculateStreak,
  calculateTrend,
  type ScoreMetric,
  type TrendResult,
} from '@/lib/streaks';

// v3 Epic G Part 2 — the real Streaks home screen, replacing the Epic A
// empty placeholder. Everything here is computed CLIENT-SIDE from the same
// `fetchRecordings()` query History uses (widened in Part 2 to also select
// the three score columns) — no new backend endpoint, consistent with how
// v2's History search and calendar view were built. The pure aggregation
// lives in `src/lib/streaks.ts` (Part 1, unit-tested); this file only
// fetches and renders.
//
// This screen uses the fixed 7-day trend window per card. The Week / Month /
// Year / All Time tabs and their full-size graphs are the metric DETAIL
// screens — Epic G Part 3, deliberately not built here. "See details" is
// visually present but inert for now (see `MetricCard`).

const METRICS: { key: ScoreMetric; label: string; description: string }[] = [
  // Descriptions are kept short enough to share the card's top row with the
  // "See details" link on one line.
  { key: 'impact_score', label: 'Impact', description: 'Relevance & engagement' },
  { key: 'clarity_score', label: 'Clarity', description: 'Brevity & grammar' },
  { key: 'structure_score', label: 'Structure', description: 'Speaking frameworks' },
];

const TREND_WINDOW_DAYS = 7;

function pluralDays(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

// "You're on a {n} day streak!" per the design, plus a "Longest streak"
// line (a confirmed addition, not in the original mockup). current === 0 is
// handled as a plain, non-discouraging state rather than "0 day streak".
function StreakHeader({ recordings }: { recordings: RecordingRow[] }) {
  const { current, longest } = useMemo(() => calculateStreak(recordings), [recordings]);

  let title: string;
  let subtitle: string;
  if (current > 0) {
    title = `You're on a ${current} day streak!`;
    subtitle = `Longest streak: ${pluralDays(longest)}`;
  } else if (longest > 0) {
    // Practised before, but missed today and yesterday.
    title = 'No active streak right now';
    subtitle = `Record today to start a new one · longest was ${pluralDays(longest)}`;
  } else {
    // Brand-new account — no completed practice days at all yet.
    title = 'Start your first streak today';
    subtitle = 'Record a session on the Record tab to get going';
  }

  return (
    <View style={styles.streakHeader}>
      <ThemedText style={styles.streakTitle}>{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {subtitle}
      </ThemedText>
    </View>
  );
}

// The small up/down triangle beside a trend reading. Drawn with the CSS
// border trick rather than an SF Symbol so it can't depend on which glyphs
// the bundled symbol set happens to include, and takes any theme colour.
function TrendTriangle({ direction, color }: { direction: 'up' | 'down'; color: string }) {
  return (
    <View
      style={[
        styles.triangleBase,
        direction === 'up'
          ? { borderBottomWidth: 9, borderBottomColor: color }
          : { borderTopWidth: 9, borderTopColor: color },
      ]}
    />
  );
}

// The large "% change" reading. Handles all three `calculateTrend` results
// so the card never shows "NaN%" or a broken number:
//   - 'no-data'               -> "New"
//   - 'insufficient-history'  -> the current value + "Not enough history yet"
//   - 'ok'                    -> the signed % with an up/down triangle
function TrendReadout({ trend }: { trend: TrendResult }) {
  if (trend.status === 'no-data') {
    return (
      <View style={styles.trendBlock}>
        <ThemedText style={styles.trendBig} themeColor="textSecondary">
          New
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          No sessions yet
        </ThemedText>
      </View>
    );
  }

  if (trend.status === 'insufficient-history') {
    return (
      <View style={styles.trendBlock}>
        <ThemedText style={styles.trendBig} themeColor="textSecondary">
          {Math.round(trend.todayValue)}%
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          Insufficient history
        </ThemedText>
      </View>
    );
  }

  const rounded = Math.round(trend.percentChange);
  const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  const color =
    direction === 'up'
      ? Theme.colors.positive
      : direction === 'down'
        ? Theme.colors.recordRed
        : Theme.colors.textSecondary;

  return (
    <View style={styles.trendBlock}>
      <View style={styles.trendValueRow}>
        {direction !== 'flat' && <TrendTriangle direction={direction} color={color} />}
        <ThemedText style={[styles.trendBig, { color }]}>
          {rounded > 0 ? '+' : ''}
          {rounded}%
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        Last 7 days
      </ThemedText>
    </View>
  );
}

function MetricCard({
  label,
  description,
  metric,
  recordings,
}: {
  label: string;
  description: string;
  metric: ScoreMetric;
  recordings: RecordingRow[];
}) {
  const daily = useMemo(() => buildDailyAverages(recordings, metric), [recordings, metric]);
  const trend = useMemo(() => calculateTrend(daily, TREND_WINDOW_DAYS), [daily]);
  const graphPoints = useMemo(() => buildGraphPoints(daily, 'week'), [daily]);

  return (
    <View style={styles.metricSection}>
      {/* The metric name sits OUTSIDE the card. */}
      <ThemedText style={styles.metricName}>{label}</ThemedText>

      <Card style={styles.metricCard}>
        {/* Top row: the short description (top-left) and the "See details"
            link (top-right) share one line. Epic G Part 3 builds the metric
            detail screen "See details" opens; until then it's visually
            present but inert — no route to send it to yet, and stubbing one
            would mean restructuring `streaks.tsx` into a directory that Part
            3 will lay out properly anyway. */}
        <View style={styles.cardTopRow}>
          <ThemedText style={styles.metricDescription} themeColor="textSecondary" numberOfLines={1}>
            {description}
          </ThemedText>
          <View style={styles.seeDetailsRow}>
            <ThemedText type="link" style={styles.seeDetails}>
              See details
            </ThemedText>
            <SymbolView name="chevron.right" size={12} tintColor={Theme.colors.link} />
          </View>
        </View>

        {/* Bottom row: the statistic (bottom-left) and the mini graph
            (bottom-right) side by side. */}
        <View style={styles.cardBottomRow}>
          <TrendReadout trend={trend} />
          <View style={styles.graphWrap}>
            <MiniLineGraph points={graphPoints} />
          </View>
        </View>
      </Card>
    </View>
  );
}

export default function StreaksScreen() {
  const { user } = useAuth();
  const theme = useTheme();

  const [recordings, setRecordings] = useState<RecordingRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same out-of-order-response guard as the History list (Phase 2 Step 7):
  // only the response matching the most recently issued request is applied.
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    const requestId = ++requestSeqRef.current;
    setError(null);
    try {
      const rows = await fetchRecordings(user.id);
      if (requestId !== requestSeqRef.current) return;
      setRecordings(rows);
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not load your streaks.');
    } finally {
      if (requestId === requestSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [user]);

  // Refetch on every focus so a recording finished/added since the last
  // visit is reflected (tabs stay mounted in the background).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Light polling while any recording is still pending/processing, so a
  // just-uploaded session's scores fold into the trends without a manual
  // refresh — same shape and reasoning as the History list's Step 7 poll.
  const recordingsRef = useRef<RecordingRow[] | null>(null);
  useEffect(() => {
    recordingsRef.current = recordings;
  }, [recordings]);

  useFocusEffect(
    useCallback(() => {
      const interval = setInterval(() => {
        const rows = recordingsRef.current ?? [];
        if (rows.some((row) => !TERMINAL_STATUSES.has(row.status))) load();
      }, 1500);
      return () => clearInterval(interval);
    }, [load])
  );

  function handleRefresh() {
    setRefreshing(true);
    load();
  }

  const showInitialLoading = loading && recordings === null;
  const showErrorOnly = !!error && !recordings;
  const showEmpty = !loading && !error && recordings?.length === 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <AppHeader />

        {error && recordings && (
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
        ) : showErrorOnly ? (
          <View style={styles.centerFill}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {error}
            </ThemedText>
            <Pressable onPress={load}>
              <ThemedText type="link">Retry</ThemedText>
            </Pressable>
          </View>
        ) : showEmpty ? (
          <View style={styles.centerFill}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              No recordings yet. Record your first practice session on the Record tab to start building a streak.
            </ThemedText>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.textSecondary} />
            }>
            <StreakHeader recordings={recordings ?? []} />

            {METRICS.map((m) => (
              <MetricCard
                key={m.key}
                label={m.label}
                description={m.description}
                metric={m.key}
                recordings={recordings ?? []}
              />
            ))}
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
    // frame clips card drop shadows at its edges (see history/index.tsx).
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  errorCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
  },
  scrollContent: {
    gap: Theme.spacing.xl,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  streakHeader: {
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  streakTitle: {
    fontFamily: Theme.typography.fontFamily.bold,
    fontSize: 22,
    lineHeight: 28,
    color: Theme.colors.textPrimary,
  },
  metricSection: {
    gap: Spacing.two,
  },
  metricName: {
    fontFamily: Theme.typography.fontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    color: Theme.colors.textPrimary,
  },
  metricDescription: {
    flexShrink: 1,
    fontFamily: Theme.typography.fontFamily.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  metricCard: {
    padding: Spacing.three,
    gap: Spacing.four,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.three,
  },
  graphWrap: {
    flex: 1,
    minWidth: 56,
  },
  trendBlock: {
    gap: Spacing.half,
  },
  trendValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  trendBig: {
    fontFamily: Theme.typography.fontFamily.bold,
    fontSize: 30,
    lineHeight: 36,
  },
  triangleBase: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  seeDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  seeDetails: {
    lineHeight: 20,
  },
});
