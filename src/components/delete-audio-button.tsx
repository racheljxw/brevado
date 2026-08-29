import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

// Phase 3 Step 5 — the "delete this recording's audio" action, shared by the
// History list row and detail screen (same sharing rationale as
// `FavoriteStar`). **No confirmation step before this fires** — per an
// explicit product decision (see docs/CLAUDE.md's History section), tapping
// this deletes immediately, even for a favorited recording; favorite and
// delete are fully independent (Step 4).
//
// Deliberately not grouped with `FavoriteStar`/the status badge — those are
// identity/status markers, this is a per-row *audio* action, and Step 6
// adds a download action right alongside it — so callers place this in its
// own row/cluster reserved for audio actions rather than the header row.
export function DeleteAudioButton({
  onDelete,
  pending,
  size = 20,
}: {
  onDelete: () => void;
  pending: boolean;
  size?: number;
}) {
  const theme = useTheme();

  if (pending) {
    return <ActivityIndicator size="small" color={theme.textSecondary} />;
  }

  return (
    <Pressable
      onPress={onDelete}
      hitSlop={8}
      style={({ pressed }) => pressed && styles.pressed}
      accessibilityRole="button"
      accessibilityLabel="Delete this recording's audio">
      {/* v2 Epic D Part 3: neutral theme tint (was a hardcoded #e5484d red)
          so it doesn't jar against the restyled History cards. The
          destructive-red treatment moves onto the "Delete recording" item
          when actions are consolidated into a 3-dot menu in Part 4. */}
      <SymbolView name="trash" size={size} tintColor={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
});
