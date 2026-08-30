// v3 Epic G Part 1 — pure client-side aggregation logic for the Streaks tab.
//
// Same spirit as the backend's `metrics.py` (Phase 2 Step 4): isolated,
// dependency-free, unit-testable functions with no React / React Native / no
// Supabase imports, verified against hand-written cases *before* any screen
// (Epic G Part 2 onward) consumes them. Nothing here renders anything.
//
// Every function derives from the already-fetched recordings list — there is
// no new backend query in v3, consistent with how v2's History search and
// calendar view were built. `fetchRecordings()` (src/lib/recordings.ts) will
// be widened in Part 2 to also select the three score columns; the rows it
// returns then satisfy `StreakRecording` structurally.
//
// Day grouping reuses `localDayKey` from `src/lib/format-time.ts` — the exact
// same local-calendar-day rule History's Calendar view (v2 Epic D Part 6)
// groups by. See the note there for the local-time-zone tradeoff.

import { addLocalDays, dayKeyToDate, localDayKey } from './format-time';

// The three per-recording 0–100 scores from the Gemini feedback call (v3
// Epic F Step 1). `grammar_issue_count` is deliberately NOT here — it isn't a
// trend metric, just a Clarity grounding input.
export type ScoreMetric = 'impact_score' | 'clarity_score' | 'structure_score';

// The three scored metrics, in display order, with the short slug used in the
// Streaks detail route (`/streaks/[metric]`) and the UI copy shared by the
// home cards (Part 2) and the detail screens (Part 3). Kept here — next to
// `ScoreMetric` — so the two screens can't drift on label/description/slug.
// Plain string data, no React, consistent with the rest of this module.
export const SCORE_METRICS: {
  key: ScoreMetric;
  slug: 'impact' | 'clarity' | 'structure';
  label: string;
  description: string;
}[] = [
  { key: 'impact_score', slug: 'impact', label: 'Impact', description: 'Relevance & engagement' },
  { key: 'clarity_score', slug: 'clarity', label: 'Clarity', description: 'Brevity & grammar' },
  { key: 'structure_score', slug: 'structure', label: 'Structure', description: 'Speaking frameworks' },
];

// The minimal shape these functions need off a `recordings` row. `RecordingRow`
// (once Part 2 widens `fetchRecordings`) is assignable to this; extra fields
// are ignored.
export type StreakRecording = {
  status: string;
  created_at: string;
  impact_score: number | null;
  clarity_score: number | null;
  structure_score: number | null;
};

// One calendar day's mean score for a single metric. `date` is a
// `localDayKey` (`YYYY-MM-DD`); `average` is NOT rounded (a day with scores
// 80 and 95 yields 87.5) so downstream trend math stays exact — the UI
// rounds for display.
export type DailyAverage = { date: string; average: number };

export type StreakResult = {
  /** Consecutive local days with ≥1 `done` recording, counted back from
   *  today. Not having recorded *yet* today does not break it — only a
   *  fully skipped day does. */
  current: number;
  /** The longest such run anywhere in history. */
  longest: number;
};

export type TrendWindow = number | 'all-time';

export type TrendResult =
  // Enough data to show a % change.
  | {
      status: 'ok';
      percentChange: number;
      todayValue: number;
      todayDate: string;
      comparisonValue: number;
      comparisonDate: string;
    }
  // No dated scores at all — the UI shows a "New" / empty state.
  | { status: 'no-data' }
  // There is a "today" value but nothing valid to compare it against — the
  // UI shows the current value with no delta.
  | { status: 'insufficient-history'; todayValue: number; todayDate: string };

export type GraphTab = 'week' | 'month' | 'year' | 'all-time';

// A single plotted point. `value` is `null` for a bucket that has no
// qualifying recordings, so the UI gets a fixed, evenly-spaced x-axis and
// decides itself how to render gaps. `date` is the bucket's anchor day
// (`localDayKey`); `label` is a short human string for the axis tick.
export type GraphPoint = { date: string; label: string; value: number | null };

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function startOfLocalToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------------------
// 1. buildDailyAverages
// ---------------------------------------------------------------------------

/**
 * Groups `done` recordings that have a non-null value for `metric` by local
 * calendar day and averages each day.
 *
 * Excluded (never contribute to any average):
 *   - recordings whose `status` is not `'done'` (still processing / failed);
 *   - recordings whose `metric` value is `null` (pre-v3 rows, or a score
 *     that missed generation — Epic F's lenient failure) or non-finite.
 *
 * Returns a NEW array sorted ascending by `date`. An empty input, or one
 * where nothing qualifies, returns `[]`.
 */
