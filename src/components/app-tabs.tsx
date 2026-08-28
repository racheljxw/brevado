import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme ?? 'light'];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      {/* v2 Epic A Step 1: three-tab shell — Record / History / Streaks, in
          the order the design screenshots show. "Record" is the renamed
          former "Home" tab; the route file is still `index.tsx` and the
          recording flow it renders is unchanged. */}
      <NativeTabs.Trigger name="index">
        <Label>Record</Label>
        <Icon src={require('@/assets/images/tabIcons/home.png')} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history">
        <Label>History</Label>
        {/* Reusing the scaffold's "explore" icon — no dedicated history icon asset yet. */}
        <Icon src={require('@/assets/images/tabIcons/explore.png')} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="streaks">
        <Label>Streaks</Label>
        {/* No dedicated streaks icon asset yet — SF Symbol placeholder. */}
        <Icon sf="flame" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
