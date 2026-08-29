import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioPlaybackControls } from '@/components/audio-playback-controls';
import { Card } from '@/components/card';
import { ProfileButton } from '@/components/profile-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing, Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { startProcessing } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDuration } from '@/lib/format-time';
import { pickQuestionForMode } from '@/lib/question-selection';
import type { Question } from '@/lib/questions';
import {
  buildAudioPath,
  getActiveRecordingCount,
  MAX_RECORDINGS_PER_USER,
  RecordingUploadError,
  uploadRecording,
  type RecordingMode,
  type RecordingUploadStage,
} from '@/lib/recordings';

// Phase 4 Step 2/3: the Record tab (formerly "Home") is a small local flow rather than jumping
// straight into recording — 'mode-select' (the entry point) -> either
// 'question' (Interview/Story — Step 3's real question-selection screen,
// replacing Step 2's placeholder) or 'record' (Miscellaneous, and
// Interview/Story once a question's been picked) -> the existing
// record/upload UI below. This is plain local state, not separate Expo
// Router routes — matching how this same file already switched between its
// record-button/playback/cap-blocked "screens" before Step 2; see
// docs/CLAUDE.md's History section for the one place in this app that *does*
// use real nested routes (list -> detail), which needs an actual back stack
// and deep-linkable URL in a way this flow doesn't (yet).
type FlowScreen = 'mode-select' | 'question' | 'record';
type Mode = RecordingMode;

const MODE_LABELS: Record<'interview' | 'story', string> = {
  interview: 'Interview',
  story: 'Story',
};

type PermissionState = 'unknown' | 'granted' | 'denied';
type UploadState = 'idle' | 'uploading' | 'error' | 'done';
type UploadErrorInfo = { message: string; stage: RecordingUploadStage };

function RecordingPlayback({
  uri,
  uploadState,
  uploadError,
  uploadedRecordingId,
  onKeep,
  onDiscard,
}: {
  uri: string;
  uploadState: UploadState;
  uploadError: UploadErrorInfo | null;
  uploadedRecordingId: string | null;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const theme = useTheme();
  const isUploading = uploadState === 'uploading';

  return (
    <Card style={styles.playbackCard}>
      <ThemedText type="smallBold">{uploadState === 'done' ? 'Uploaded' : 'Recording ready'}</ThemedText>

      <AudioPlaybackControls uri={uri} />

      <ThemedText type="code" themeColor="textSecondary" style={styles.uriLabel} numberOfLines={2}>
        {uri}
      </ThemedText>

      {uploadState === 'done' && uploadedRecordingId && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.uriLabel}>
          Recording id: <ThemedText type="code">{uploadedRecordingId}</ThemedText>
        </ThemedText>
      )}

      {uploadState === 'error' && uploadError && (
        <ThemedView type="background" style={styles.errorCard}>
          <ThemedText type="small">
            {uploadError.stage === 'insert'
              ? 'The audio uploaded, but saving the recording failed: '
              : "Couldn't upload the recording: "}
            {uploadError.message}
          </ThemedText>
        </ThemedView>
      )}

      {isUploading && (
        <View style={styles.uploadingRow}>
          <ActivityIndicator />
          <ThemedText type="small" themeColor="textSecondary">
            Uploading…
          </ThemedText>
        </View>
      )}

      {uploadState !== 'done' ? (
        <>
          <Pressable
            style={({ pressed }) => [
              styles.playButton,
              { borderColor: theme.text },
              (pressed || isUploading) && styles.pressed,
            ]}
            disabled={isUploading}
            onPress={onKeep}>
            <ThemedText type="smallBold">{uploadState === 'error' ? 'Retry upload' : 'Keep & upload'}</ThemedText>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.discardButton, (pressed || isUploading) && styles.pressed]}
            disabled={isUploading}
            onPress={onDiscard}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Discard &amp; re-record
            </ThemedText>
          </Pressable>
        </>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.discardButton, pressed && styles.pressed]}
          onPress={onDiscard}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Record another
          </ThemedText>
        </Pressable>
      )}
    </Card>
  );
}

