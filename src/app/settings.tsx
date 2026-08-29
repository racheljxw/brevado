import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HeaderBackLink } from '@/components/app-header';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

// v2 Epic A Step 2 — the Settings screen. A non-tab stack screen, pushed
// from the header profile icon (`ProfileButton`) on the three main tab
// screens. This is where sign-out lives now (migrated off the old
// Phase 1 "Sign out" button on the Record tab). Styling is intentionally
// plain — Epic B's redesign pass restyles this along with everything else.
export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    // On success the root navigator's auth guard flips and swaps this whole
    // stack out for the login screen, so there's nothing to navigate here.
    const result = await signOut();
    if (result.error) {
      setError(result.error);
      setSigningOut(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <HeaderBackLink label="Back" onPress={() => router.back()} />

        <View style={styles.content}>
          <ThemedText type="subtitle" style={styles.title}>
            Settings
          </ThemedText>

          <Card style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              Signed in as
            </ThemedText>
            <ThemedText type="smallBold">{user?.email ?? '—'}</ThemedText>
          </Card>

          <View style={styles.spacer} />

          {error && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.error}>
              {error}
            </ThemedText>
          )}

          <Pressable
            onPress={handleSignOut}
            disabled={signingOut}
            style={({ pressed }) => [
              styles.signOutButton,
              (pressed || signingOut) && styles.pressed,
            ]}>
            <ThemedText type="smallBold">{signingOut ? 'Signing out…' : 'Sign Out'}</ThemedText>
          </Pressable>
        </View>

        {Platform.OS === 'web' && <WebBadge />}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    // NB: horizontal gutter/gap live on `content` below, not here —
    // `HeaderBackLink` owns its own padding, so a shared one here would double
    // up on its row. See the matching note in `history/index.tsx`.
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    paddingTop: Spacing.one,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  spacer: {
    flex: 1,
  },
  error: {
    textAlign: 'center',
  },
  signOutButton: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5484d',
  },
  pressed: {
    opacity: 0.6,
  },
});
