import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration } from '@/lib/format-time';

/**
 * Play/pause button + progress bar + elapsed/duration labels for a single
 * audio source. Originally built inline as part of `RecordingPlayback` in
 * `src/app/(tabs)/index.tsx` (the post-recording preview); extracted here in
 * Phase 3 Step 1 once the History detail screen needed the same controls for
 * a recording's already-uploaded audio, not just a freshly-recorded local
 * file. `useAudioPlayer(uri)` doesn't care whether `uri` is a local
 * `file://` path or a remote (signed) URL, so no branching is needed here —
 * callers just pass whichever `uri` they have.
 */
export function AudioPlaybackControls({ uri }: { uri: string }) {
  const theme = useTheme();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const togglePlayback = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish) {
      player.seekTo(0);
    }
    player.play();
  };

  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;

  return (
    <View style={styles.container}>
      <Pressable
        style={({ pressed }) => [styles.playButton, { borderColor: theme.text }, pressed && styles.pressed]}
        onPress={togglePlayback}>
        <ThemedText type="smallBold">{status.playing ? 'Pause' : 'Play'}</ThemedText>
      </Pressable>

      <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
        <View style={[styles.progressFill, { backgroundColor: theme.text, width: `${progress * 100}%` }]} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {formatDuration(status.currentTime)} / {formatDuration(status.duration)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  playButton: {
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    borderWidth: StyleSheet.hairlineWidth,
  },
  progressTrack: {
    alignSelf: 'stretch',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  pressed: {
    opacity: 0.7,
  },
});
