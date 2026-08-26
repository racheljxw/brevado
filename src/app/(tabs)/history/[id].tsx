import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioPlaybackControls } from '@/components/audio-playback-controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRecordedAt } from '@/lib/format-time';
import { getStatusPresentation } from '@/lib/recording-status';
import {
  fetchRecordingById,
  getRecordingAudioUrl,
  type RecordingDetail,
  type RecordingMetrics,
} from '@/lib/recordings';

type ScreenState = 'loading' | 'not-found' | 'error' | 'loaded';
type AudioState = 'idle' | 'loading' | 'ready' | 'error';

// Turns the stored metrics shape (see docs/CLAUDE.md's "Metrics" section)
// into the display strings this screen shows — `filler_word_rate` is a
// fraction (0.08) that needs converting to a percentage here, and any field
// can individually be null (most commonly `words_per_minute`, when audio
// duration couldn't be read — see the "Failure handling" bullet there).
function formatMetrics(metrics: RecordingMetrics | null) {
  if (!metrics) return null;
  return {
    fillerRate: metrics.filler_word_rate != null ? `${Math.round(metrics.filler_word_rate * 100)}%` : '—',
    wordsPerMinute: metrics.words_per_minute != null ? `${metrics.words_per_minute} wpm` : '—',
    repetitionCount: metrics.repetition_count != null ? `${metrics.repetition_count}` : '—',
  };
}

function BackLink() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.back()} hitSlop={8}>
      <ThemedText type="linkPrimary">‹ Back to History</ThemedText>
    </Pressable>
  );
}

// Audio playback section: reused as-is regardless of the recording's
// `status` — audio finishes uploading (and the row is created) *before*
// backend processing ever starts, so it exists for a pending/processing/
// failed recording just as much as a done one. Only `audio_deleted` (Step 5,
// not built yet — see docs/CLAUDE.md's History section) changes what this
// renders, which is why that check is built now even though the flag is
// always false today.
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
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          Audio deleted — this recording&apos;s audio file has been removed to free up space. Its transcript and
          feedback (below) aren&apos;t affected.
        </ThemedText>
      </ThemedView>
    );
  }

  if (!recording.audio_path) {
    // Shouldn't happen — a row is only ever created after a successful
    // upload (see src/lib/recordings.ts) — but don't let a missing path
    // crash the screen.
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          No audio is available for this recording.
        </ThemedText>
      </ThemedView>
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
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="small">{audioError ?? 'Could not load audio.'}</ThemedText>
        <Pressable onPress={loadAudioUrl}>
          <ThemedText type="linkPrimary">Retry</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return <AudioPlaybackControls uri={audioUrl!} />;
}

// The transcript/metrics/feedback section — only meaningful once the
// pipeline has actually run (see docs/CLAUDE.md's "AI processing endpoint"
// section). `failed` shows its own explanation instead (there's genuinely
// nothing to show — a transcription failure marks the row failed with
// nothing else attempted); `pending`/`processing` shows a plain "still
// working" notice since a row can be tapped into straight from History
// before the pipeline finishes.
function ReportSection({ recording }: { recording: RecordingDetail }) {
  if (recording.status === 'failed') {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="smallBold" style={{ color: '#e5484d' }}>
          Processing failed
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          This recording has no transcript, metrics, or feedback — generating its report failed even after an
          automatic retry. A manual &quot;Regenerate report&quot; action isn&apos;t available yet (coming in a
          later Phase 3 step).
        </ThemedText>
      </ThemedView>
    );
  }

  if (recording.status === 'pending' || recording.status === 'processing') {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          Still processing — transcript, metrics, and feedback will appear here once it&apos;s done.
        </ThemedText>
      </ThemedView>
    );
  }

  const metrics = formatMetrics(recording.metrics);

  return (
    <>
      <View style={styles.section}>
        <ThemedText type="smallBold">Transcript</ThemedText>
        <ThemedText type="default">{recording.transcript ?? 'Not available.'}</ThemedText>
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Metrics</ThemedText>
        {metrics ? (
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.metricRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Filler words
              </ThemedText>
              <ThemedText type="smallBold">{metrics.fillerRate}</ThemedText>
            </View>
            <View style={styles.metricRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Pace
              </ThemedText>
              <ThemedText type="smallBold">{metrics.wordsPerMinute}</ThemedText>
            </View>
            <View style={styles.metricRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Repetitions
              </ThemedText>
              <ThemedText type="smallBold">{metrics.repetitionCount}</ThemedText>
            </View>
          </ThemedView>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Not available.
          </ThemedText>
        )}
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Feedback</ThemedText>
        <ThemedText type="default">{recording.feedback ?? 'Not available.'}</ThemedText>
      </View>
    </>
  );
}

export default function RecordingDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const theme = useTheme();

  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [recording, setRecording] = useState<RecordingDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setScreenState('not-found');
      return;
    }
    setScreenState('loading');
    setLoadError(null);
    try {
      const row = await fetchRecordingById(id);
      if (!row) {
        setScreenState('not-found');
        return;
      }
      setRecording(row);
      setScreenState('loaded');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this recording.');
      setScreenState('error');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const status = recording ? getStatusPresentation(recording.status, theme) : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.backRow}>
          <BackLink />
        </View>

        {screenState === 'loading' && (
          <View style={styles.centerFill}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        )}

        {screenState === 'not-found' && (
          <View style={styles.centerFill}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              This recording couldn&apos;t be found. It may have been removed, or it isn&apos;t yours.
            </ThemedText>
          </View>
        )}

        {screenState === 'error' && (
          <View style={styles.centerFill}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {loadError ?? 'Could not load this recording.'}
            </ThemedText>
            <Pressable onPress={load}>
              <ThemedText type="linkPrimary">Retry</ThemedText>
            </Pressable>
          </View>
        )}

        {screenState === 'loaded' && recording && status && (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.headerRow}>
              <ThemedText type="subtitle">{formatRecordedAt(recording.created_at)}</ThemedText>
              <View style={[styles.statusBadge, { backgroundColor: status.backgroundColor }]}>
                <ThemedText type="smallBold" style={{ color: status.textColor }}>
                  {status.label}
                </ThemedText>
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.modeLabel}>
              {recording.mode}
            </ThemedText>

            <View style={styles.section}>
              <AudioSection recording={recording} />
            </View>

            <ReportSection recording={recording} />
          </ScrollView>
        )}

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
  backRow: {
    paddingTop: Spacing.three,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  centerRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  scrollContent: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  modeLabel: {
    marginTop: -Spacing.one,
  },
  statusBadge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.three,
  },
  section: {
    gap: Spacing.two,
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
