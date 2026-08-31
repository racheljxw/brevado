import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, Theme } from '@/constants/theme';
import type { GraphPoint } from '@/lib/streaks';

// The full-size line graph on the Streaks metric detail screens. Same drawing
// technique as `MiniLineGraph` — a run of thin rotated `View` segments between
// consecutive non-null points, since this project has no `react-native-svg` —
// just larger, with faint y-gridlines behind the line, a right-hand y-axis
// scale (25 / 50 / 75 / 100 %), and an x-axis tick row below it.
//
// Sparse-data behaviour:
//   - 0 plottable points -> just the faint gridlines (the "baseline")
//   - 1 plottable point  -> gridlines + the single dot
//   - >= 2               -> gridlines + dots + the connecting line
// A `null` bucket (a window slot with no qualifying recordings — see
// `buildGraphPoints`) leaves a gap the line doesn't bridge.

const STROKE = 2.5;
const DOT = 7;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
// Scores are 0–100; the y-axis is pinned to that range (not auto-scaled to
// the data's own min/max) so every tab/metric is visually comparable.
const GRIDLINES = [0, 25, 50, 75, 100];
// Right-hand scale labels — 0% is the baseline and left unlabelled.
const AXIS_LABELS = [100, 75, 50, 25];
const AXIS_LABEL_WIDTH = 36;
const AXIS_LABEL_LINE_HEIGHT = 14;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

export function MetricLineGraph({
  points,
  height = 200,
  color = Theme.colors.accent,
}: {
  points: GraphPoint[];
  height?: number;
  color?: string;
}) {
  const [width, setWidth] = useState(0);

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  const count = points.length;
  const pad = DOT; // vertical inset so a dot at exactly 0/100 isn't clipped
  const innerHeight = Math.max(height - pad * 2, 1);

  const toX = (index: number) => (count <= 1 ? width / 2 : (index / (count - 1)) * width);
  const toY = (value: number) =>
    pad + (1 - (clamp(value, SCORE_MIN, SCORE_MAX) - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * innerHeight;

  const coords = points.map((point, index) =>
    point.value == null || !Number.isFinite(point.value)
      ? null
      : { x: toX(index), y: toY(point.value) }
  );
  const plottedCount = coords.filter(Boolean).length;

  const segments: { x: number; y: number; length: number; angle: string }[] = [];
  for (let i = 0; i < coords.length - 1; i += 1) {
    const from = coords[i];
    const to = coords[i + 1];
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    segments.push({
      x: from.x,
      y: from.y,
      length: Math.hypot(dx, dy),
      angle: `${Math.atan2(dy, dx)}rad`,
    });
  }

  // Thin the x-axis ticks so a 12-month / multi-year run doesn't overlap —
  // always keep the first and last, then an even sample in between.
  const labelInterval = count <= 8 ? 1 : Math.ceil(count / 6);
  const showLabel = (index: number) =>
    index === 0 || index === count - 1 || index % labelInterval === 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.plotRow}>
        <View style={[styles.plot, { height }]} onLayout={handleLayout}>
          {GRIDLINES.map((g) => (
            <View key={`grid-${g}`} style={[styles.gridline, { top: toY(g) }]} />
          ))}

          {width > 0 &&
            plottedCount >= 2 &&
            segments.map((segment, i) => (
              <View
                key={`seg-${i}`}
                style={[
                  styles.segment,
                  {
                    left: segment.x,
                    top: segment.y - STROKE / 2,
                    width: segment.length,
                    backgroundColor: color,
                    transform: [{ rotateZ: segment.angle }],
                  },
                ]}
              />
            ))}

          {width > 0 &&
            coords.map((coord, i) =>
              coord ? (
                <View
                  key={`dot-${i}`}
                  style={[styles.dot, { left: coord.x - DOT / 2, top: coord.y - DOT / 2, backgroundColor: color }]}
                />
              ) : null
            )}
        </View>

        {/* Right-hand y-axis scale, aligned to the gridlines. */}
        <View style={[styles.axisColumn, { height }]}>
          {AXIS_LABELS.map((v) => (
            <ThemedText
              key={`y-${v}`}
              type="small"
              themeColor="textSecondary"
              numberOfLines={1}
              style={[styles.yLabel, { top: toY(v) - AXIS_LABEL_LINE_HEIGHT / 2 }]}>
              {v}%
            </ThemedText>
          ))}
        </View>
      </View>

      <View style={styles.axisRow}>
        <View style={styles.axisTicks}>
          {points.map((point, i) => (
            <View key={`tick-${i}`} style={styles.axisCell}>
              {showLabel(i) ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.axisLabel}>
                  {point.label}
                </ThemedText>
              ) : null}
            </View>
          ))}
        </View>
        {/* keep the x ticks aligned under the plot, not the y-axis gutter */}
        <View style={styles.axisColumnSpacer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    gap: Spacing.two,
  },
  plotRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  plot: {
    flex: 1,
    position: 'relative',
  },
  axisColumn: {
    width: AXIS_LABEL_WIDTH,
    position: 'relative',
  },
  yLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'right',
    fontSize: 11,
    lineHeight: AXIS_LABEL_LINE_HEIGHT,
  },
  gridline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.border,
  },
  segment: {
    position: 'absolute',
    height: STROKE,
    borderRadius: STROKE / 2,
    transformOrigin: 'left center',
  },
  dot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
  axisRow: {
    flexDirection: 'row',
  },
  axisTicks: {
    flex: 1,
    flexDirection: 'row',
  },
  axisColumnSpacer: {
    width: AXIS_LABEL_WIDTH,
  },
  axisCell: {
    flex: 1,
    alignItems: 'center',
  },
  axisLabel: {
    fontSize: 11,
    lineHeight: 14,
  },
});
