import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, Theme } from '@/constants/theme';
import { dayKeyToDate } from '@/lib/format-time';
import type { TrendResult, TrendWindow } from '@/lib/streaks';

// The "% change" reading shared by the Streaks home cards and the metric
// detail screens. Maps `calculateTrend`'s discriminated union so a card/screen
// never renders "NaN%":
//   - 'ok'  -> the signed % with an up/down triangle, in `positive` green
//             (up) / `recordRed` (down); a rounded 0 shows a plain grey
//             "0%". A sublabel sits under the number — normally `windowLabel`
//             ("Last 7 days"), auto-shortened to "Last N days" when practice
//             only started partway into the window.
//   - 'insufficient-history' (exactly one day of scored data) -> `card`:
//             just that day's value, grey, NO sublabel / triangle. `compact`
//             renders nothing.
//   - 'no-data' -> `card`: just "No sessions yet". `compact`: renders nothing.
//
// Variants: `card` (home metric card — 30px number + sublabel) and `compact`
// (detail-screen header badge, only ever mounted for an 'ok' trend — ~17px
// number + triangle, with the sublabel on one line beneath it).

export function TrendTriangle({
  direction,
  color,
  size = 9,
}: {
  direction: 'up' | 'down';
  color: string;
  size?: number;
}) {
  const half = Math.round(size * 0.66);
  return (
    <View
      style={[
        styles.triangleBase,
        { borderLeftWidth: half, borderRightWidth: half },
        direction === 'up'
          ? { borderBottomWidth: size, borderBottomColor: color }
          : { borderTopWidth: size, borderTopColor: color },
      ]}
    />
  );
}

function spanInDays(fromKey: string, toKey: string): number {
  return Math.round((dayKeyToDate(toKey).getTime() - dayKeyToDate(fromKey).getTime()) / 86_400_000);
}

export function TrendReadout({
  trend,
  windowLabel,
  windowDays,
  variant = 'card',
}: {
  trend: TrendResult;
  /** Nominal sublabel for the normal 'ok' case — "Last 7 days" etc. Shortened
   *  to "Last N days" when the compared span is shorter than `windowDays`
   *  (practice only started recently). `compact` ignores it. */
  windowLabel: string;
  windowDays: TrendWindow;
  variant?: 'card' | 'compact';
}) {
  const compact = variant === 'compact';
  const bigStyle = compact ? styles.compactBig : styles.big;
  const triangleSize = compact ? 7 : 9;

  if (trend.status === 'no-data') {
    if (compact) return null;
    return (
      <View style={styles.block}>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          No sessions yet
        </ThemedText>
      </View>
    );
  }

  if (trend.status === 'insufficient-history') {
    if (compact) return null;
    // Exactly one day of data — show that value alone. No sublabel, no arrow.
    return (
      <View style={styles.block}>
        <ThemedText style={bigStyle} themeColor="textSecondary" numberOfLines={1}>
          {Math.round(trend.todayValue)}%
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

  let label = windowLabel;
  if (windowDays !== 'all-time') {
    const span = spanInDays(trend.comparisonDate, trend.todayDate);
    if (span < windowDays) label = `Last ${span} ${span === 1 ? 'day' : 'days'}`;
  }

  return (
    <View style={[styles.block, compact && styles.compactBlock]}>
      <View style={styles.valueRow}>
        {direction !== 'flat' && (
          <TrendTriangle direction={direction} color={color} size={triangleSize} />
        )}
        <ThemedText
          style={[bigStyle, { color }]}
          numberOfLines={1}
          adjustsFontSizeToFit={compact}
          minimumFontScale={0.7}>
          {rounded > 0 ? '+' : ''}
          {rounded}%
        </ThemedText>
      </View>
      <ThemedText
        type="small"
        themeColor="textSecondary"
        numberOfLines={1}
        adjustsFontSizeToFit={compact}
        minimumFontScale={0.65}
        style={compact ? styles.compactLabel : undefined}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Spacing.half,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  compactBlock: {
    alignItems: 'center',
  },
  compactLabel: {
    fontSize: 10,
    lineHeight: 13,
    textAlign: 'center',
  },
  big: {
    fontFamily: Theme.typography.fontFamily.bold,
    fontSize: 30,
    lineHeight: 36,
  },
  compactBig: {
    fontFamily: Theme.typography.fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
  },
  triangleBase: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
