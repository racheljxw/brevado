import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// A personal star marker on a recording, purely cosmetic — no automated
// behavior is attached (no retention exemption, no confirmation gate on
// delete). Shared by the History list row, the detail screen, and the
// re-practice chain header.
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
