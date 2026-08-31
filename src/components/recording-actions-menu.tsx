import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing, Theme } from '@/constants/theme';

// The per-recording "3-dot" actions menu, shared by the History list card and
// the detail screen.
//
// Presentation: a tap on the vertical ellipsis opens a small popover card that
// hovers over the row, right-aligned to the trigger — NOT a full-width bottom
// sheet and NOT the system `ActionSheetIOS` (which can't take `Theme` tokens).
// It reuses the shared `<Card>` treatment, positioned absolutely from the
// trigger's measured on-screen location.
//
// "Delete recording" is the one action gated behind an `Alert.alert`
// confirmation — it's irreversible and destroys the transcript / feedback /
// metrics, not just the re-exportable audio file. "Delete audio" deliberately
// has no confirmation.

export type RecordingMenuAction =
  | 're-practice'
  | 'rename'
  | 'download'
  | 'delete-audio'
  | 'delete-recording'
  | 'regenerate';

type MenuItem = {
  action: RecordingMenuAction;
  label: string;
  icon: SymbolViewProps['name'];
  destructive?: boolean;
};

type Anchor = { x: number; y: number; width: number; height: number };

const MENU_WIDTH = 220;
// Rough per-row height (icon + `small` text + vertical padding) — only used
// to decide whether the popover should open downward or flip above the
// trigger when it's near the bottom of the screen.
const ROW_HEIGHT_ESTIMATE = 44;

export function RecordingActionsMenu({
  canRePractice = false,
  canRename = false,
  canDownload,
  canDeleteAudio,
  canRegenerate,
  busy,
  onSelect,
  iconSize = 20,
  edgeAlign = false,
}: {
  /**
   * The recording is Interview/Story AND has a question (a pool `question_id`
   * or custom text). Never true for Miscellaneous. Tapping it navigates to the
   * Record screen pre-set to re-record that same question.
   */
  canRePractice?: boolean;
  /**
   * "Rename title" is available. The parent flips its own title-editing flag
   * when this fires (the editor is inline in the heading). Not shown on the
   * grouped re-practice chain card, whose heading is the shared question.
   */
  canRename?: boolean;
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
  /**
   * Hug the trigger's right edge instead of centring the glyph in its box —
   * used where the menu is the last item in a row and should line up flush
   * with the content edge (the History list card's date, the accordion
   * header edge).
   */
  edgeAlign?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const triggerRef = useRef<View | null>(null);
  const { width: screenW, height: screenH } = useWindowDimensions();

  const items: MenuItem[] = [
    canRePractice && {
      action: 're-practice',
      label: 'Re-practice this question',
      icon: 'arrow.counterclockwise',
    },
    canRename && { action: 'rename', label: 'Rename title', icon: 'pencil' },
    canDownload && { action: 'download', label: 'Download audio', icon: 'square.and.arrow.down' },
    canDeleteAudio && { action: 'delete-audio', label: 'Delete audio', icon: 'trash' },
    { action: 'delete-recording', label: 'Delete recording', icon: 'trash.fill', destructive: true },
    canRegenerate && { action: 'regenerate', label: 'Regenerate report', icon: 'arrow.clockwise' },
  ].filter(Boolean) as MenuItem[];

  function openMenu() {
    // Measure the trigger in window coords so the popover can be placed right
    // next to it. The Modal below is full-screen at the window origin, so
    // these coords map straight through.
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setOpen(true);
    });
  }

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

  let popoverStyle: { left: number; top: number; width: number } | null = null;
  if (anchor) {
    const estHeight = items.length * ROW_HEIGHT_ESTIMATE + Spacing.two * 2;
    const left = Math.max(
      Spacing.two,
      Math.min(anchor.x + anchor.width - MENU_WIDTH, screenW - MENU_WIDTH - Spacing.two)
    );
    let top = anchor.y + anchor.height + Spacing.one;
    if (top + estHeight > screenH - Spacing.four) {
      top = Math.max(Spacing.four, anchor.y - estHeight - Spacing.one);
    }
    popoverStyle = { left, top, width: MENU_WIDTH };
  }

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={openMenu}
        disabled={busy}
        hitSlop={8}
        style={({ pressed }) => [
          styles.trigger,
          edgeAlign && styles.triggerEdge,
          pressed && styles.triggerPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Recording actions">
        {busy ? (
          <ActivityIndicator size="small" color={Theme.colors.textSecondary} />
        ) : (
          // Three *vertical* dots. The `sf-symbols-typescript` set bundled
          // with this Expo SDK has no `ellipsis.vertical`, so rotate the
          // horizontal `ellipsis` glyph 90°.
          <SymbolView
            name="ellipsis"
            size={iconSize}
            tintColor={Theme.colors.textSecondary}
            style={styles.verticalDots}
          />
        )}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* Transparent backdrop — the popover "hovers" over the row, so no
            dimming; tapping anywhere outside closes it. */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {popoverStyle && (
            <Card style={[styles.popover, popoverStyle]}>
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
                      size={17}
                      tintColor={item.destructive ? Theme.colors.recordRed : Theme.colors.textPrimary}
                    />
                    <ThemedText type="small" style={item.destructive ? styles.destructiveLabel : undefined}>
                      {item.label}
                    </ThemedText>
                  </Pressable>
                </View>
              ))}
            </Card>
          )}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Fixed square box so the trigger lines up with the favorite star beside
  // it (a rotated glyph keeps its original wide/short layout box otherwise).
  trigger: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerEdge: {
    // Hug the row's right edge. The trigger's glyph is a horizontal
    // `ellipsis` rotated 90°, so its layout box stays wide/short and the
    // visible dots sit optically inset from the box edge — `flex-end` plus a
    // negative right margin pulls the dots out flush with the content edge
    // (the card's date, the accordion header edge). Tune on device if needed.
    alignItems: 'flex-end',
    marginRight: -6,
  },
  triggerPressed: {
    opacity: 0.6,
  },
  verticalDots: {
    transform: [{ rotate: '90deg' }],
  },
  backdrop: {
    flex: 1,
  },
  popover: {
    position: 'absolute',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
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
    marginVertical: Spacing.half,
    marginHorizontal: Spacing.two,
  },
});
