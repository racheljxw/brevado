import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Phase 3 Step 4 — a personal star marker on a recording, purely cosmetic:
// see docs/CLAUDE.md's History section for the explicit note that this has
// no automated behavior attached (no retention exemption, no confirmation
// gate on delete). Shared by the History list row and detail screen so the
// icon/color reads identically in both places (same reasoning as
// `getStatusPresentation` in `recording-status.ts`).
//
// Uses `expo-symbols` (SF Symbols), matching the existing convention set by
// `Collapsible` (`src/components/ui/collapsible.tsx`) — this app only runs
// via Expo Go on iOS today (see docs/CLAUDE.md's Conventions section), so an
// iOS-only icon source is already an accepted tradeoff elsewhere.
export function FavoriteStar({
  favorite,
  onToggle,
  disabled,
  size = 22,
}: {
  favorite: boolean;
  onToggle: () => void;
  disabled?: boolean;
  size?: number;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => pressed && styles.pressed}
      accessibilityRole="button"
      accessibilityLabel={favorite ? 'Unfavorite this recording' : 'Favorite this recording'}>
      <SymbolView
        name={favorite ? 'star.fill' : 'star'}
        size={size}
        tintColor={favorite ? Theme.colors.favoriteGold : theme.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
});
