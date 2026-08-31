import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, Theme } from '@/constants/theme';

// Recording-title editing. "Rename title" in the `RecordingActionsMenu`
// (3-dot menu) flips the parent's editing flag; this component is purely:
// show the title, or (when `editing`) show the inline editor.
//
// `title` is nullable — an older recording, or one where generation returned
// nothing usable. Editing then starts from an empty field (display shows a
// muted "Untitled recording"), so a user can set a title on an older
// recording for the first time. Validation: non-empty after trim, nothing else.
//
// The component owns the in-progress `draft` + its local validation error;
// the parent owns `editing`, the persisted `title`, and the async save
// (`saving` / `saveError`). `onSave` resolves `true` once the write has
// persisted, which is the signal to leave edit mode — so a failed save keeps
// the box open with the error shown, and the displayed title only changes
// after Supabase confirms.
//
// `textStyle` / `compact` let the History list card reuse it at its smaller
// heading size; `hideWhenIdle` is for the chain accordion, where the title
// lives in the panel header and this is only the editor.
export function TitleSection({
  title,
  editing,
  onSave,
  saving,
  saveError,
  onEndEdit,
  textStyle,
  numberOfLines = 3,
  compact = false,
  hideWhenIdle = false,
}: {
  title: string | null;
  editing: boolean;
  onSave: (next: string) => Promise<boolean>;
  saving: boolean;
  saveError: string | null;
  /** Leave edit mode — called both after a successful save and on Cancel. */
  onEndEdit: () => void;
  /** Override the display-text style (the List card passes its 17px heading). */
  textStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** Smaller input box + submit icon, for the History list card. */
  compact?: boolean;
  /**
   * Render nothing when not `editing` — for the chain accordion, where the
   * title is shown in the (always-visible) panel header and this component is
   * only the editor, mounted in the body when "Rename title" fires.
   */
  hideWhenIdle?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  // Seed the draft from the current title whenever editing turns on.
  useEffect(() => {
    if (editing) {
      setDraft(title ?? '');
      setDraftError(null);
    }
    // Only re-seed on the editing transition, not on every `title` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  async function submitDraft() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraftError('Enter a title.');
      return;
    }
    setDraftError(null);
    const ok = await onSave(trimmed);
    if (ok) onEndEdit();
  }

  function cancelEditing() {
    setDraft('');
    setDraftError(null);
    onEndEdit();
  }

  if (editing) {
    return (
      <View style={styles.titleEditSection}>
        <View style={[styles.titleInputBox, compact && styles.titleInputBoxCompact]}>
          <TextInput
            style={[styles.titleInputField, compact && styles.titleInputFieldCompact]}
            placeholder="Recording title"
            placeholderTextColor="#56453D80"
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              if (draftError) setDraftError(null);
            }}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submitDraft}
            editable={!saving}
          />
          {saving ? (
            <ActivityIndicator style={styles.titleSubmit} color={Theme.colors.accent} />
          ) : (
            <Pressable
              onPress={submitDraft}
              hitSlop={8}
              style={({ pressed }) => [styles.titleSubmit, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Save title">
              <SymbolView
                name="arrow.up.circle.fill"
                size={compact ? 22 : 26}
                tintColor={Theme.colors.accent}
              />
            </Pressable>
          )}
        </View>
        {(draftError || saveError) && (
          <ThemedText type="small" style={styles.errorText}>
            {draftError ?? saveError}
          </ThemedText>
        )}
        <Pressable
          onPress={cancelEditing}
          hitSlop={8}
          disabled={saving}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="link">Cancel</ThemedText>
        </Pressable>
      </View>
    );
  }

  if (hideWhenIdle) return null;

  return (
    <ThemedText
      themeColor={title ? 'text' : 'textSecondary'}
      numberOfLines={numberOfLines}
      style={[styles.titleText, styles.titleFlex, textStyle]}>
      {title ?? 'Untitled recording'}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  titleFlex: {
    flex: 1,
  },
  titleText: {
    fontFamily: Theme.typography.fontFamily.bold,
    fontSize: 24,
    lineHeight: 30,
  },
  titleEditSection: {
    flex: 1,
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  titleInputBox: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    backgroundColor: Theme.colors.card,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radius.lg,
    paddingLeft: Theme.spacing.lg,
    paddingRight: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
  },
  titleInputBoxCompact: {
    borderRadius: Theme.radius.card,
    paddingLeft: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
  },
  titleInputField: {
    flex: 1,
    minHeight: 32,
    paddingVertical: Theme.spacing.xs,
    fontFamily: Theme.typography.fontFamily.regular,
    fontSize: 20,
    lineHeight: 26,
    color: Theme.colors.textPrimary,
  },
  titleInputFieldCompact: {
    minHeight: 24,
    fontSize: 15,
    lineHeight: 20,
  },
  titleSubmit: {
    paddingVertical: Theme.spacing.xs,
  },
  errorText: {
    color: '#e5484d',
  },
  pressed: {
    opacity: 0.7,
  },
});
