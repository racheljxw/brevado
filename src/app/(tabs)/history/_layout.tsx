import { Stack } from 'expo-router';

// No native headers anywhere in the app — every screen builds its own
// title/back UI inside a SafeAreaView — so this keeps that convention rather
// than letting the default nested-stack header appear on the detail routes.
export default function HistoryLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
