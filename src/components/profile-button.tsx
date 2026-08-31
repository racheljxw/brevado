import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

// The header profile icon that opens the Settings screen
// (`src/app/settings.tsx`, a stack push, not a tab). Rendered only on the
// three main tab screens (Record / History / Streaks), never on a
// detail/sub-screen.
export function ProfileButton({ size = 26 }: { size?: number }) {
  const router = useRouter();
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => router.push('/settings')}
      hitSlop={8}
      style={({ pressed }) => pressed && styles.pressed}
      accessibilityRole="button"
      accessibilityLabel="Open settings">
      <SymbolView name="person.crop.circle" size={size} tintColor={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
});
