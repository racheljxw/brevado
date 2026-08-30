import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AudioPlaybackControls } from '@/components/audio-playback-controls';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing, Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getRecordingAudioUrl, type RecordingDetail } from '@/lib/recordings';

// v4 Epic J Part 2 — the shared "body" of a single recording's detail view:
// Question → Audio → (Scores → Feedback → Transcript), or the failed /
// still-processing notice. Pulled out of `history/[id].tsx` so BOTH the
// single-recording detail screen and each accordion panel on the re-practice
// chain screen (`history/chain/[rootId].tsx`) render the exact same content
// instead of duplicating this layout.
//
// What each parent composes AROUND this differs and stays with the parent:
//   - `history/[id].tsx`: the editable title + favorite star + 3-dot menu
//     header row, and a mode-pill / date meta row.
//   - `history/chain/[rootId].tsx`: the shared question + mode pill + favorite
//     star live once at the CHAIN header; each panel has its own collapse
//     header (date + status + its own 3-dot menu) and renders `<TitleSection>`
//     + this body when expanded.
//
// Everything below (`AudioSection`, `ScoresRow`, `ReportSection`) moved here
// verbatim from `history/[id].tsx` — behaviour unchanged, only the file.

type AudioState = 'idle' | 'loading' | 'ready' | 'error';

// Audio playback section: reused as-is regardless of the recording's
// `status` — audio finishes uploading (and the row is created) *before*
// backend processing ever starts, so it exists for a pending/processing/
// failed recording just as much as a done one. Only `audio_deleted` changes
// what this renders.
//
// v2 Epic D Part 7 — every branch renders inside the same `<Card>` treatment
// (via the wrapper in `RecordingDetailBody`) so the audio section always
// reads as one consistent playback panel.
function AudioSection({ recording }: { recording: RecordingDetail }) {
  const theme = useTheme();
  const [audioState, setAudioState] = useState<AudioState>('idle');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const loadAudioUrl = useCallback(() => {
    if (!recording.audio_path) return;
    setAudioState('loading');
    setAudioError(null);
    getRecordingAudioUrl(recording.audio_path)
      .then((url) => {
        setAudioUrl(url);
        setAudioState('ready');
      })
      .catch((err) => {
        setAudioError(err instanceof Error ? err.message : 'Could not load audio.');
        setAudioState('error');
      });
  }, [recording.audio_path]);

  useEffect(() => {
    if (recording.audio_deleted || !recording.audio_path) return;
    loadAudioUrl();
  }, [recording.audio_deleted, recording.audio_path, loadAudioUrl]);

  if (recording.audio_deleted) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Audio deleted — this recording&apos;s audio file has been removed to free up space. Its transcript and
        feedback below aren&apos;t affected.
      </ThemedText>
    );
  }

  if (!recording.audio_path) {
    // Shouldn't happen — a row is only ever created after a successful
    // upload (see src/lib/recordings.ts) — but don't let a missing path
    // crash the screen.
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No audio is available for this recording.
      </ThemedText>
    );
  }

  if (audioState === 'loading' || audioState === 'idle') {
    return (
      <View style={styles.centerRow}>
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    );
  }

  if (audioState === 'error') {
    return (
      <View style={styles.audioErrorWrap}>
        <ThemedText type="small">{audioError ?? 'Could not load audio.'}</ThemedText>
        <Pressable onPress={loadAudioUrl}>
          <ThemedText type="link">Retry</ThemedText>
        </Pressable>
      </View>
    );
  }

  return <AudioPlaybackControls uri={audioUrl!} />;
}

// v3 Epic F Step 1 — the three per-recording scores (Impact / Clarity /
// Structure, that display order), shown as compact badges in one Card,
// separated by hairline dividers. Plain percentages, no trend arrows — a
// single recording has no history to trend against. All three null → one
// plain line instead of a card of dashes.
function ScoresRow({ recording }: { recording: RecordingDetail }) {
  const scores = [
    { label: 'Impact', value: recording.impact_score },
    { label: 'Clarity', value: recording.clarity_score },
    { label: 'Structure', value: recording.structure_score },
  ];

  if (scores.every((s) => s.value == null)) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Scores aren&apos;t available for this recording.
      </ThemedText>
    );
  }

  const nodes: ReactNode[] = [];
  scores.forEach((score, i) => {
    if (i > 0) nodes.push(<View key={`divider-${score.label}`} style={styles.scoreDivider} />);
    nodes.push(
      <View key={score.label} style={styles.scoreStat}>
        <ThemedText style={styles.scoreValue}>{score.value != null ? `${score.value}%` : '—'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {score.label}
        </ThemedText>
      </View>
    );
  });

  return <Card style={styles.scoresCard}>{nodes}</Card>;
}

