import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, NotoSans, Theme, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

// v2 Epic B: Noto Sans, one loaded family per weight (see `NotoSans` in
// src/constants/theme.ts and `useFonts` in src/app/_layout.tsx). Weight is
// carried by the family name, so there's no `fontWeight` alongside it —
// that avoids faux-bold doubling on Android. Sizes/line-heights are
// unchanged from the v1 scale; Epic C/D reconciles these `type`s with
// `Theme.typography.variants`.
const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: NotoSans.medium,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: NotoSans.bold,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: NotoSans.medium,
  },
  title: {
    fontSize: 48,
    lineHeight: 52,
    fontFamily: NotoSans.semiBold,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontFamily: NotoSans.semiBold,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
    fontFamily: NotoSans.regular,
    // The one app-wide link blue. Single source of truth — see
    // `Theme.colors.link` in src/constants/theme.ts. (Replaced the old
    // `linkPrimary` type and its hardcoded `#3c87f7`.)
    color: Theme.colors.link,
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
