import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';

import { NotoSans, Theme } from '@/constants/theme';

// v2 Epic B Part 2 — the bottom nav, styled to the Figma spec as closely
// as the SYSTEM tab bar allows.
//
// The design calls for a floating capsule with a 2px off-white stroke and
// a soft #BEA398 drop shadow, plus a warm-tan pill behind the active tab.
// `NativeTabs` renders the real UIKit tab bar, which exposes only:
//   - `backgroundColor`   → the capsule fill (#FFFAF6)          ✓ applied
//   - `labelStyle`        → label colour + font                 ✓ applied
//   - `iconColor`         → per-state icon colour               ✓ applied
//   - `shadowColor`       → the bar's top hairline separator    ~ approximation
//   - `indicatorColor`    → active-tab pill (Android/web only)  ✗ no effect on iOS
//
// NOT reachable with the system tab bar, and therefore NOT done here (see
// docs/CLAUDE.md's "Design system" → nav bar): the 2px capsule stroke, the
// real spread+blur drop shadow, and the tan active-tab pill on iOS. Doing
// those means replacing `NativeTabs` with a custom JS tab bar, which was
// explicitly declined for this pass. The web tab bar
// (`app-tabs.web.tsx`) renders all of it, since it's a custom component.
export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor={Theme.colors.background}
      // Label colour is CONSTANT regardless of active state, per the Figma
      // spec — only the icon colour and the pill background vary. Set the
      // same value for both states so the system doesn't apply its own
      // selected tint to the label.
      labelStyle={{
        default: { color: Theme.colors.textPrimary, fontFamily: NotoSans.regular },
        selected: { color: Theme.colors.textPrimary, fontFamily: NotoSans.regular },
      }}
      iconColor={{
        default: Theme.colors.textPrimary, // inactive icon #2D1306
        selected: Theme.colors.navIconActive, // active icon #B63700
      }}
      // Android/web only — the active-tab pill. No effect on iOS's system
      // tab bar (kept so the value is declared in one place).
      indicatorColor={Theme.colors.border}
      // iOS: tints the tab bar's top hairline. This is NOT the Figma drop
      // shadow (UIKit has no spread/blur bar-shadow API) — it's the
      // closest single knob the system bar exposes. Expect to revisit once
      // seen on a device.
      shadowColor={Theme.colors.shadow}>
      {/* v2 Epic A Step 1: three-tab shell — Record / History / Streaks, in
          the order the design screenshots show. "Record" is the renamed
          former "Home" tab; the route file is still `index.tsx` and the
          recording flow it renders is unchanged. */}
      <NativeTabs.Trigger name="index">
        <Label>Record</Label>
        {/* v2 Epic B: a microphone, not the Expo template's leftover house. */}
        <Icon sf={{ default: 'mic', selected: 'mic.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history">
        <Label>History</Label>
        <Icon sf="list.bullet" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="streaks">
        <Label>Streaks</Label>
        {/* Placeholder tab (v3 fills it in) — a star stands in until then. */}
        <Icon sf={{ default: 'star', selected: 'star.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