// Phase 3 Step 3 — shown in place of the mode options once the cap check
// (now run from mode selection, not the old record button — see
// docs/CLAUDE.md's Recording cap section) finds the user at/over
// MAX_RECORDINGS_PER_USER. Manual delete (Phase 3 Step 5) is the only way
// to free a slot, so this is the entry point into History to do that.
function CapBlockedCard({ onGoToHistory }: { onGoToHistory: () => void }) {
  const theme = useTheme();
  return (
    <Card style={styles.playbackCard}>
      <ThemedText type="smallBold">Recording limit reached</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.uriLabel}>
        You&apos;ve reached your {MAX_RECORDINGS_PER_USER} recording limit. Delete some audio from
        History to record more.
      </ThemedText>
      <Pressable
        style={({ pressed }) => [styles.playButton, { borderColor: theme.text }, pressed && styles.pressed]}
        onPress={onGoToHistory}>
        <ThemedText type="smallBold">Go to History</ThemedText>
      </Pressable>
    </Card>
  );
}

// Phase 4 Step 2 — the entry point into the recording flow, replacing the
// old bare record button. Three options: Interview, Storytelling,
// Miscellaneous. `onSelectMode` runs the (now-relocated) recording-cap
// check before letting any of them proceed — see docs/CLAUDE.md's Recording
// cap section.
//
// v2 Epic C Part 1 — restyled to the design system: the three modes sit on
// one horizontal row of pill-shaped buttons (white fill, tan hairline
// border, soft #BEA398 drop shadow) in their unselected state, per the
// design screenshots. The per-mode one-line descriptions that used to sit
// under each label were dropped to keep the pills compact. The
// selected/filled state is deliberately NOT built here — Epic C Part 2's
// mode-select transition animation has to touch that anyway.
const MODE_OPTIONS: { mode: Mode; label: string }[] = [
  { mode: 'interview', label: 'Interview' },
  { mode: 'story', label: 'Storytelling' },
  { mode: 'miscellaneous', label: 'Miscellaneous' },
];

// Pill-label sizing. All three pills share ONE font size (per-`<Text>`
// `adjustsFontSizeToFit` was rejected — it shrank "Miscellaneous" alone,
// breaking visual consistency). The size is derived so the *longest* label
// leaves ~`MODE_LABEL_SIDE_GAP` of clear space on each side within its
// pill, and it's recomputed from real measurements (row width via
// `onLayout`, the longest label's rendered width via `onTextLayout` at a
// fixed reference size) so it adapts to any screen without guessing glyph
// widths.
const MODE_LABEL_MAX_FONT = 18;
const MODE_LABEL_MIN_FONT = 11;
const MODE_LABEL_FALLBACK_FONT = 13; // used for the first frame, before measurement
const MODE_LABEL_MEASURE_FONT = 16; // reference size the hidden measurer renders at
const MODE_LABEL_SIDE_GAP = 16; // clear space each side of the longest word → 32 total
const MODE_LONGEST_LABEL = MODE_OPTIONS.reduce((a, o) => (o.label.length > a.length ? o.label : a), '');

