import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing, Theme } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';

// v2 Epic D Part 4 — the per-recording "3-dot" actions menu, shared by the
// History list card (`history/index.tsx`) and the detail screen
// (`history/[id].tsx`). It replaces the old inline row of icon buttons
// (`DownloadAudioButton` / `DeleteAudioButton` + the inline "Regenerate
// report" text action), folding them into one menu and adding the new,
// stronger "Delete recording" action.
//
// Presentation: a tap on the ellipsis opens a themed bottom sheet (a plain
// `Modal` + a dimmed backdrop + a rounded card of rows) rather than the
// system `ActionSheetIOS` — the sheet is fully styleable with `Theme` tokens,
// which the system sheet is not, and this app is a deliberately-designed warm
// palette (see docs/CLAUDE.md's "Design system" section).
//
// "Delete recording" is the one action gated behind a confirmation
// (`Alert.alert`) — it's irreversible and destroys the transcript / feedback
// / metrics, not just the re-exportable audio file. "Delete audio" keeps its
// existing no-confirmation behaviour (an explicit product decision, Phase 3
// Step 5) — losing just the audio while keeping the report is a smaller,
// recoverable-in-spirit loss.

export type RecordingMenuAction = 'download' | 'delete-audio' | 'delete-recording' | 'regenerate';

type MenuItem = {
  action: RecordingMenuAction;
  label: string;
  icon: SymbolViewProps['name'];
  destructive?: boolean;
};

export function RecordingActionsMenu({
  canDownload,
  canDeleteAudio,
  canRegenerate,
  busy,
  onSelect,
  iconSize = 20,
}: {
  /** audio still present (audio_path set and not audio_deleted). */
  canDownload: boolean;
  /** audio still present (not audio_deleted). */
  canDeleteAudio: boolean;
  /** status === 'failed'. */
  canRegenerate: boolean;
  /** any menu action currently in flight for this recording — shows a spinner in place of the ellipsis and blocks re-opening. */
  busy: boolean;
  onSelect: (action: RecordingMenuAction) => void;
  iconSize?: number;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  const items: MenuItem[] = [
    canDownload && { action: 'download', label: 'Download audio', icon: 'square.and.arrow.down' },
    canDeleteAudio && { action: 'delete-audio', label: 'Delete audio', icon: 'trash' },
    { action: 'delete-recording', label: 'Delete recording', icon: 'trash.fill', destructive: true },
    canRegenerate && { action: 'regenerate', label: 'Regenerate report', icon: 'arrow.clockwise' },
  ].filter(Boolean) as MenuItem[];

  function choose(action: RecordingMenuAction) {
    setOpen(false);
    if (action === 'delete-recording') {
      Alert.alert(
        'Delete recording?',
        'This permanently removes the recording and its audio, transcript, feedback and metrics. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => onSelect(action) },
        ]
      );
      return;
    }
    onSelect(action);
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={busy}
        hitSlop={8}
        style={({ pressed }) => pressed && styles.triggerPressed}
        accessibilityRole="button"
        accessibilityLabel="Recording actions">
        {busy ? (
          <ActivityIndicator size="small" color={Theme.colors.textSecondary} />
        ) : (
          <SymbolView name="ellipsis" size={iconSize} tintColor={Theme.colors.textSecondary} />
        )}
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Inner Pressable swallows taps so pressing the sheet itself
              doesn't close it — only the backdrop does. */}
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three }]} onPress={() => {}}>
            {items.map((item, index) => (
              <View key={item.action}>
                {index > 0 && <View style={styles.divider} />}
                <Pressable
                  onPress={() => choose(item.action)}
                  style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}>
                  <SymbolView
                    name={item.icon}
                    size={20}
                    tintColor={item.destructive ? Theme.colors.recordRed : Theme.colors.textPrimary}
                  />
                  <ThemedText type="default" style={item.destructive ? styles.destructiveLabel : undefined}>
                    {item.label}
                  </ThemedText>
                </Pressable>
              </View>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  triggerPressed: {
    opacity: 0.6,
  },
  backdrop: {
    flex: 1,
    // Warm-tinted scrim rather than pure black (see the app-wide
    // "never pure #000000" rule in docs/CLAUDE.md's "Design system").
    backgroundColor: 'rgba(45, 19, 6, 0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Theme.colors.card,
    borderTopLeftRadius: Theme.radius.lg,
    borderTopRightRadius: Theme.radius.lg,
    borderWidth: 0.25,
    borderColor: Theme.colors.cardBorder,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Theme.radius.sm,
  },
  itemPressed: {
    backgroundColor: Theme.colors.border,
  },
  destructiveLabel: {
    color: Theme.colors.recordRed,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.border,
    marginHorizontal: Spacing.three,
  },
});
