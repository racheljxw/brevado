import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ProfileButton } from '@/components/profile-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing, Theme } from '@/constants/theme';

// v2 — the single top header row shared by the three main tab screens
// (Record / History / Streaks): the "brevado." wordmark on the left, the
// profile icon on the right. This row's position (horizontal gutter,
// top offset) is the one constant every screen lines up against.
//
// Detail/sub-screens (History's detail view, Settings) never render this —
// they render `HeaderBackLink` instead, which reuses the exact same row
// shape (padding, min-height) so the back link sits in precisely the slot
// the "brevado." logo would otherwise occupy. The Record screen does the
// same thing itself once a mode is picked (`selectedMode`): its header
// swaps from this to a `HeaderBackLink` reading "Change mode", rather than
// showing the back link somewhere else on the screen — see `index.tsx`.
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
// through — "Change mode", "Back to History", "Back", "Use prompt
// instead", all identical apart from colour. Noto Sans regular, and a real
// `SymbolView` chevron rather than a "‹" character inline in the text: at
// the same font size as its label, "‹" renders noticeably smaller/thinner
// than the letters beside it (a font-rendering quirk of that one glyph,
// not a sizing mistake), so no font-size bump could make it visually
// match — an icon sized independently of the text is what actually fixes
// that. `BACK_ARROW_SIZE` (16) was picked to sit visually between the old
// inline "‹" glyph (too small) and History's old standalone 18px icon.
const BACK_ARROW_SIZE = 16;

function BackLinkContent({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.backLinkContent}>
      <SymbolView name="chevron.left" size={BACK_ARROW_SIZE} tintColor={color} />
      <ThemedText style={[styles.backLinkLabel, { color }]}>{label}</ThemedText>
    </View>
  );
}

// The header-row variant: same row shape as `AppHeader`, so it can stand
// in for it (History detail's "Back to History", Settings' "Back", and the
// Record screen's "Change mode" once a mode is selected). Coloured
// `textPrimary` — the same colour as the "brevado." wordmark it's standing
// in for, not the link blue.
export function HeaderBackLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
        <BackLinkContent label={label} color={Theme.colors.textPrimary} />
      </Pressable>
    </View>
  );
}

// The inline/body variant: identical arrow + font styling to
// `HeaderBackLink`, but in the app's link blue, matching every other
// interactive body text — used for anything that isn't sitting in the
// header row itself (e.g. `QuestionArea`'s "Use prompt instead", or the
// "Change mode" buttons inside the Record screen's body content). `style`
// passes through to the `Pressable` for a caller's own spacing/alignment.
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
    // `alignSelf: 'stretch'` is load-bearing wherever a parent centres its
    // children (e.g. the Record screen's `safeArea`) rather than stretching
    // them by default — without it this row would shrink-wrap its two
    // children instead of spanning full width, and `justifyContent:
    // 'space-between'` would have nothing to space apart.
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
