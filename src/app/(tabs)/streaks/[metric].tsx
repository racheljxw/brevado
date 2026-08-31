import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HeaderBackLink } from '@/components/app-header';
import { Card } from '@/components/card';
import { MetricLineGraph } from '@/components/metric-line-graph';
import { ScrollFade, SCROLL_FADE_HEIGHT } from '@/components/scroll-fade';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TrendReadout } from '@/components/trend-readout';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing, Theme } from '@/constants/theme';
import { useStreakRecordings } from '@/hooks/use-streak-recordings';
import { useTheme } from '@/hooks/use-theme';
import {
  averageClaritySupportingMetrics,
  buildDailyAverages,
  buildGraphPoints,
  calculateTrend,
  SCORE_METRICS,
  type GraphTab,
  type TrendWindow,
} from '@/lib/streaks';

// The per-metric detail screen the home screen's "See details" links open
// (`/streaks/impact` | `/streaks/clarity` | `/streaks/structure`). Computed
// client-side over the same `fetchRecordings()` query as the home screen (via
// `useStreakRecordings`), so the two never disagree.
//
// The Week / Month / Year / All Time tab row recalculates the headline % (via
// `calculateTrend`), the graph (via `buildGraphPoints`), and — on Clarity
// only — the three supporting badges (via `averageClaritySupportingMetrics`)
// off the same window, so they always reflect the same period.

type TabConfig = {
  key: GraphTab;
  label: string;
  window: TrendWindow;
  windowLabel: string;
};

const TABS: TabConfig[] = [
  { key: 'week', label: 'Week', window: 7, windowLabel: 'Last 7 days' },
  { key: 'month', label: 'Month', window: 30, windowLabel: 'Last 30 days' },
  { key: 'year', label: 'Year', window: 365, windowLabel: 'Last 12 months' },
  { key: 'all-time', label: 'All Time', window: 'all-time', windowLabel: 'All time' },
];

