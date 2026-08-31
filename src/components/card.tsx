import { View, StyleSheet, type ViewProps } from 'react-native';

import { Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The shared "card" surface: a near-white fill, a 1px inset border, and the
 * soft drop shadow from `Theme.shadows.card`. Takes the same props as `View`;
 * pass layout (padding, gap, alignment, an overriding `borderRadius`) via
 * `style`.
 *
 * Note: an iOS shadow needs a non-transparent `backgroundColor` (set here)
 * and is clipped by `overflow: 'hidden'` — don't add that to a card that
 * should cast a shadow.
 */
export function Card({ style, ...rest }: ViewProps) {
  const theme = useTheme();
  return <View style={[{ backgroundColor: theme.backgroundElement }, styles.card, style]} {...rest} />;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Theme.radius.card,
    borderWidth: 0.25,
    borderColor: Theme.colors.cardBorder,
    ...Theme.shadows.card,
  },
});
