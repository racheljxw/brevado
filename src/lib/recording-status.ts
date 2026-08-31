// A recording is done moving through the pipeline once it reaches one of
// these. Shared by every screen that polls a recording's status (the History
// list, the History detail screen, and the Record screen's processing
// display) so "should I keep polling this row?" means the same thing
// everywhere.
export const TERMINAL_STATUSES = new Set(['done', 'failed']);
