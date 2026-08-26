import { Stack } from 'expo-router';

// Phase 3 Step 1: `history.tsx` became this directory (`index.tsx` +
// `[id].tsx`) so a tap on a row can push a detail screen. No native headers
// anywhere else in the app (every screen builds its own title/back UI inside
// a SafeAreaView instead), so this keeps that convention rather than letting
// the default nested-stack header appear only on this one route.
export default function HistoryLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
