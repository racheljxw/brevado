// Unit tests for src/lib/streaks.ts (v3 Epic G Part 1).
//
// The Expo project has no test runner of its own (only the backend uses
// pytest). Rather than pull in `jest-expo` + its toolchain for four pure
// functions, these run on Node's built-in test runner (`node:test`, zero
// new dependencies). `streaks.ts` is deliberately dependency-free, so this
// works by compiling just these two files to plain JS and running them —
// see `npm run test:streaks` (package.json) for the exact command.
//
// If/when the frontend grows enough logic to warrant it, the recommendation
// is to add `jest-expo` (`npx expo install -- --save-dev jest-expo @types/jest`,
// run by the human per the dependency convention) and port these; the
// assertions translate directly.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { localDayKey } from './format-time';
import {
  averageClaritySupportingMetrics,
  buildDailyAverages,
  buildGraphPoints,
  calculateStreak,
  calculateTrend,
  type ClaritySupportingRecording,
  type DailyAverage,
  type StreakRecording,
} from './streaks';

// An ISO timestamp for a local calendar date at midday (so the device time
// zone can't roll it onto an adjacent day).
function iso(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

// Same, but `n` local days before "now" — for the streak tests, which are
// relative to the real today.
function daysAgoIso(n: number, hour = 12): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function daysAgoKey(n: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return localDayKey(d);
}

function done(created_at: string, scores: Partial<StreakRecording> = {}): StreakRecording {
  return {
    status: 'done',
    created_at,
    impact_score: null,
    clarity_score: null,
    structure_score: null,
    ...scores,
  };
}

describe('buildDailyAverages', () => {
  test('groups done recordings by local day and averages each day', () => {
    const result = buildDailyAverages(
      [
        done(iso(2026, 8, 10), { impact_score: 80 }),
        done(iso(2026, 8, 10), { impact_score: 100 }),
        done(iso(2026, 8, 12), { impact_score: 60 }),
      ],
      'impact_score',
    );
    assert.deepEqual(result, [
      { date: '2026-08-10', average: 90 },
      { date: '2026-08-12', average: 60 },
    ]);
  });

  test('averages multiple recordings that share a day', () => {
    const result = buildDailyAverages(
      [
        done(iso(2026, 8, 5), { clarity_score: 70 }),
        done(iso(2026, 8, 5), { clarity_score: 80 }),
        done(iso(2026, 8, 5), { clarity_score: 90 }),
      ],
      'clarity_score',
    );
    assert.deepEqual(result, [{ date: '2026-08-05', average: 80 }]);
  });

  test('excludes recordings that are not done', () => {
    const result = buildDailyAverages(
      [
        done(iso(2026, 8, 10), { impact_score: 50 }),
        { ...done(iso(2026, 8, 11), { impact_score: 90 }), status: 'processing' },
        { ...done(iso(2026, 8, 12), { impact_score: 90 }), status: 'failed' },
      ],
      'impact_score',
    );
    assert.deepEqual(result, [{ date: '2026-08-10', average: 50 }]);
  });

  test('excludes recordings with a null value for the requested metric', () => {
    const result = buildDailyAverages(
      [
        done(iso(2026, 8, 10), { impact_score: null, clarity_score: 80 }),
        done(iso(2026, 8, 11), { impact_score: 70 }),
      ],
      'impact_score',
    );
    assert.deepEqual(result, [{ date: '2026-08-11', average: 70 }]);
  });

  test('returns [] for no data', () => {
    assert.deepEqual(buildDailyAverages([], 'impact_score'), []);
  });
});

describe('calculateStreak', () => {
  test('counts an active streak that includes today', () => {
    const result = calculateStreak([
      done(daysAgoIso(0)),
      done(daysAgoIso(1)),
      done(daysAgoIso(2)),
    ]);
    assert.deepEqual(result, { current: 3, longest: 3 });
  });

  test('not having recorded yet today does not break the streak', () => {
    const result = calculateStreak([
      done(daysAgoIso(1)),
      done(daysAgoIso(2)),
      done(daysAgoIso(3)),
    ]);
    assert.deepEqual(result, { current: 3, longest: 3 });
  });

  test('a fully skipped day (yesterday) breaks the current streak', () => {
    const result = calculateStreak([done(daysAgoIso(2)), done(daysAgoIso(3))]);
    assert.deepEqual(result, { current: 0, longest: 2 });
  });

  test('longest run can be elsewhere in history, separate from current', () => {
    const result = calculateStreak([
      done(daysAgoIso(0)),
      done(daysAgoIso(1)),
      done(daysAgoIso(4)),
      done(daysAgoIso(5)),
      done(daysAgoIso(6)),
      done(daysAgoIso(7)),
    ]);
    assert.deepEqual(result, { current: 2, longest: 4 });
  });

  test('multiple recordings on the same day count that day once', () => {
    const result = calculateStreak([
      done(daysAgoIso(0)),
      done(daysAgoIso(0)),
      done(daysAgoIso(1)),
    ]);
    assert.deepEqual(result, { current: 2, longest: 2 });
  });

  test('returns zeros for no data', () => {
    assert.deepEqual(calculateStreak([]), { current: 0, longest: 0 });
  });

  test('non-done recordings do not count toward a streak', () => {
    const result = calculateStreak([
      { ...done(daysAgoIso(0)), status: 'failed' },
      { ...done(daysAgoIso(1)), status: 'processing' },
    ]);
    assert.deepEqual(result, { current: 0, longest: 0 });
  });
});

describe('calculateTrend', () => {
  test('returns a distinct no-data result when there are no averages', () => {
    assert.deepEqual(calculateTrend([], 7), { status: 'no-data' });
  });

  test('computes percent change against the value one window back', () => {
    const da: DailyAverage[] = [
      { date: '2026-08-22', average: 40 },
      { date: '2026-08-29', average: 60 },
    ];
    assert.deepEqual(calculateTrend(da, 7), {
      status: 'ok',
      percentChange: 50,
      todayValue: 60,
      todayDate: '2026-08-29',
      comparisonValue: 40,
      comparisonDate: '2026-08-22',
    });
  });

  test('skips a comparison day whose value is exactly 0, walking further back', () => {
    const da: DailyAverage[] = [
      { date: '2026-08-15', average: 40 },
      { date: '2026-08-22', average: 0 },
      { date: '2026-08-29', average: 60 },
    ];
    const result = calculateTrend(da, 7);
    assert.equal(result.status, 'ok');
    assert.equal(result.status === 'ok' && result.comparisonDate, '2026-08-15');
    assert.equal(result.status === 'ok' && result.percentChange, 50);
  });

  test('walks back when the exact target day has no data', () => {
    const da: DailyAverage[] = [
      { date: '2026-08-14', average: 50 },
      { date: '2026-08-29', average: 75 },
    ];
    const result = calculateTrend(da, 7);
    assert.equal(result.status === 'ok' && result.comparisonDate, '2026-08-14');
    assert.equal(result.status === 'ok' && result.percentChange, 50);
  });

  test('falls back to the earliest day when practice only started within the window', () => {
    // Both days are inside the last 7 — nothing on/before today−7 — so instead
    // of 'insufficient-history' it compares against the earliest day (a real
    // trend over a 3-day span; the UI labels it "Last 3 days").
    const da: DailyAverage[] = [
      { date: '2026-08-26', average: 40 },
      { date: '2026-08-29', average: 60 },
    ];
    const result = calculateTrend(da, 7);
    assert.equal(result.status, 'ok');
    assert.equal(result.status === 'ok' && result.comparisonDate, '2026-08-26');
    assert.equal(result.status === 'ok' && result.percentChange, 50);
  });

  test('insufficient history when only today has data', () => {
    assert.deepEqual(calculateTrend([{ date: '2026-08-29', average: 80 }], 7), {
      status: 'insufficient-history',
      todayValue: 80,
      todayDate: '2026-08-29',
    });
  });

  test('insufficient history when every earlier day is zero', () => {
    const da: DailyAverage[] = [
      { date: '2026-08-01', average: 0 },
      { date: '2026-08-29', average: 80 },
    ];
    assert.deepEqual(calculateTrend(da, 7), {
      status: 'insufficient-history',
      todayValue: 80,
      todayDate: '2026-08-29',
    });
  });

  test('all-time compares against the earliest non-zero dated value', () => {
    const da: DailyAverage[] = [
      { date: '2026-01-01', average: 0 },
      { date: '2026-03-01', average: 30 },
      { date: '2026-08-29', average: 90 },
    ];
    const result = calculateTrend(da, 'all-time');
    assert.equal(result.status === 'ok' && result.comparisonDate, '2026-03-01');
    assert.equal(result.status === 'ok' && result.percentChange, 200);
  });
});

describe('buildGraphPoints', () => {
  test('week: 7 daily points, null where a day has no data', () => {
    const da: DailyAverage[] = [
      { date: daysAgoKey(3), average: 50 },
      { date: daysAgoKey(0), average: 70 },
    ].sort((a, b) => (a.date < b.date ? -1 : 1));
    const points = buildGraphPoints(da, 'week');
    assert.equal(points.length, 7);
    assert.equal(points[6].value, 70); // today
    assert.equal(points[3].value, 50); // three days ago
    assert.equal(points[0].value, null); // six days ago
  });

  test('month: 4 weekly buckets, each the mean of its days', () => {
    const da: DailyAverage[] = [
      { date: daysAgoKey(10), average: 40 },
      { date: daysAgoKey(0), average: 70 },
    ].sort((a, b) => (a.date < b.date ? -1 : 1));
    const points = buildGraphPoints(da, 'month');
    assert.equal(points.length, 4);
    assert.equal(points[3].value, 70); // most recent 7-day bucket
    assert.equal(points[2].value, 40); // the 8–14-days-ago bucket
    assert.equal(points[0].value, null);
  });

  test('year: 12 monthly points', () => {
    const points = buildGraphPoints([{ date: daysAgoKey(0), average: 88 }], 'year');
    assert.equal(points.length, 12);
    assert.equal(points[11].value, 88); // current month
    assert.equal(points[0].value, null);
  });

  test('all-time: monthly points from the first data month through now', () => {
    const da: DailyAverage[] = [
      { date: daysAgoKey(40), average: 50 },
      { date: daysAgoKey(0), average: 70 },
    ].sort((a, b) => (a.date < b.date ? -1 : 1));
    const points = buildGraphPoints(da, 'all-time');
    assert.ok(points.length >= 2);
    assert.equal(points[0].value, 50); // month of the earliest data point
    assert.equal(points[points.length - 1].value, 70); // current month
  });

  test('all-time: switches to quarterly buckets for a multi-year history', () => {
    const da: DailyAverage[] = [
      { date: '2000-01-15', average: 20 },
      { date: daysAgoKey(0), average: 80 },
    ];
    const points = buildGraphPoints(da, 'all-time');
    assert.ok(points.length > 8);
    assert.equal(points[0].label, 'Q1 00');
    assert.equal(points[0].value, 20);
    assert.equal(points[points.length - 1].value, 80);
  });

  test('all-time: [] when there is no data', () => {
    assert.deepEqual(buildGraphPoints([], 'all-time'), []);
  });
});

describe('averageClaritySupportingMetrics', () => {
  function support(
    created_at: string,
    metrics: { filler_word_rate?: number | null; repetition_count?: number | null } | null,
    grammar_issue_count: number | null,
    status = 'done',
  ): ClaritySupportingRecording {
    return {
      status,
      created_at,
      metrics:
        metrics === null
          ? null
          : {
              filler_word_rate: metrics.filler_word_rate ?? null,
              repetition_count: metrics.repetition_count ?? null,
            },
      grammar_issue_count,
    };
  }

  test('averages each field independently over done recordings in the window', () => {
    const result = averageClaritySupportingMetrics(
      [
        support(daysAgoIso(1), { filler_word_rate: 0.1, repetition_count: 2 }, 3),
        support(daysAgoIso(3), { filler_word_rate: 0.2, repetition_count: 4 }, 5),
      ],
      7,
    );
    assert.deepEqual(result, {
      fillerWordRate: 0.15000000000000002,
      repetitionCount: 3,
      grammarIssueCount: 4,
    });
  });

  test('excludes recordings outside the window (but all-time keeps them)', () => {
    const recs = [
      support(daysAgoIso(2), { filler_word_rate: 0.1, repetition_count: 1 }, 1),
      support(daysAgoIso(40), { filler_word_rate: 0.5, repetition_count: 9 }, 9),
    ];
    assert.deepEqual(averageClaritySupportingMetrics(recs, 7), {
      fillerWordRate: 0.1,
      repetitionCount: 1,
      grammarIssueCount: 1,
    });
    assert.deepEqual(averageClaritySupportingMetrics(recs, 'all-time'), {
      fillerWordRate: 0.3,
      repetitionCount: 5,
      grammarIssueCount: 5,
    });
  });

  test('non-done recordings never contribute', () => {
    const result = averageClaritySupportingMetrics(
      [support(daysAgoIso(1), { filler_word_rate: 0.9, repetition_count: 9 }, 9, 'processing')],
      7,
    );
    assert.deepEqual(result, { fillerWordRate: null, repetitionCount: null, grammarIssueCount: null });
  });

  test('a field with no data anywhere is null; others still average', () => {
    const result = averageClaritySupportingMetrics(
      [
        support(daysAgoIso(1), { filler_word_rate: 0.1, repetition_count: null }, null),
        support(daysAgoIso(2), null, 4),
      ],
      30,
    );
    assert.deepEqual(result, { fillerWordRate: 0.1, repetitionCount: null, grammarIssueCount: 4 });
  });

  test('returns all null for no data', () => {
    assert.deepEqual(averageClaritySupportingMetrics([], 7), {
      fillerWordRate: null,
      repetitionCount: null,
      grammarIssueCount: null,
    });
  });
});
