import type { useTheme } from '@/hooks/use-theme';

// A recording is done moving through the pipeline once it reaches one of
// these — shared by the History list's polling (`history/index.tsx`, Phase 2
// Step 7) and the detail screen's own polling (`history/[id].tsx`, Phase 3
// Step 2), so "should I keep polling this row?" means the same thing in both
// places.
export const TERMINAL_STATUSES = new Set(['done', 'failed']);

// Status badge colors/label, shared by the History list (`history/index.tsx`)
// and the Phase 3 Step 1 detail screen (`history/[id].tsx`) so a recording's
// status reads identically wherever it's shown. Extracted out of the list
// screen once the detail screen needed the exact same presentation — see
// docs/CLAUDE.md's History section for why `failed`/`done` use raw hex
// rather than theme tokens (matches the red record/error accent used
// elsewhere, deliberately the same in light and dark mode).
export function getStatusPresentation(
  status: string,
  theme: ReturnType<typeof useTheme>
): { backgroundColor: string; textColor: string; label: string } {
  switch (status) {
    case 'failed':
      return { backgroundColor: 'rgba(229, 72, 77, 0.16)', textColor: '#e5484d', label: 'Failed' };
    case 'done':
      return { backgroundColor: 'rgba(48, 164, 108, 0.16)', textColor: '#30a46c', label: 'Done' };
    case 'processing':
      return { backgroundColor: theme.backgroundSelected, textColor: theme.textSecondary, label: 'Processing…' };
    case 'pending':
    default:
      return { backgroundColor: theme.backgroundSelected, textColor: theme.textSecondary, label: 'Pending' };
  }
}
