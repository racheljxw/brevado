import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { Card } from '@/components/card';
import { MiniLineGraph } from '@/components/mini-line-graph';
import { ScrollFade, SCROLL_FADE_HEIGHT } from '@/components/scroll-fade';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TrendReadout } from '@/components/trend-readout';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing, Theme } from '@/constants/theme';
import { useStreakRecordings } from '@/hooks/use-streak-recordings';
import { useTheme } from '@/hooks/use-theme';
import type { RecordingRow } from '@/lib/recordings';
import { buildDailyAverages, buildGraphPoints, calculateStreak, calculateTrend, SCORE_METRICS } from '@/lib/streaks';

// The Streaks home screen. Everything is computed client-side from the same
// `fetchRecordings()` query History uses (via `useStreakRecordings`, shared
// with the detail screens) — no dedicated backend endpoint. The pure
// aggregation lives in `src/lib/streaks.ts` (unit-tested); this file only
// fetches and renders.
//
// The home cards use the fixed 7-day trend window; the Week / Month / Year /
// All Time tabs and full-size graphs live on the detail screen.

const TREND_WINDOW_DAYS = 7;

function pluralDays(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

// The streak header. current === 0 is handled as a plain, non-discouraging
// state rather than "0 day streak".
function StreakHeader({ recordings }: { recordings: RecordingRow[] }) {
  const { current, longest } = useMemo(() => calculateStreak(recordings), [recordings]);

  let title: string;
  let subtitle: string;
  if (current > 0) {
    title = `You're on a ${current} day streak!`;
    subtitle = `Longest streak: ${pluralDays(longest)}`;
  } else if (longest > 0) {
    title = 'No active streak right now';
    subtitle = `Record today to start a new one · longest was ${pluralDays(longest)}`;
  } else {
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

function MetricCard({
  label,
  description,
  metric,
  recordings,
  onSeeDetails,
}: {
  label: string;
  description: string;
  metric: (typeof SCORE_METRICS)[number]['key'];
  recordings: RecordingRow[];
  onSeeDetails: () => void;
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
            link (top-right) share one line. */}
        <View style={styles.cardTopRow}>
          <ThemedText style={styles.metricDescription} themeColor="textSecondary" numberOfLines={1}>
            {description}
          </ThemedText>
          <Pressable
            onPress={onSeeDetails}
            hitSlop={8}
            style={({ pressed }) => [styles.seeDetailsRow, pressed && styles.pressed]}
            accessibilityRole="link"
            accessibilityLabel={`See ${label} details`}>
            <ThemedText type="link" style={styles.seeDetails}>
              See details
            </ThemedText>
            <SymbolView name="chevron.right" size={12} tintColor={Theme.colors.link} />
          </Pressable>
        </View>

        {/* Bottom row: the statistic (bottom-left) and the mini graph
            (bottom-right) side by side. */}
        <View style={styles.cardBottomRow}>
          <TrendReadout trend={trend} windowLabel="Last 7 days" windowDays={TREND_WINDOW_DAYS} />
          <View style={styles.graphWrap}>
            <MiniLineGraph points={graphPoints} />
          </View>
        </View>
      </Card>
    </View>
  );
}

export default function StreaksScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { recordings, loading, refreshing, error, reload, refresh } = useStreakRecordings();

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
            <Pressable onPress={reload}>
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
            <Pressable onPress={reload}>
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
          <View style={styles.scrollArea}>
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                tintColor={theme.textSecondary}
                progressViewOffset={SCROLL_FADE_HEIGHT}
              />
            }>
            <StreakHeader recordings={recordings ?? []} />

            {SCORE_METRICS.map((m) => (
              <MetricCard
                key={m.key}
                label={m.label}
                description={m.description}
                metric={m.key}
                recordings={recordings ?? []}
                onSeeDetails={() => router.push({ pathname: '/streaks/[metric]', params: { metric: m.slug } })}
              />
            ))}
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
    // frame clips card drop shadows at its edges.
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
    gap: Theme.spacing.xl,
    paddingHorizontal: Spacing.four,
    paddingTop: SCROLL_FADE_HEIGHT + Spacing.two,
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
  seeDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  seeDetails: {
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.7,
  },
});
