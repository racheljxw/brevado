import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ProfileButton } from '@/components/profile-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing, Theme } from '@/constants/theme';

// The single top header row shared by the three main tab screens (Record /
// History / Streaks): the "brevado." wordmark on the left, the profile icon
// on the right. Its position (gutter, top offset) is the constant every
// screen lines up against.
//
// Detail/sub-screens render `HeaderBackLink` instead, which reuses the same
// row shape so the back link sits exactly where the wordmark would. The
// Record screen swaps to a `HeaderBackLink` reading "Change mode" once a mode
// is picked.
const HEADER_ROW_HEIGHT = 28;

export function AppHeader() {
  return (
    <View style={styles.row}>
      <ThemedText style={styles.logo}>brevado.</ThemedText>
      <ProfileButton />
    </View>
  );
}

// The one back-arrow-plus-label look every back link in the app renders
// through — identical apart from colour. Uses a real `SymbolView` chevron
// rather than a "‹" character: at the same font size as its label, "‹"
// renders noticeably smaller and thinner than the letters beside it, so an
// icon sized independently of the text is the only way to make it match.
const BACK_ARROW_SIZE = 16;

function BackLinkContent({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.backLinkContent}>
      <SymbolView name="chevron.left" size={BACK_ARROW_SIZE} tintColor={color} />
      <ThemedText style={[styles.backLinkLabel, { color }]}>{label}</ThemedText>
    </View>
  );
}

// The header-row variant: same row shape as `AppHeader`, so it stands in for
// it on detail screens. Coloured `textPrimary` — the same colour as the
// "brevado." wordmark it replaces, not the link blue.
export function HeaderBackLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
        <BackLinkContent label={label} color={Theme.colors.textPrimary} />
      </Pressable>
    </View>
  );
}

// The inline/body variant: identical arrow + font styling to `HeaderBackLink`
// but in the app's link blue, for a back link that isn't in the header row
// itself (e.g. `QuestionArea`'s "Use prompt instead"). `style` passes through
// to the `Pressable`.
export function BackLink({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [style, pressed && styles.pressed]}>
      <BackLinkContent label={label} color={Theme.colors.link} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    // Load-bearing wherever a parent centres its children rather than
    // stretching them (e.g. the Record screen's `safeArea`): without it the
    // row shrink-wraps its two children and `space-between` has nothing to
    // space apart.
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: HEADER_ROW_HEIGHT,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  logo: {
    fontFamily: Theme.typography.fontFamily.bold,
    fontSize: 20,
    lineHeight: HEADER_ROW_HEIGHT,
    color: Theme.colors.textPrimary,
  },
  backLinkContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  backLinkLabel: {
    fontFamily: Theme.typography.fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.7,
  },
});
