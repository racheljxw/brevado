import { Tabs, TabList, TabTrigger, TabSlot, TabTriggerSlotProps, TabListProps } from 'expo-router/ui';
import { SymbolView } from 'expo-symbols';
import { Pressable, View, StyleSheet } from 'react-native';

import { ThemedText } from './themed-text';

import { MaxContentWidth, NotoSans, Theme } from '@/constants/theme';

// v2 Epic B Part 2 — the web counterpart of the bottom nav. Unlike the
// native `NativeTabs` (which can only style a subset of the Figma spec —
// see `app-tabs.tsx`), this is a plain custom component, so it renders the
// full spec: the #FFFAF6 capsule with its 2px #FFFEFE stroke, the soft
// #BEA398 drop shadow, and the #DFCFC7 pill behind the active tab. Label
// colour stays constant (#2D1306) regardless of active state — only the
// icon colour and the pill vary.
//
// Web isn't a shipping target (the app runs via Expo Go), but this file
// still has to compile and look right in a browser preview.
// Keyed by the trigger's `href` (slot props don't carry `name`).
const TAB_ICON: Record<string, Parameters<typeof SymbolView>[0]['name']> = {
  '/': 'mic.fill',
  '/history': 'list.bullet',
  '/streaks': 'star.fill',
};

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          {/* v2 Epic A Step 1: three-tab shell — Record / History / Streaks.
              "Record" is the renamed former "Home" tab (route still `/`). */}
          <TabTrigger name="home" href="/" asChild>
            <TabButton>Record</TabButton>
          </TabTrigger>
          <TabTrigger name="history" href="/history" asChild>
            <TabButton>History</TabButton>
          </TabTrigger>
          <TabTrigger name="streaks" href="/streaks" asChild>
            <TabButton>Streaks</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  const iconName = props.href ? TAB_ICON[props.href] : undefined;

  return (
    <Pressable {...props} style={({ pressed }) => [styles.tabButton, pressed && styles.pressed]}>
      <View style={[styles.tabButtonInner, isFocused && styles.tabButtonInnerActive]}>
        {iconName && (
          <SymbolView
            name={iconName}
            size={18}
            tintColor={isFocused ? Theme.colors.navIconActive : Theme.colors.textPrimary}
          />
        )}
        {/* Label colour is constant — active state never changes it. */}
        <ThemedText type="small" style={styles.tabLabel}>
          {children}
        </ThemedText>
      </View>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  return (
    <View {...props} style={styles.tabListContainer}>
      <View style={styles.capsule}>
        <ThemedText type="smallBold" style={styles.brandText}>
          Brevado
        </ThemedText>
        {props.children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    width: '100%',
    padding: Theme.spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  capsule: {
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.xl,
    borderRadius: Theme.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    gap: Theme.spacing.sm,
    maxWidth: MaxContentWidth,
    backgroundColor: Theme.colors.background,
    // The 2px off-white stroke — a deliberate, visible detail.
    borderWidth: 2,
    borderColor: Theme.colors.navStroke,
    // Approximation of the Figma drop shadow (#BEA398, 15%, 0/0 offset,
    // 25 spread, 100 blur). RN/web have no "spread", so blur is bumped to
    // stand in for it; tune once seen in a browser.
    shadowColor: Theme.colors.shadow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 40,
    elevation: 12,
  },
  brandText: {
    marginRight: 'auto',
  },
  pressed: {
    opacity: 0.7,
  },
  tabButton: {
    borderRadius: Theme.radius.pill,
  },
  tabButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.xs,
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.md,
    borderRadius: Theme.radius.pill,
  },
  tabButtonInnerActive: {
    // The active-tab pill — Theme.colors.border (#DFCFC7), reused per spec.
    backgroundColor: Theme.colors.border,
  },
  tabLabel: {
    fontFamily: NotoSans.regular,
    color: Theme.colors.textPrimary,
  },
});