function ModeSelect({ onSelectMode }: { onSelectMode: (mode: Mode) => void }) {
  const [rowWidth, setRowWidth] = useState(0);
  // Rendered width of MODE_LONGEST_LABEL at MODE_LABEL_MEASURE_FONT.
  const [measuredLabelWidth, setMeasuredLabelWidth] = useState(0);

  let labelFontSize = MODE_LABEL_FALLBACK_FONT;
  if (rowWidth > 0 && measuredLabelWidth > 0) {
    const pillWidth = (rowWidth - Theme.spacing.sm * (MODE_OPTIONS.length - 1)) / MODE_OPTIONS.length;
    const targetTextWidth = pillWidth - MODE_LABEL_SIDE_GAP * 2;
    const raw = MODE_LABEL_MEASURE_FONT * (targetTextWidth / measuredLabelWidth);
    labelFontSize = Math.max(MODE_LABEL_MIN_FONT, Math.min(MODE_LABEL_MAX_FONT, Math.round(raw)));
  }

  return (
    <View style={styles.modeList} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
      {/* Hidden measurer — laid out (so onTextLayout fires) but not drawn
          and not part of the row's flow. */}
      <ThemedText
        style={[styles.modePillLabel, styles.modeLabelMeasurer, { fontSize: MODE_LABEL_MEASURE_FONT }]}
        onTextLayout={(e) => {
          const width = e.nativeEvent.lines[0]?.width ?? 0;
          if (width) setMeasuredLabelWidth((prev) => (Math.abs(prev - width) < 0.5 ? prev : width));
        }}>
        {MODE_LONGEST_LABEL}
      </ThemedText>
      {MODE_OPTIONS.map((option) => (
        <Pressable
          key={option.mode}
          style={({ pressed }) => [styles.modePill, pressed && styles.pressed]}
          onPress={() => onSelectMode(option.mode)}>
          <ThemedText style={[styles.modePillLabel, { fontSize: labelFontSize }]} numberOfLines={1}>
            {option.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

// Phase 4 Step 3 — real question-selection screen for Interview/Story,
// replacing Step 2's placeholder. `question`/`loading`/`error` reflect an
// in-flight `pickQuestionForMode` call (src/lib/question-selection.ts) kicked
// off by the parent the moment this mode was selected — this component is
// purely presentational.
//
// Phase 4 Step 4 — adds a custom question/topic input alongside the pool
// pick (not replacing it): a free-text field + "Use this instead" button
// that coexists with the AI-suggested question and its "Start recording"
// button, in every state (loading/error/loaded) — typing a custom topic
// doesn't depend on the pool lookup having succeeded. Validation is just
// "not empty/whitespace-only" (trimmed here), matching how relaxed the rest
// of this app's input handling is (see docs/CLAUDE.md's auth section) — no
// length limit, no content filtering. The only local state here is the
// in-progress input text and its own inline validation error; the parent
// (RecordScreen) owns what actually becomes `selectedQuestion` via
// `onUseCustom`, exactly the same as `onStart` does for the pool pick.
function QuestionSelect({
  mode,
  question,
  loading,
  error,
  onRetry,
  onStart,
  onUseCustom,
  onBack,
}: {
  mode: 'interview' | 'story';
  question: Question | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onStart: () => void;
  onUseCustom: (text: string) => void;
  onBack: () => void;
}) {
  const theme = useTheme();
  const [customText, setCustomText] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  function handleUseCustomPress() {
    const trimmed = customText.trim();
    if (!trimmed) {
      setCustomError('Type a question or topic first.');
      return;
    }
    setCustomError(null);
    onUseCustom(trimmed);
  }

  return (
    <Card style={styles.playbackCard}>
      <ThemedText type="smallBold">Mode: {MODE_LABELS[mode]}</ThemedText>

      {loading && (
        <View style={styles.uploadingRow}>
          <ActivityIndicator />
          <ThemedText type="small" themeColor="textSecondary">
            Choosing a question…
          </ThemedText>
        </View>
      )}

      {!loading && error && (
        <>
          <ThemedView type="background" style={styles.errorCard}>
            <ThemedText type="small">{error}</ThemedText>
          </ThemedView>
          <Pressable
            style={({ pressed }) => [styles.playButton, { borderColor: theme.text }, pressed && styles.pressed]}
            onPress={onRetry}>
            <ThemedText type="smallBold">Try again</ThemedText>
          </Pressable>
        </>
      )}

      {!loading && !error && question && (
        <>
          <ThemedText type="subtitle" style={styles.uriLabel}>
            {question.text}
          </ThemedText>
          <Pressable
            style={({ pressed }) => [styles.playButton, { borderColor: theme.text }, pressed && styles.pressed]}
            onPress={onStart}>
            <ThemedText type="smallBold">Start recording</ThemedText>
          </Pressable>
        </>
      )}

      <View style={styles.customSection}>
        <ThemedText type="small" themeColor="textSecondary">
          Or type your own question or topic instead:
        </ThemedText>
        <TextInput
          style={[styles.customInput, { borderColor: theme.text, color: theme.text }]}
          placeholder="Type a question or topic…"
          placeholderTextColor={theme.textSecondary}
          value={customText}
          onChangeText={(text) => {
            setCustomText(text);
            if (customError) setCustomError(null);
          }}
          multiline
        />
        {customError && (
          <ThemedText type="small" style={styles.uriLabel}>
            {customError}
          </ThemedText>
        )}
        <Pressable
          style={({ pressed }) => [styles.playButton, { borderColor: theme.text }, pressed && styles.pressed]}
          onPress={handleUseCustomPress}>
          <ThemedText type="smallBold">Use this instead</ThemedText>
        </Pressable>
      </View>

      <Pressable style={({ pressed }) => [styles.discardButton, pressed && styles.pressed]} onPress={onBack}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          ‹ Change mode
        </ThemedText>
      </Pressable>
    </Card>
  );
}

export default function RecordScreen() {
  const { user } = useAuth();
  const theme = useTheme();
  const router = useRouter();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);

  const [flowScreen, setFlowScreen] = useState<FlowScreen>('mode-select');
  // Phase 4 Step 3: the mode/question chosen for the current attempt, carried
  // through 'question' -> 'record' -> handleKeepAndUpload's insert. `null`
  // question is correct for miscellaneous (no question) and, transiently,
  // while a question is still being picked for interview/story.
  const [selectedMode, setSelectedMode] = useState<Mode | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);

  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);

  // Phase 3 Step 3, relocated here in Phase 4 Step 2: per-user recording cap
  // (MAX_RECORDINGS_PER_USER) — see docs/CLAUDE.md's Recording cap section.
  // This now runs from mode selection (handleSelectMode below), the real
  // entry point into recording, instead of the old bare record button.
  // `checkingCap` guards against a double-tap firing two count queries at
  // once; `blockedByCap` swaps the mode options for a blocking message once
  // we know the user is at/over the cap.
  const [checkingCap, setCheckingCap] = useState(false);
  const [blockedByCap, setBlockedByCap] = useState(false);

  // Re-arm the check on every focus (e.g. coming back from History after
  // freeing a slot) so a stale "blocked" state doesn't linger — the next
  // mode tap re-checks for real via handleSelectMode below, this just
  // clears the message so the normal mode options reappear.
  useFocusEffect(
    useCallback(() => {
      setBlockedByCap(false);
    }, [])
  );

  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadError, setUploadError] = useState<UploadErrorInfo | null>(null);
  const [uploadedRecordingId, setUploadedRecordingId] = useState<string | null>(null);
  // Set once per recording (on first upload attempt) so a retry after a
  // failure overwrites the same Storage object instead of leaving stray
  // partial uploads behind. Cleared whenever the recording itself resets.
  const audioPathRef = useRef<string | null>(null);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Reflect any previously-granted/denied mic permission on screen load,
  // without prompting — the actual request only happens on first record tap.
  useEffect(() => {
    AudioModule.getRecordingPermissionsAsync().then((response) => {
      setPermission(response.granted ? 'granted' : response.status === 'denied' ? 'denied' : 'unknown');
      setCanAskAgain(response.canAskAgain);
    });
  }, []);

  useEffect(() => {
    if (!recorderState.isRecording) {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [recorderState.isRecording, pulseAnim]);

  function resetRecordingState() {
    setRecordedUri(null);
    audioPathRef.current = null;
    setUploadState('idle');
    setUploadError(null);
    setUploadedRecordingId(null);
  }

  function handleBackToModeSelect() {
    setSelectedMode(null);
    setSelectedQuestion(null);
    setQuestionError(null);
    setFlowScreen('mode-select');
  }

  // Phase 4 Step 3 — runs pickQuestionForMode (src/lib/question-selection.ts)
  // for the given mode and stores the result, so QuestionSelect can render
  // it. Also used by that screen's "Try again" button on a failed lookup.
  async function loadQuestion(mode: 'interview' | 'story') {
    if (!user) return;
    setQuestionLoading(true);
    setQuestionError(null);
    setSelectedQuestion(null);
    try {
      const question = await pickQuestionForMode(mode, user.id);
      setSelectedQuestion(question);
    } catch (err) {
      setQuestionError(err instanceof Error ? err.message : 'Could not choose a question.');
    } finally {
      setQuestionLoading(false);
    }
  }

  // Phase 4 Step 4 — the "Use this instead" action on QuestionSelect's
  // custom-topic input. Mirrors handleStart's role for the pool pick: builds
  // a Question-shaped object (satisfies the same `Question` type
  // `selectedQuestion` already holds, so nothing downstream — the record
  // screen's question banner, handleKeepAndUpload's uploadRecording() call —
  // needs to know or care whether this text came from the pool or was typed
  // by the user) and advances straight to 'record', same as tapping "Start
  // recording" does for the pool pick. `id: 'custom'` is never read anywhere
  // (question.text is the only field uploadRecording() or the banner uses),
  // it's just a placeholder satisfying the Question type.
  function handleUseCustomQuestion(mode: 'interview' | 'story', text: string) {
    setSelectedQuestion({ id: 'custom', mode, text });
    setQuestionError(null);
    setFlowScreen('record');
  }

  // Phase 4 Step 2: the recording-cap check now runs here — before any mode
  // is entered — rather than in handleStartRecording below. This is the
  // real entry point into the recording flow now, replacing the old bare
  // record button (see docs/CLAUDE.md's Recording cap section for the
  // "note to self" this closes out).
  async function handleSelectMode(mode: Mode) {
    if (!user || checkingCap) return;

    setCheckingCap(true);
    try {
      const count = await getActiveRecordingCount(user.id);
      if (count >= MAX_RECORDINGS_PER_USER) {
        setBlockedByCap(true);
        return;
      }
    } catch (err) {
      // Fail open: don't block proceeding over a cap check that itself
      // couldn't complete (e.g. a network blip) — the Postgres trigger
      // (supabase/migrations/0004_recording_cap_enforcement.sql) is the
      // real safety net if this ever lets someone squeak past the cap.
      console.warn('Recording cap check failed, allowing recording to proceed', err);
    } finally {
      setCheckingCap(false);
    }

    if (mode === 'miscellaneous') {
      setSelectedMode('miscellaneous');
      setSelectedQuestion(null);
      setFlowScreen('record');
      return;
    }

    // Interview/Story: Phase 4 Step 3 — pick a real question (excluding the
    // immediate previous one in this mode) and show it before recording.
    setSelectedMode(mode);
    setFlowScreen('question');
    await loadQuestion(mode);
  }

  async function handleStartRecording() {
    if (!user) return;

    if (permission !== 'granted') {
      const response = await AudioModule.requestRecordingPermissionsAsync();
      setCanAskAgain(response.canAskAgain);
      if (!response.granted) {
        setPermission('denied');
        return;
      }
      setPermission('granted');
    }

    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    resetRecordingState();
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function handleStopRecording() {
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    audioPathRef.current = null;
    setUploadState('idle');
    setUploadError(null);
    setUploadedRecordingId(null);
    setRecordedUri(recorder.uri);
  }

  async function handleKeepAndUpload() {
    if (!recordedUri || !user) return;

    const path = audioPathRef.current ?? buildAudioPath(user.id, recordedUri);
    audioPathRef.current = path;
    setUploadState('uploading');
    setUploadError(null);

    try {
      const mode = selectedMode ?? 'miscellaneous';
      // Miscellaneous never has a question; interview/story pass the real
      // question text selected in the 'question' screen (Phase 4 Step 3).
      const question = mode === 'miscellaneous' ? null : (selectedQuestion?.text ?? null);
      const result = await uploadRecording({ userId: user.id, localUri: recordedUri, audioPath: path, mode, question });
      setUploadedRecordingId(result.id);
      setUploadState('done');

      // Phase 2 Step 2: kick off backend processing now that the row exists.
      // Best-effort — the recording is already safely uploaded and visible
      // in History regardless, so a failure here shouldn't block navigating
      // there. If it does fail, the row is simply left at 'pending' with no
      // retry yet (that's a later step); this is enough to prove the wiring
      // for now.
      startProcessing(result.id).catch((err) => {
        console.warn('Failed to start processing for recording', result.id, err);
      });

      // Step 6: land on the history list so the new recording is visible
      // immediately, instead of stopping at a dead-end confirmation. This
      // screen's own state is left as "done" (not reset) so tabbing back
      // here still shows the accurate confirmation + "Record another".
      router.navigate('/history');
    } catch (err) {
      const stage = err instanceof RecordingUploadError ? err.stage : 'upload';
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setUploadError({ message, stage });
      setUploadState('error');
    }
  }

  const elapsed = formatDuration(recorderState.durationMillis / 1000);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ProfileButton />
        </View>
        <ThemedView style={styles.heroSection}>
          {flowScreen === 'mode-select' &&
            (blockedByCap ? (
              <CapBlockedCard onGoToHistory={() => router.navigate('/history')} />
            ) : (
              <View style={styles.modeSelect}>
                {/* v2 Epic C Part 1 — a fixed, static tagline for every user
                    every time (no greeting/personalization logic), with the
                    functional instruction kept as the line beneath it. */}
                <View style={styles.modeSelectIntro}>
                  <ThemedText style={styles.tagline}>Unmute your potential.</ThemedText>
                  <ThemedText style={styles.chooseMode} themeColor="textSecondary">
                    Choose a mode.
                  </ThemedText>
                </View>
                <ModeSelect onSelectMode={handleSelectMode} />
              </View>
            ))}

          {flowScreen === 'question' && selectedMode && selectedMode !== 'miscellaneous' && (
            <QuestionSelect
              mode={selectedMode}
              question={selectedQuestion}
              loading={questionLoading}
              error={questionError}
              onRetry={() => loadQuestion(selectedMode)}
              onStart={() => setFlowScreen('record')}
              onUseCustom={(text) => handleUseCustomQuestion(selectedMode, text)}
              onBack={handleBackToModeSelect}
            />
          )}

          {flowScreen === 'record' && (
            <>
              {!recordedUri && (
                <View style={styles.recordArea}>
                  {selectedMode && selectedMode !== 'miscellaneous' && selectedQuestion && (
                    <Card style={styles.questionBanner}>
                      <ThemedText type="small" themeColor="textSecondary">
                        {MODE_LABELS[selectedMode]} question
                      </ThemedText>
                      <ThemedText type="smallBold" style={styles.uriLabel}>
                        {selectedQuestion.text}
                      </ThemedText>
                    </Card>
                  )}

                  <Animated.View style={{ opacity: pulseAnim }}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.recordButton,
                        { borderColor: theme.text },
                        recorderState.isRecording && styles.recordButtonActive,
                        pressed && styles.pressed,
                      ]}
                      onPress={recorderState.isRecording ? handleStopRecording : handleStartRecording}>
                      <View style={recorderState.isRecording ? styles.stopIcon : styles.recordIcon} />
                    </Pressable>
                  </Animated.View>

                  <ThemedText type="small" themeColor="textSecondary">
                    {recorderState.isRecording ? 'Recording… tap to stop' : 'Tap to start recording'}
                  </ThemedText>

                  {recorderState.isRecording && (
                    <ThemedText type="subtitle" style={styles.timer}>
                      {elapsed}
                    </ThemedText>
                  )}

                  {permission === 'denied' && (
                    <Card style={styles.permissionCard}>
                      <ThemedText type="small">
                        Brevado needs microphone access to record practice sessions, and it&apos;s currently
                        turned off. {canAskAgain ? 'Tap the record button to try again.' : 'Enable it in Settings to continue.'}
                      </ThemedText>
                      {!canAskAgain && Platform.OS !== 'web' && (
                        <Pressable onPress={() => Linking.openSettings()}>
                          <ThemedText type="linkPrimary">Open Settings</ThemedText>
                        </Pressable>
                      )}
                    </Card>
                  )}

                  {!recorderState.isRecording && (
                    <Pressable
                      style={({ pressed }) => [styles.discardButton, pressed && styles.pressed]}
                      onPress={handleBackToModeSelect}>
                      <ThemedText type="smallBold" themeColor="textSecondary">
                        ‹ Change mode
                      </ThemedText>
                    </Pressable>
                  )}
                </View>
              )}

              {recordedUri && (
                <RecordingPlayback
                  uri={recordedUri}
                  uploadState={uploadState}
                  uploadError={uploadError}
                  uploadedRecordingId={uploadedRecordingId}
                  onKeep={handleKeepAndUpload}
                  onDiscard={resetRecordingState}
                />
              )}
            </>
          )}
        </ThemedView>

        {Platform.OS === 'web' && <WebBadge />}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  heroSection: {
    // `alignSelf: 'stretch'` is load-bearing: `safeArea` centres its
    // children, so without this `heroSection` shrinks to hug its widest
    // child (the tagline) and the mode-select row can never get wider than
    // that line. With it, `heroSection` fills `safeArea`'s content width and
    // the row spans the screen (minus `safeArea`'s 16pt gutter).
    // No horizontal padding here — `safeArea` already provides the gutter;
    // it used to be doubled.
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: Spacing.four,
  },
  // v2 Epic C Part 1 — mode-select screen.
  modeSelect: {
    alignSelf: 'stretch',
    gap: Theme.spacing.xxl,
  },
  modeSelectIntro: {
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  tagline: {
    // A bit larger than the `heading` variant (20) — sits between `heading`
    // and `title` (28) as a hero line. Weight stays semiBold.
    fontFamily: Theme.typography.variants.heading.fontFamily,
    fontSize: 24,
    lineHeight: 30,
    textAlign: 'center',
  },
  chooseMode: {
    fontFamily: Theme.typography.variants.body.fontFamily,
    fontSize: Theme.typography.variants.body.fontSize,
    lineHeight: Theme.typography.variants.body.lineHeight,
    textAlign: 'center',
  },
  // The three mode pills sit on one horizontal row (Epic C Part 1 follow-up),
  // each `flex: 1` (equal thirds of the row). The label font size is
  // measured/shared across all three in `ModeSelect` so the longest word
  // ("Miscellaneous") always fits without truncating or looking smaller
  // than its neighbours.
  modeList: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: Theme.spacing.sm,
  },
  modePill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.sm,
    borderRadius: Theme.radius.pill,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: Theme.colors.card,
    // Drop shadow: #BEA398 @ 15%, 0/0 offset, 5 spread + 50 blur in the
    // design. RN has no spread and its blur scale differs, so `shadowRadius`
    // stands in for both; `elevation` is the Android equivalent.
    shadowColor: Theme.colors.shadow,
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 25,
    elevation: 3,
  },
  modePillLabel: {
    // `fontSize` is set inline by `ModeSelect` (one measured value shared by
    // all three pills — see the MODE_LABEL_* constants).
    fontFamily: Theme.typography.variants.label.fontFamily,
    fontSize: MODE_LABEL_FALLBACK_FONT,
    textAlign: 'center',
  },
  // The hidden label measurer: laid out so `onTextLayout` reports a real
  // width, but absolutely positioned + transparent so it neither draws nor
  // affects the row.
  modeLabelMeasurer: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    top: 0,
    pointerEvents: 'none',
  },
  recordArea: {
    alignItems: 'center',
    gap: Spacing.three,
    alignSelf: 'stretch',
  },
  recordButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonActive: {
    borderColor: '#e5484d',
  },
  recordIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#e5484d',
  },
  stopIcon: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#e5484d',
  },
  timer: {
    fontVariant: ['tabular-nums'],
  },
  permissionCard: {
    gap: Spacing.two,
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  questionBanner: {
    gap: Spacing.one,
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  playbackCard: {
    gap: Spacing.two,
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
  },
  playButton: {
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    borderWidth: StyleSheet.hairlineWidth,
  },
  uriLabel: {
    textAlign: 'center',
  },
  customSection: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  customInput: {
    alignSelf: 'stretch',
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    textAlignVertical: 'top',
  },
  errorCard: {
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5484d',
  },
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  discardButton: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
  },
  header: {
    alignSelf: 'stretch',
    alignItems: 'flex-end',
  },
  pressed: {
    opacity: 0.7,
  },
});
