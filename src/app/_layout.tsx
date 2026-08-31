import { DefaultTheme, ThemeProvider, type Theme as NavTheme } from '@react-navigation/native';
import { useFonts } from '@expo-google-fonts/noto-sans/useFonts';
import { NotoSans_400Regular } from '@expo-google-fonts/noto-sans/400Regular';
import { NotoSans_500Medium } from '@expo-google-fonts/noto-sans/500Medium';
import { NotoSans_600SemiBold } from '@expo-google-fonts/noto-sans/600SemiBold';
import { NotoSans_700Bold } from '@expo-google-fonts/noto-sans/700Bold';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ThemedView } from '@/components/themed-view';
import { Palette } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth-context';

SplashScreen.preventAutoHideAsync();

// The app is a single warm light theme. Pin React Navigation's container
// theme to the cream palette so screen transitions never flash a white/grey
// ground, regardless of the OS colour scheme.
const navTheme: NavTheme = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    background: Palette.cream,
    card: Palette.cream,
    text: Palette.brownBlack,
    border: Palette.tanGray,
    primary: Palette.brownBlack,
  },
};

export default function RootLayout() {
  // Noto Sans is the app-wide typeface. The family keys here are exactly what
  // `NotoSans` in src/constants/theme.ts references, so any
  // `fontFamily: NotoSans.*` resolves once these are loaded.
  const [fontsLoaded, fontError] = useFonts({
    NotoSans_400Regular,
    NotoSans_500Medium,
    NotoSans_600SemiBold,
    NotoSans_700Bold,
  });

  useEffect(() => {
    if (fontError) {
      // Don't wedge the app on a font failure — fall through to the system
      // sans-serif fallback (RN does this automatically for unknown family
      // names). Just surface it in the logs.
      console.warn('Noto Sans failed to load, falling back to system sans-serif', fontError);
    }
  }, [fontError]);

  // Keep the native splash up until fonts are ready (or definitively
  // failed). `AnimatedSplashOverlay` below is what actually calls
  // `SplashScreen.hideAsync()` once the real tree mounts.
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider value={navTheme}>
      <AnimatedSplashOverlay />
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}

// Gates navigation on auth state: signed-in users only ever see the
// (tabs) group, signed-out users only ever see the login/signup screens.
// `loading` covers the initial session check on app boot so we never
// flash the wrong one first.
function RootNavigator() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
        {/* Settings is a non-tab stack screen, pushed from the header profile
            icon on the three main tab screens. */}
        <Stack.Screen name="settings" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
      </Stack.Protected>
    </Stack>
  );
}
