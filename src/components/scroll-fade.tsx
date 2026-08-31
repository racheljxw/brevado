import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Palette } from '@/constants/theme';

// A cream→transparent vertical fade used wherever a fixed header sits above a
// scrollable region, so content dissolves into the background as it scrolls up
// instead of hard-cutting at a rigid edge.
//
// This project has no `expo-linear-gradient`, so the "gradient" is a stack of
// thin non-overlapping `flex: 1` bands at linearly-decreasing opacity — cream
// at full opacity up top (seamless with the header), 0 at the bottom.
//
// Always placed `position: absolute` over the top of the scroll area, with
// the scroll content inset (`paddingTop`) by roughly the fade's height so
// nothing hides behind it at rest. `pointerEvents="none"` so it never eats a
// scroll/tap.
//
//   - `SCROLL_FADE_HEIGHT` — the standard strip height.
//   - `opaqueFraction` — keep the first N% of the height fully opaque before
//     the fade begins (the History filter zone wants the pill row itself
//     backed by solid cream, then the fade starting ~mid-pill).

const BANDS = 16;
export const SCROLL_FADE_HEIGHT = 22;

export function ScrollFade({
  style,
  opaqueFraction = 0,
}: {
  style?: StyleProp<ViewStyle>;
  opaqueFraction?: number;
}) {
  const solid = Math.max(0, Math.min(BANDS - 1, Math.round(BANDS * opaqueFraction)));
  const fadeBands = BANDS - solid;
  return (
    <View style={style} pointerEvents="none">
      {Array.from({ length: BANDS }).map((_, i) => {
        const opacity = i < solid ? 1 : 1 - (i - solid) / (fadeBands - 1 || 1);
        return (
          <View
            key={i}
            style={{ flex: 1, backgroundColor: Palette.cream, opacity: Math.max(0, opacity) }}
          />
        );
      })}
    </View>
  );
}
