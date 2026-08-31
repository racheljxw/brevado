import { Stack } from 'expo-router';

// No native headers anywhere in the app — every screen builds its own back UI
// inside a SafeAreaView — so this mirrors `history/_layout.tsx` rather than
// letting the default nested-stack header appear on the detail route.
export default function StreaksLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
