import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Theme } from '@/constants/theme';
import { formatDuration } from '@/lib/format-time';

/**
 * Play/pause button + progress bar + elapsed/duration labels for a single
 * audio source, shared by the History detail screen and the Home tab's
 * post-recording preview (`RecordingPlayback`). `useAudioPlayer(uri)` doesn't
 * care whether `uri` is a local `file://` path or a remote signed URL, so no
 * branching is needed — callers pass whichever they have.
 */
export function AudioPlaybackControls({ uri }: { uri: string }) {
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
        style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
        onPress={togglePlayback}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause' : 'Play'}>
        <SymbolView
          name={status.playing ? 'pause.fill' : 'play.fill'}
          size={14}
          tintColor={Theme.colors.onAccent}
        />
        <ThemedText type="smallBold" style={styles.playLabel}>
          {status.playing ? 'Pause' : 'Play'}
        </ThemedText>
      </Pressable>

      <View style={styles.progressRow}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.timeText}>
          {formatDuration(status.currentTime)} / {formatDuration(status.duration)}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Theme.spacing.md,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.xs,
    backgroundColor: Theme.colors.accent,
    paddingHorizontal: Theme.spacing.xl,
    paddingVertical: Theme.spacing.sm,
    borderRadius: Theme.radius.pill,
  },
  playLabel: {
    color: Theme.colors.onAccent,
  },
  progressRow: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: Theme.spacing.xs,
  },
  progressTrack: {
    alignSelf: 'stretch',
    height: 6,
    borderRadius: Theme.radius.pill,
    backgroundColor: Theme.colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Theme.colors.accent,
    borderRadius: Theme.radius.pill,
  },
  timeText: {
    alignSelf: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
