import { Stack } from 'expo-router';

// v3 Epic G Part 3: `streaks.tsx` became this directory (`index.tsx` +
// `[metric].tsx`) so a card's "See details" link can push a per-metric
// detail screen. No native headers anywhere in the app (every screen builds
// its own back UI inside a SafeAreaView), so this mirrors `history/_layout.tsx`
// rather than letting the default nested-stack header appear on this route.
export default function StreaksLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
