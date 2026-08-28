import { View, StyleSheet, type ViewProps } from 'react-native';

import { Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The shared "card" surface for v2. A near-white fill, a 1px **inset**
 * `#56453D` border (RN borders are always drawn inside the box), and the
 * soft `#BEA398` drop shadow from `Theme.shadows.card`.
 *
 * Use this instead of a bare `<ThemedView type="backgroundElement">` for
 * any raised panel/card. It takes the same props as `View`; pass layout
 * (padding, gap, alignment, an overriding `borderRadius`) via `style`.
 *
 * Note: an iOS shadow needs a non-transparent `backgroundColor` (this
 * component sets one) and is clipped by `overflow: 'hidden'` — don't add
 * that to a card that should cast a shadow.
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