// The scores/feedback/transcript section — only meaningful once the pipeline
// has actually run. `failed` shows its own explanation + a "Regenerate
// report" button; `pending`/`processing` shows a plain "still working" notice.
function ReportSection({
  recording,
  onRegenerate,
  regenerating,
  regenerateError,
}: {
  recording: RecordingDetail;
  onRegenerate: () => void;
  regenerating: boolean;
  regenerateError: string | null;
}) {
  if (recording.status === 'failed') {
    return (
      <Card style={styles.noticeCard}>
        <ThemedText type="smallBold" style={styles.failedHeading}>
          Processing failed
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          This recording has no transcript, scores, or feedback — generating its report failed even after an
          automatic retry.
        </ThemedText>
        {regenerateError && (
          <ThemedText type="small" style={styles.errorText}>
            {regenerateError}
          </ThemedText>
        )}
        <Pressable
          style={({ pressed }) => [styles.regenerateButton, (pressed || regenerating) && styles.pressed]}
          disabled={regenerating}
          onPress={onRegenerate}>
          {regenerating ? (
            <ActivityIndicator size="small" color={Theme.colors.onAccent} />
          ) : (
            <ThemedText type="smallBold" style={styles.regenerateButtonLabel}>
              Regenerate report
            </ThemedText>
          )}
        </Pressable>
      </Card>
    );
  }

  if (recording.status === 'pending' || recording.status === 'processing') {
    return (
      <Card style={styles.noticeCard}>
        <ThemedText type="small" themeColor="textSecondary">
          Still processing — scores, feedback, and transcript will appear here once it&apos;s done.
        </ThemedText>
      </Card>
    );
  }

  return (
    <>
      <View style={styles.section}>
        <ThemedText type="smallBold" style={styles.sectionHeading}>
          Scores
        </ThemedText>
        <ScoresRow recording={recording} />
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold" style={styles.sectionHeading}>
          Feedback
        </ThemedText>
        <ThemedText type="default" style={styles.bodyText}>
          {recording.feedback ?? 'Not available.'}
        </ThemedText>
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold" style={styles.sectionHeading}>
          Transcript
        </ThemedText>
        <ThemedText type="default" style={styles.bodyText}>
          {recording.transcript ?? 'Not available.'}
        </ThemedText>
      </View>
    </>
  );
}

export function RecordingDetailBody({
  recording,
  onRegenerate,
  regenerating,
  regenerateError,
}: {
  recording: RecordingDetail;
  onRegenerate: () => void;
  regenerating: boolean;
  regenerateError: string | null;
}) {
  return (
    <>
      {/* Question, always shown — a null question (miscellaneous, or an
          interview/story lookup edge case) reads as the literal "No prompt"
          rather than being omitted. */}
      <View style={styles.section}>
        <ThemedText type="smallBold" style={styles.sectionHeading}>
          Question
        </ThemedText>
        <ThemedText type="default" style={styles.bodyText}>
          {recording.question ?? 'No prompt'}
        </ThemedText>
      </View>

      <Card style={styles.audioCard}>
        <AudioSection recording={recording} />
      </Card>

      <ReportSection
        recording={recording}
        onRegenerate={onRegenerate}
        regenerating={regenerating}
        regenerateError={regenerateError}
      />
    </>
  );
}

const styles = StyleSheet.create({
  centerRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.four,
  },
  audioErrorWrap: {
    gap: Spacing.two,
    alignItems: 'center',
  },
  errorText: {
    color: '#e5484d',
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeading: {
    fontSize: 16,
  },
  bodyText: {
    ...Theme.typography.variants.body,
    color: Theme.colors.textPrimary,
  },
  audioCard: {
    padding: Spacing.four,
    alignItems: 'center',
  },
  noticeCard: {
    gap: Spacing.two,
    padding: Spacing.three,
  },
  failedHeading: {
    color: Theme.colors.recordRed,
  },
  scoresCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.three,
  },
  scoreStat: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.half,
  },
  scoreValue: {
    fontFamily: Theme.typography.fontFamily.bold,
    fontSize: 18,
    lineHeight: 22,
    color: Theme.colors.textPrimary,
  },
  scoreDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: Theme.colors.border,
  },
  regenerateButton: {
    alignSelf: 'flex-start',
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Theme.radius.pill,
    backgroundColor: Theme.colors.recordRed,
  },
  regenerateButtonLabel: {
    color: Theme.colors.onAccent,
  },
  pressed: {
    opacity: 0.7,
  },
});