export function buildDailyAverages(
  recordings: StreakRecording[],
  metric: ScoreMetric,
): DailyAverage[] {
  const byDay = new Map<string, { total: number; count: number }>();

  for (const recording of recordings) {
    if (recording.status !== 'done') continue;
    const value = recording[metric];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;

    const key = localDayKey(new Date(recording.created_at));
    const entry = byDay.get(key) ?? { total: 0, count: 0 };
    entry.total += value;
    entry.count += 1;
    byDay.set(key, entry);
  }

  return [...byDay.entries()]
    .map(([date, { total, count }]) => ({ date, average: total / count }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---------------------------------------------------------------------------
// 2. calculateStreak
// ---------------------------------------------------------------------------

/**
 * Practice-activity streak — counts days the user *recorded*, regardless of
 * scores (a recording with null scores still counts; a re-practice with a
 * great score counts once, not more). Only `status === 'done'` recordings
 * count as a completed practice day.
 *
 * `current`: walk back from today. If today has a recording it's included and
 * counting continues into yesterday, etc. If today has none, that's allowed
 * ("haven't practised yet today") — counting starts from yesterday instead.
 * The streak ends at the first fully skipped day. If neither today nor
 * yesterday has a recording, `current` is 0.
 *
 * `longest`: the longest consecutive-day run found anywhere in history.
 *
 * Empty input, or no `done` recordings, returns `{ current: 0, longest: 0 }`.
 */
export function calculateStreak(recordings: StreakRecording[]): StreakResult {
  const days = new Set<string>();
  for (const recording of recordings) {
    if (recording.status !== 'done') continue;
    days.add(localDayKey(new Date(recording.created_at)));
  }
  if (days.size === 0) return { current: 0, longest: 0 };

  // --- current ---
  let current = 0;
  let cursor = startOfLocalToday();
  if (!days.has(localDayKey(cursor))) {
    // Nothing today yet — that's fine, anchor on yesterday instead.
    cursor = addLocalDays(cursor, -1);
  }
  while (days.has(localDayKey(cursor))) {
    current += 1;
    cursor = addLocalDays(cursor, -1);
  }

  // --- longest ---
  const sorted = [...days].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const gapDays = Math.round(
      (dayKeyToDate(sorted[i]).getTime() - dayKeyToDate(sorted[i - 1]).getTime()) / 86_400_000,
    );
    run = gapDays === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  return { current, longest };
}

// ---------------------------------------------------------------------------
// 3. calculateTrend
// ---------------------------------------------------------------------------

/**
 * Percent change between the most recent day with data ("today") and the
 * value `windowDays` earlier.
 *
 * @param dailyAverages output of `buildDailyAverages` (sorted ascending).
 * @param windowDays 7 (Week), 30 (Month), 365 (Year), or `'all-time'`.
 *
 * Rules:
 *   - "today" = the last (most recent) entry. No entries at all →
 *     `{ status: 'no-data' }`.
 *   - Windowed: the comparison target is `today − windowDays`. If that exact
 *     day has no data, OR its value is exactly 0, walk further back day by
 *     day to the most recent earlier day that has real, non-zero data. If
 *     nothing is that old — practice only *started* within the window — fall
 *     back to the **earliest** non-zero day instead, so a real trend still
 *     shows over the shorter span (the UI surfaces "Last N days" rather than
 *     the nominal window). Only a lone day of data, or an all-zero history,
 *     stays `{ status: 'insufficient-history', ... }`.
 *   - `'all-time'`: the comparison is the earliest dated entry with a
 *     non-zero value.
 *   - `percentChange = ((today − comparison) / comparison) * 100` (never a
 *     divide-by-zero — every comparison path excludes `0`).
 */
export function calculateTrend(
  dailyAverages: DailyAverage[],
  windowDays: TrendWindow,
): TrendResult {
  if (dailyAverages.length === 0) return { status: 'no-data' };

  const today = dailyAverages[dailyAverages.length - 1];
  const todayValue = today.average;
  const todayDate = today.date;

  const earlier = dailyAverages.slice(0, -1); // everything before "today"

  let comparison: DailyAverage | undefined;
  if (windowDays === 'all-time') {
    // Earliest entry with a real, non-zero value.
    comparison = earlier.find((d) => d.average !== 0);
  } else {
    const targetKey = localDayKey(addLocalDays(dayKeyToDate(todayDate), -windowDays));
    // Most recent day that is on/before the target and has non-zero data —
    // i.e. "walk backward from the target until you hit real data".
    comparison = [...earlier]
      .reverse()
      .find((d) => d.date <= targetKey && d.average !== 0);
    // Nothing that far back — practice started within the window. Compare
    // against the earliest non-zero day so a real trend still shows; the
    // span is shorter than `windowDays` and the UI reflects that.
    if (!comparison) {
      comparison = earlier.find((d) => d.average !== 0);
    }
  }

  if (!comparison) {
    return { status: 'insufficient-history', todayValue, todayDate };
  }

  return {
    status: 'ok',
    percentChange: ((todayValue - comparison.average) / comparison.average) * 100,
    todayValue,
    todayDate,
    comparisonValue: comparison.average,
    comparisonDate: comparison.date,
  };
}

// ---------------------------------------------------------------------------
// 4. buildGraphPoints
// ---------------------------------------------------------------------------

/**
 * Graph-ready points at a granularity that suits the tab. Every tab returns
 * a fixed, contiguous run of buckets covering its window, each with
 * `value: number | null` (null = no data in that bucket).
 *
 * Window definitions (all anchored on *today*, local time):
 *   - `week`   — the last 7 days. 7 daily points, `[today−6 … today]`.
 *   - `month`  — the last 28 days as 4 consecutive 7-day buckets, oldest
 *                first. Each point is the mean of that bucket's DAILY
 *                averages (not recording-weighted).
 *   - `year`   — the current calendar month and the 11 before it. 12
 *                monthly points, mean of each month's daily averages.
 *   - `all-time` — from the month of the earliest data through the current
 *                month. Monthly points if that span is ≤ 24 months,
 *                otherwise quarterly points (kept readable for multi-year
 *                histories). `[]` if there is no data at all.
 */
export function buildGraphPoints(dailyAverages: DailyAverage[], tab: GraphTab): GraphPoint[] {
  const byDate = new Map(dailyAverages.map((d) => [d.date, d.average]));
  const today = startOfLocalToday();

  const meanInRange = (startKey: string, endKey: string): number | null => {
    const vals = dailyAverages
      .filter((d) => d.date >= startKey && d.date <= endKey)
      .map((d) => d.average);
    return vals.length ? mean(vals) : null;
  };

  const meanInMonth = (year: number, month0: number): number | null => {
    const vals = dailyAverages
      .filter((d) => {
        const [y, m] = d.date.split('-').map(Number);
        return y === year && m === month0 + 1;
      })
      .map((d) => d.average);
    return vals.length ? mean(vals) : null;
  };

  if (tab === 'week') {
    const points: GraphPoint[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const day = addLocalDays(today, -i);
      const key = localDayKey(day);
      points.push({
        date: key,
        label: day.toLocaleDateString(undefined, { weekday: 'short' }),
        value: byDate.get(key) ?? null,
      });
    }
    return points;
  }

  if (tab === 'month') {
    const points: GraphPoint[] = [];
    for (let b = 3; b >= 0; b -= 1) {
      const end = addLocalDays(today, -b * 7);
      const start = addLocalDays(end, -6);
      const startKey = localDayKey(start);
      points.push({
        date: startKey,
        label: start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        value: meanInRange(startKey, localDayKey(end)),
      });
    }
    return points;
  }

  if (tab === 'year') {
    const points: GraphPoint[] = [];
    for (let m = 11; m >= 0; m -= 1) {
      const monthStart = new Date(today.getFullYear(), today.getMonth() - m, 1);
      points.push({
        date: localDayKey(monthStart),
        label: monthStart.toLocaleDateString(undefined, { month: 'short' }),
        value: meanInMonth(monthStart.getFullYear(), monthStart.getMonth()),
      });
    }
    return points;
  }

  // all-time
  if (dailyAverages.length === 0) return [];
  const firstData = dayKeyToDate(dailyAverages[0].date);
  const monthsSpan =
    (today.getFullYear() - firstData.getFullYear()) * 12 +
    (today.getMonth() - firstData.getMonth()) +
    1;

  if (monthsSpan <= 24) {
    const points: GraphPoint[] = [];
    for (let m = 0; m < monthsSpan; m += 1) {
      const monthStart = new Date(firstData.getFullYear(), firstData.getMonth() + m, 1);
      points.push({
        date: localDayKey(monthStart),
        label: monthStart.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
        value: meanInMonth(monthStart.getFullYear(), monthStart.getMonth()),
      });
    }
    return points;
  }

  // Multi-year history — quarterly buckets from the quarter of the first
  // data point through the current quarter.
  const firstQuarterStart = new Date(firstData.getFullYear(), Math.floor(firstData.getMonth() / 3) * 3, 1);
  const points: GraphPoint[] = [];
  let cursor = firstQuarterStart;
  while (
    cursor.getFullYear() < today.getFullYear() ||
    (cursor.getFullYear() === today.getFullYear() && cursor.getMonth() <= today.getMonth())
  ) {
    const qYear = cursor.getFullYear();
    const qStartMonth = cursor.getMonth();
    const vals = dailyAverages
      .filter((d) => {
        const [y, m] = d.date.split('-').map(Number);
        return y === qYear && m - 1 >= qStartMonth && m - 1 < qStartMonth + 3;
      })
      .map((d) => d.average);
    points.push({
      date: localDayKey(cursor),
      label: `Q${Math.floor(qStartMonth / 3) + 1} ${String(qYear).slice(-2)}`,
      value: vals.length ? mean(vals) : null,
    });
    cursor = new Date(qYear, qStartMonth + 3, 1);
  }
  return points;
}

// ---------------------------------------------------------------------------
// 5. averageClaritySupportingMetrics
// ---------------------------------------------------------------------------

// The raw metrics behind the Clarity detail screen's three supporting badges
// (v3 Epic G Part 3). These are NOT a trend metric — they never feed
// `calculateTrend` / `buildGraphPoints`; they're a windowed read-out of the
// deterministic signals (from `metrics.py`) plus the model's grammar-issue
// count that ground the Clarity *score*. Only surfaced on `/streaks/clarity`.
//
// Structural input shape (not importing `RecordingMetrics` from
// `recordings.ts`, to keep this module dependency-free). A widened
// `RecordingRow` — which now selects `metrics` + `grammar_issue_count` (Part
// 3) — is assignable to this.
export type ClaritySupportingRecording = {
  status: string;
  created_at: string;
  metrics: { filler_word_rate: number | null; repetition_count: number | null } | null;
  grammar_issue_count: number | null;
};

export type ClaritySupportingAverages = {
  /** Mean filler-word rate as a FRACTION (0–1), same convention as
   *  `metrics.filler_word_rate`. `null` if nothing in the window has it. */
  fillerWordRate: number | null;
  /** Mean immediate-repetition count per recording. `null` if none. */
  repetitionCount: number | null;
  /** Mean model-assessed grammar-issue count per recording. `null` if none. */
  grammarIssueCount: number | null;
};

/**
 * Averages the three Clarity supporting metrics over the detail screen's
 * currently-selected tab window — `7` (Week) / `30` (Month) / `365` (Year) /
 * `'all-time'`, the same window numbers `calculateTrend` takes, so these
 * badges move in lockstep with the headline % and the graph.
 *
 * Only `status === 'done'` recordings whose local day is within the last
 * `window` days count (`'all-time'` = no lower bound). Each field averages
 * independently over just the recordings that have a finite value for it — a
 * pre-v3 row with no `metrics` / `grammar_issue_count` simply doesn't
 * contribute to that field. A field with nothing to average is `null`.
 *
 * Averages are NOT rounded — the UI formats each (filler rate as a %,
 * repetition / grammar as one-decimal counts).
 */
export function averageClaritySupportingMetrics(
  recordings: ClaritySupportingRecording[],
  window: TrendWindow,
): ClaritySupportingAverages {
  const startKey =
    window === 'all-time'
      ? null
      : localDayKey(addLocalDays(startOfLocalToday(), -(window - 1)));

  const filler: number[] = [];
  const repetition: number[] = [];
  const grammar: number[] = [];

  for (const recording of recordings) {
    if (recording.status !== 'done') continue;
    if (startKey !== null && localDayKey(new Date(recording.created_at)) < startKey) continue;

    const rate = recording.metrics?.filler_word_rate;
    if (typeof rate === 'number' && Number.isFinite(rate)) filler.push(rate);

    const reps = recording.metrics?.repetition_count;
    if (typeof reps === 'number' && Number.isFinite(reps)) repetition.push(reps);

    const issues = recording.grammar_issue_count;
    if (typeof issues === 'number' && Number.isFinite(issues)) grammar.push(issues);
  }

  return {
    fillerWordRate: filler.length ? mean(filler) : null,
    repetitionCount: repetition.length ? mean(repetition) : null,
    grammarIssueCount: grammar.length ? mean(grammar) : null,
  };
}
