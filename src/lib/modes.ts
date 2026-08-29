import type { RecordingMode } from './recordings';

// v2 Epic C Part 3 — one source of truth for how each recording mode is
// shown to the user. "Storytelling" (not "Story") matches the design
// screenshots and the mode-select pill label. Internal values
// (`mode: 'story'` in the DB / schema, `QuestionMode` in
// src/lib/questions.ts) are unchanged — this is display-string only.
export const MODE_LABELS: Record<RecordingMode, string> = {
  interview: 'Interview',
  story: 'Storytelling',
  miscellaneous: 'Miscellaneous',
};

// The `recordings` row types carry `mode` as a plain `string` (it comes
// straight off Supabase). This maps a known mode to its label and passes
// anything unexpected through unchanged.
export function formatMode(mode: string): string {
  return (MODE_LABELS as Record<string, string>)[mode] ?? mode;
}
