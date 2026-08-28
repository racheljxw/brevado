import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileButton } from '@/components/profile-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { MaxContentWidth, Spacing } from '@/constants/theme';

// Epic A, Step 1 (v2): the third bottom-nav tab. Intentionally an empty
// placeholder for now — real streak content (the streak calendar,
// progress-over-time) is v3 / Phase 6. This step only puts the app onto
// the three-tab shape (Record / History / Streaks); nothing here is
// functional yet.
export default function StreaksScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.headerRow}>
          <ThemedText type="subtitle" style={styles.title}>
            Streaks
          </ThemedText>
          <ProfileButton />
        </View>

        <View style={styles.centerFill}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.comingSoon}>
            Coming soon — this is where your practice streak and progress over time will live.
          </ThemedText>
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
    paddingHorizontal: Spacing.four,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comingSoon: {
    textAlign: 'center',
  },
});