function TabRow({ tab, onChange }: { tab: GraphTab; onChange: (next: GraphTab) => void }) {
  return (
    <View style={styles.tabRow}>
      {TABS.map((t) => {
        const active = tab === t.key;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={[styles.tab, active && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}>
            <ThemedText
              type={active ? 'smallBold' : 'small'}
              themeColor={active ? 'text' : 'textSecondary'}
              style={styles.tabLabel}>
              {t.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

// The three Clarity supporting badges: a bold value on top, a muted label
// under, hairline dividers between. The raw filler/repetition/grammar signals
// that ground the Clarity score, averaged over the selected window.
function SupportingBadges({
  filler,
  repetition,
  grammar,
}: {
  filler: number | null;
  repetition: number | null;
  grammar: number | null;
}) {
  if (filler === null && repetition === null && grammar === null) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No supporting metrics for this period yet.
      </ThemedText>
    );
  }

  const badges = [
    { label: 'Filler rate', value: filler === null ? '—' : `${(filler * 100).toFixed(1)}%` },
    { label: 'Repetition', value: repetition === null ? '—' : repetition.toFixed(1) },
    { label: 'Grammar', value: grammar === null ? '—' : grammar.toFixed(1) },
  ];

  return (
    <Card style={styles.badgesCard}>
      {badges.map((badge, i) => (
        <View key={badge.label} style={styles.badgeGroup}>
          {i > 0 && <View style={styles.badgeDivider} />}
          <View style={styles.badge}>
            <ThemedText style={styles.badgeValue}>{badge.value}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {badge.label}
            </ThemedText>
          </View>
        </View>
      ))}
    </Card>
  );
}

export default function MetricDetailScreen() {
  const params = useLocalSearchParams<{ metric: string }>();
  const slug = Array.isArray(params.metric) ? params.metric[0] : params.metric;
  const config = SCORE_METRICS.find((m) => m.slug === slug);

  const theme = useTheme();
  const router = useRouter();
  const { recordings, loading, error, reload } = useStreakRecordings();

  const [tab, setTab] = useState<GraphTab>('week');
  const activeTab = TABS.find((t) => t.key === tab)!;

  const rows = useMemo(() => recordings ?? [], [recordings]);

  const daily = useMemo(
    () => (config ? buildDailyAverages(rows, config.key) : []),
    [rows, config]
  );
  const trend = useMemo(() => calculateTrend(daily, activeTab.window), [daily, activeTab.window]);
  const graphPoints = useMemo(() => buildGraphPoints(daily, tab), [daily, tab]);
  const claritySupport = useMemo(
    () =>
      config?.key === 'clarity_score'
        ? averageClaritySupportingMetrics(rows, activeTab.window)
        : null,
    [rows, config, activeTab.window]
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <HeaderBackLink label="Back to Streaks" onPress={() => router.back()} />

        {!config ? (
          <View style={styles.centerFill}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              That metric couldn&apos;t be found.
            </ThemedText>
          </View>
        ) : loading && recordings === null ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : error && !recordings ? (
          <View style={styles.centerFill}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {error}
            </ThemedText>
            <Pressable onPress={reload}>
              <ThemedText type="link">Retry</ThemedText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.scrollArea}>
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {/* Heading + subheading on the left; the selected window's % change
                as a badge top-right, shown only for a real trend (`'ok'`) —
                with no data, or only one day of it, the corner is empty. */}
            <View style={styles.headerRow}>
              <View style={styles.headerTitleBlock}>
                <ThemedText style={styles.metricHeading}>{config.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {config.description}
                </ThemedText>
              </View>
              {trend.status === 'ok' && (
                <Card style={styles.statCard}>
                  <TrendReadout
                    trend={trend}
                    windowLabel={activeTab.windowLabel}
                    windowDays={activeTab.window}
                    variant="compact"
                  />
                </Card>
              )}
            </View>

            <TabRow tab={tab} onChange={setTab} />

            <Card style={styles.graphCard}>
              <MetricLineGraph points={graphPoints} />
              {daily.length === 0 && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.graphNote}>
                  Record a few scored sessions to see your {config.label.toLowerCase()} trend here.
                </ThemedText>
              )}
            </Card>

            {claritySupport && (
              <View style={styles.section}>
                <ThemedText type="smallBold" style={styles.sectionHeading}>
                  Supporting metrics
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  The raw signals behind your Clarity score, averaged over this period.
                </ThemedText>
                <SupportingBadges
                  filler={claritySupport.fillerWordRate}
                  repetition={claritySupport.repetitionCount}
                  grammar={claritySupport.grammarIssueCount}
                />
              </View>
            )}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  headerTitleBlock: {
    flex: 1,
    gap: Spacing.one,
  },
  // Badge in the header's top-right — the % (+ triangle) with the window
  // label on one line beneath it. The label uses `adjustsFontSizeToFit` (see
  // `compactLabel` in trend-readout) to keep the longer windows ("Last 12
  // months") on a single line in this square.
  statCard: {
    width: 76,
    minHeight: 76,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricHeading: {
    fontFamily: Theme.typography.fontFamily.bold,
    fontSize: 28,
    lineHeight: 34,
    color: Theme.colors.textPrimary,
  },
  // Minimalist underline tabs — matches History's Calendar/List toggle.
  tabRow: {
    flexDirection: 'row',
    gap: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.border,
  },
  tab: {
    paddingVertical: Spacing.two,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
  },
  tabActive: {
    borderBottomColor: Theme.colors.textPrimary,
  },
  tabLabel: {
    fontSize: 15,
    lineHeight: 20,
  },
  graphCard: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  graphNote: {
    textAlign: 'center',
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeading: {
    fontSize: 16,
  },
  badgesCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.three,
    marginTop: Spacing.one,
  },
  badgeGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.half,
  },
  badgeValue: {
    fontFamily: Theme.typography.fontFamily.bold,
    fontSize: 18,
    lineHeight: 22,
    color: Theme.colors.textPrimary,
  },
  badgeDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: Theme.colors.border,
  },
});
