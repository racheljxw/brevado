// A recording is done moving through the pipeline once it reaches one of
// these — shared by the History list's polling (`history/index.tsx`, Phase 2
// Step 7), the detail screen's own polling (`history/[id].tsx`, Phase 3
// Step 2), and the Record screen's `ProcessingStatus` (`index.tsx`, Epic C
// Part 4), so "should I keep polling this row?" means the same thing
// everywhere.
export const TERMINAL_STATUSES = new Set(['done', 'failed']);

// `getStatusPresentation` (a shared status-badge colour/label lookup) used
// to live here — removed when the status badge itself was removed from
// every screen that showed one (the List card dropped its own back in Epic
// D Part 3; the detail screen and the Record screen's `ProcessingStatus`
// both dropped theirs in a later pass, since each already had its own more
// specific pending/failed/done messaging that made the badge redundant).
// `TERMINAL_STATUSES` above is unaffected — it's just the polling
// stop-condition set, not a display concern.
