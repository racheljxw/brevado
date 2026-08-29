import { Theme } from '@/constants/theme';

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

// v2 Epic D Part 3 — the colour-coded mode pill (pale bg + a matching
// saturated label colour). Originally a private helper inside
// `history/index.tsx`'s list card; pulled out here in Part 7 once the
// History detail screen's restyle needed the identical pill, so both
// screens share one definition instead of two copies drifting apart.
export function modePillColors(mode: string): { backgroundColor: string; color: string } {
  switch (mode) {
    case 'interview':
      return { backgroundColor: Theme.colors.modeInterview, color: Theme.colors.modeInterviewText };
    case 'story':
      return { backgroundColor: Theme.colors.modeStory, color: Theme.colors.modeStoryText };
    case 'miscellaneous':
      return { backgroundColor: Theme.colors.modeMiscellaneous, color: Theme.colors.modeMiscellaneousText };
    default:
      return { backgroundColor: Theme.colors.border, color: Theme.colors.textPrimary };
  }
}
