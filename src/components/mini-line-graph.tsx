import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Theme } from '@/constants/theme';
import type { GraphPoint } from '@/lib/streaks';

// A compact inline sparkline for the Streaks home-screen metric cards. This
// project has no `react-native-svg`, so the line is drawn as a run of thin
// rotated `View` segments between consecutive non-null points; a `null` point
// (a bucket with no qualifying recordings — see `buildGraphPoints`) leaves a
// gap the line doesn't bridge.
//
// Deliberately small — a glanceable trend hint inside the card. The detail
// screens' full-size graph is a separate component (`MetricLineGraph`).

const STROKE = 2;
const DOT = 5;
// Scores are 0–100; the y-axis is pinned to that range so cards are
// comparable rather than each auto-scaling to its own min/max.
const SCORE_MIN = 0;
const SCORE_MAX = 100;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

export function MiniLineGraph({
  points,
  height = 48,
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
  // Vertical inset so a dot/stroke sitting at exactly 0 or 100 isn't clipped.
  const pad = DOT;
  const innerHeight = Math.max(height - pad * 2, 1);

  const toX = (index: number) => (count <= 1 ? 0 : (index / (count - 1)) * width);
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

  return (
    <View style={[styles.wrap, { height }]} onLayout={handleLayout}>
      {width > 0 && plottedCount >= 2 &&
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
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    position: 'relative',
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
});
