import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, Theme } from '@/constants/theme';

// v2 Epic D Part 2 — inline recording-title editing. Mirrors the
// custom-question pencil-edit in `src/app/(tabs)/index.tsx`'s `QuestionArea`
// (Epic C Part 3): display state = the text + a pencil; tapping the pencil
// opens a bordered input box (Theme tokens, icon submit) pre-filled with the
// current value; confirm saves, "Cancel" reverts.
//
// `title` is nullable — a recording from before Part 1, or one where
// generation returned nothing usable. Editing then just starts from an empty
// field (display shows a muted "Untitled recording"), so a user can set a
// title on an older recording for the first time. Validation matches custom
// questions exactly: non-empty after trim, nothing else.
//
// The component owns the in-progress `draft` + its local validation error and
// whether the box is open (`editing`); the parent owns the persisted `title`
// and the async save (`saving` / `saveError`). `onSave` resolves `true` once
// the write has actually persisted, which is the signal to close the editor —
// so a failed save keeps the box open with the error shown, and the displayed
// title only ever changes after Supabase confirms.
//
// v2 Epic D Part 7 — restyled as a large bold heading (was the `subtitle`
// `ThemedText` type). Purely visual — the interaction/validation are
// unchanged from Part 2.
//
// v4 Epic J Part 2 — pulled out of `history/[id].tsx` into this shared
// component so the re-practice chain detail screen
// (`history/chain/[rootId].tsx`) can render an editable title per accordion
// panel using the exact same widget. Behaviour is identical to the Part 2/7
// version; only its home moved.
export function TitleSection({
  title,
  onSave,
  saving,
  saveError,
  onCancelEdit,
}: {
  title: string | null;
  onSave: (next: string) => Promise<boolean>;
  saving: boolean;
  saveError: string | null;
  onCancelEdit: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  function beginEditing() {
    setDraft(title ?? '');
    setDraftError(null);
    setEditing(true);
  }

  async function submitDraft() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraftError('Enter a title.');
      return;
    }
    setDraftError(null);
    const ok = await onSave(trimmed);
    if (ok) setEditing(false);
  }

  function cancelEditing() {
    setEditing(false);
    setDraft('');
    setDraftError(null);
    onCancelEdit();
  }

  if (editing) {
    return (
      <View style={styles.titleEditSection}>
        <View style={styles.titleInputBox}>
          <TextInput
            style={styles.titleInputField}
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
              <SymbolView name="arrow.up.circle.fill" size={26} tintColor={Theme.colors.accent} />
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

  return (
    <View style={styles.titleRow}>
      <ThemedText
        themeColor={title ? 'text' : 'textSecondary'}
        numberOfLines={3}
        style={[styles.titleText, styles.titleFlex]}>
        {title ?? 'Untitled recording'}
      </ThemedText>
      <Pressable
        onPress={beginEditing}
        hitSlop={8}
        style={({ pressed }) => [styles.titleEditPencil, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Edit title">
        <SymbolView name="pencil" size={18} tintColor={Theme.colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    flex: 1,
  },
  titleFlex: {
    flexShrink: 1,
  },
  titleText: {
    fontFamily: Theme.typography.fontFamily.bold,
    fontSize: 24,
    lineHeight: 30,
  },
  titleEditPencil: {
    // nudge the pencil onto the first line's optical centre, same as
    // QuestionArea's `editPencil`.
    marginTop: Spacing.one,
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
  titleInputField: {
    flex: 1,
    minHeight: 32,
    paddingVertical: Theme.spacing.xs,
    fontFamily: Theme.typography.fontFamily.regular,
    fontSize: 20,
    lineHeight: 26,
    color: Theme.colors.textPrimary,
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
