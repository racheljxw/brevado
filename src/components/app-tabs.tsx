import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';

import { NotoSans, Theme } from '@/constants/theme';

// The bottom nav, styled as closely to the design as the SYSTEM tab bar
// allows. `NativeTabs` renders the real UIKit tab bar, which only exposes:
//   - `backgroundColor`   → the capsule fill            ✓ applied
//   - `labelStyle`        → label colour + font         ✓ applied
//   - `iconColor`         → per-state icon colour       ✓ applied
//   - `shadowColor`       → the bar's top hairline      ~ approximation
//   - `indicatorColor`    → active-tab pill (Android/web only)
//
// The design's 2px capsule stroke, real spread+blur drop shadow, and tan
// active-tab pill on iOS are NOT reachable with the system tab bar — doing
// those would mean a custom JS tab bar. The web tab bar (`app-tabs.web.tsx`)
// is a custom component and renders all of it.
export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor={Theme.colors.background}
      // Label colour is constant regardless of active state — only the icon
      // colour and pill background vary. Set the same value for both states
      // so the system doesn't apply its own selected tint to the label.
      labelStyle={{
        default: { color: Theme.colors.textPrimary, fontFamily: NotoSans.regular },
        selected: { color: Theme.colors.textPrimary, fontFamily: NotoSans.regular },
      }}
      iconColor={{
        default: Theme.colors.textPrimary,
        selected: Theme.colors.navIconActive,
      }}
      // Android/web only; no effect on iOS's system tab bar (kept so the
      // value is declared in one place).
      indicatorColor={Theme.colors.border}
      // iOS: tints the tab bar's top hairline. Not a real drop shadow —
      // UIKit has no spread/blur bar-shadow API — just the closest knob.
      shadowColor={Theme.colors.shadow}>
      <NativeTabs.Trigger name="index">
        <Label>Record</Label>
        <Icon sf={{ default: 'mic', selected: 'mic.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history">
        <Label>History</Label>
        <Icon sf="list.bullet" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="streaks">
        <Label>Streaks</Label>
        <Icon sf={{ default: 'star', selected: 'star.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
