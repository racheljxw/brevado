import { Theme } from '@/constants/theme';

import type { RecordingMode } from './recordings';

// One source of truth for how each recording mode is shown to the user.
// "Storytelling" is the user-facing label; the internal DB/schema value is
// `mode: 'story'`.
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

// The colour-coded mode pill (pale background + a matching saturated label
// colour), shared by the History list card and the detail screen.
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
