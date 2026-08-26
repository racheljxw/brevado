import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

// Phase 3 Step 6 — the "export this recording's audio" action, shared by
// the History list row and detail screen (same sharing rationale as
// `FavoriteStar`/`DeleteAudioButton`). Downloads the file to a temp local
// copy and opens the native share sheet (`shareRecordingAudio`,
// src/lib/recordings.ts) so the user can save it into Files, AirDrop it,
// etc. — pairs naturally with `DeleteAudioButton` as an "export before
// delete" flow, but the two are fully independent: this doesn't check or
// touch anything about deletion, and vice versa.
//
// Sits in the same per-row audio-actions cluster as `DeleteAudioButton`
// (see docs/CLAUDE.md's History section) — not the identity/status cluster
// (favorite, status badge). Callers are responsible for not rendering this
// at all when `audio_deleted` is true — there's no audio left to export, so
// the icon shouldn't be present (rather than present-but-disabled, which
// would just invite a confusing tap).
export function DownloadAudioButton({
  onDownload,
  pending,
  size = 20,
}: {
  onDownload: () => void;
  pending: boolean;
  size?: number;
}) {
  const theme = useTheme();

  if (pending) {
    return <ActivityIndicator size="small" color={theme.textSecondary} />;
  }

  return (
    <Pressable
      onPress={onDownload}
      hitSlop={8}
      style={({ pressed }) => pressed && styles.pressed}
      accessibilityRole="button"
      accessibilityLabel="Download this recording's audio">
      <SymbolView name="square.and.arrow.down" size={size} tintColor={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
});
