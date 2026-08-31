import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  interpolateColor,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader, BackLink, HeaderBackLink } from '@/components/app-header';
import { AudioPlaybackControls } from '@/components/audio-playback-controls';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing, Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchDailyQuestion, regenerateReport, startProcessing, type DailyQuestion } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDuration } from '@/lib/format-time';
import { MODE_LABELS } from '@/lib/modes';
import { TERMINAL_STATUSES } from '@/lib/recording-status';
import {
  buildAudioPath,
  fetchRecordingById,
  getActiveRecordingCount,
  MAX_RECORDINGS_PER_USER,
  RecordingUploadError,
  uploadRecording,
  type RecordingMode,
  type RecordingUploadStage,
} from '@/lib/recordings';

// The Record tab is a small local flow driven by plain local state rather
// than Expo Router routes. Two `FlowScreen` values:
//   - 'mode-select': `ModeSelectFlow` — the pill row, and (once a mode is
//     picked) the shift animation + the folded-in question area. Interview
//     and Storytelling show the question area here; Miscellaneous skips
//     straight to 'record'.
//   - 'record': the record/playback/upload UI.
type FlowScreen = 'mode-select' | 'record';
type Mode = RecordingMode;

// Re-practice mode. "Re-practice this question" from a History recording's
// 3-dot menu navigates here with route params
// (`rpSource` / `rpMode` / `rpQuestion` / `rpQuestionId` / `rpTs`), which this
// screen consumes into `rePractice` state — a third entry path into the
// record flow:
//   - no mode-select step (mode is fixed to the original's)
//   - no question UI — no pool fetch, no "ask my own" toggle; the fixed
//     question is shown read-only and recording starts
//   - on upload, `handleKeepAndUpload` sends `rePracticeOf: sourceId` so the
//     new recording's `re_practice_of` points at the exact row the menu was
//     opened from (`buildChains` walks the chain to a root).
// The recording cap still applies (checked in `enterRePractice`).
type RePracticeContext = {
  sourceId: string;
  mode: 'interview' | 'story';
  question: string;
  questionId: string | null;
};

type PermissionState = 'unknown' | 'granted' | 'denied';
type UploadState = 'idle' | 'uploading' | 'error' | 'done';
type UploadErrorInfo = { message: string; stage: RecordingUploadStage };

// The inline processing-status display, shown on the Record screen after a
// successful upload instead of navigating away to History. Reuses the same
// polling shape History has, fetching just this one recording.
//
//   pending / processing → a spinner (that alone says "still working")
//   done                 → "See more details ›" → this recording's History
//                          detail screen
//   failed               → an explanation + "Regenerate report" inline
function ProcessingStatus({
  recordingId,
  kickoffError,
  onRetryKickoff,
  onSeeDetails,
}: {
  recordingId: string;
  kickoffError: string | null;
  onRetryKickoff: () => void;
  onSeeDetails: () => void;
}) {
  const theme = useTheme();
  const [status, setStatus] = useState<string>('pending');
  const [pollFailed, setPollFailed] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  // Out-of-order guard: a slower, older fetch resolving after a newer one
  // can't overwrite fresh state.
  const requestSeqRef = useRef(0);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const pollStatus = useCallback(async () => {
    const requestId = ++requestSeqRef.current;
    try {
      const row = await fetchRecordingById(recordingId);
      if (requestId !== requestSeqRef.current) return;
      if (row) {
        setStatus(row.status);
        setPollFailed(false);
      }
    } catch {
      if (requestId !== requestSeqRef.current) return;
      // A transient poll failure shouldn't wipe the last-known status —
      // just show a quiet "retrying" note and let the next tick try again.
      setPollFailed(true);
    }
  }, [recordingId]);

  // First fetch on mount.
  useEffect(() => {
    pollStatus();
  }, [pollStatus]);

  // Poll while non-terminal, only while the Record tab is focused — the same
  // 1.5s / `TERMINAL_STATUSES`-stop / focus-gated shape as History's polling,
  // just fetching this one recording rather than the whole list.
  useFocusEffect(
    useCallback(() => {
      const interval = setInterval(() => {
        if (TERMINAL_STATUSES.has(statusRef.current)) return;
        pollStatus();
      }, 1500);
      return () => clearInterval(interval);
    }, [pollStatus])
  );

  async function handleRegenerate() {
    setRegenerating(true);
    setRegenerateError(null);
    try {
      await regenerateReport(recordingId);
      // `process_recording()` flips straight to 'processing' as its first
      // step — reflect that so the poll above picks it back up.
      setStatus('processing');
    } catch (err) {
      setRegenerateError(err instanceof Error ? err.message : 'Could not regenerate — try again.');
    } finally {
      setRegenerating(false);
    }
  }

  const nonTerminal = !TERMINAL_STATUSES.has(status);

  return (
    <View style={styles.processingStatus}>
      {nonTerminal && <ActivityIndicator size="small" color={theme.textSecondary} />}

      {status === 'done' && (
        <Pressable onPress={onSeeDetails} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText style={styles.questionLink}>See more details ›</ThemedText>
        </Pressable>
      )}

      {status === 'failed' && (
        <>
          <ThemedText type="small" themeColor="textSecondary" style={styles.uriLabel}>
            Something went wrong generating your report.
          </ThemedText>
          <Pressable
            onPress={handleRegenerate}
            disabled={regenerating}
            hitSlop={8}
            style={({ pressed }) => (pressed || regenerating) && styles.pressed}>
            {regenerating ? (
              <ActivityIndicator size="small" color={theme.textSecondary} />
            ) : (
              <ThemedText style={styles.questionLink}>Regenerate report</ThemedText>
            )}
          </Pressable>
          {regenerateError && (
            <ThemedText type="small" style={styles.errorText}>
              {regenerateError}
            </ThemedText>
          )}
        </>
      )}

      {kickoffError && nonTerminal && (
        <>
          <ThemedText type="small" style={styles.errorText}>
            Couldn&apos;t start processing.
          </ThemedText>
          <Pressable onPress={onRetryKickoff} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText style={styles.questionLink}>Try again</ThemedText>
          </Pressable>
        </>
      )}

      {pollFailed && nonTerminal && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.uriLabel}>
          Couldn&apos;t check status — retrying…
        </ThemedText>
      )}
    </View>
  );
}

function RecordingPlayback({
  uri,
  uploadState,
  uploadError,
  uploadedRecordingId,
  processingKickoffError,
  onKeep,
  onDiscard,
  onRetryKickoff,
  onSeeDetails,
}: {
  uri: string;
  uploadState: UploadState;
  uploadError: UploadErrorInfo | null;
  uploadedRecordingId: string | null;
  processingKickoffError: string | null;
  onKeep: () => void;
  onDiscard: () => void;
  onRetryKickoff: () => void;
  onSeeDetails: () => void;
}) {
  const theme = useTheme();
  const isUploading = uploadState === 'uploading';

  return (
    <Card style={styles.playbackCard}>
      <ThemedText type="smallBold">{uploadState === 'done' ? 'Uploaded' : 'Recording ready'}</ThemedText>

      <AudioPlaybackControls uri={uri} />

      {uploadState === 'done' && uploadedRecordingId && (
        <ProcessingStatus
          recordingId={uploadedRecordingId}
          kickoffError={processingKickoffError}
          onRetryKickoff={onRetryKickoff}
          onSeeDetails={onSeeDetails}
        />
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
        // Once the recording is done, "Record another" is the only reset
        // affordance — switching mode after a take is recorded doesn't make
        // sense, and leaving the screen and returning resets to mode-select.
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

// Shown in place of the mode options once the cap check finds the user
// at/over MAX_RECORDINGS_PER_USER. Deleting a recording's audio from History
// is the only way to free a slot, so this links there.
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

// The entry point into the recording flow: three options — Interview,
// Storytelling, Miscellaneous — as a horizontal row of pill-shaped buttons.
// Selecting one runs the recording-cap check first.
//
// Picking a mode doesn't swap screens: the same three pill elements stay
// mounted and reposition from a centred group to a top row (the shift
// animation), the picked pill fills with `Theme.colors.accent`, and the
// question area animates in below. "‹ Change mode" reverses it.
const MODE_OPTIONS: { mode: Mode; label: string }[] = [
  { mode: 'interview', label: 'Interview' },
  { mode: 'story', label: 'Storytelling' },
  { mode: 'miscellaneous', label: 'Miscellaneous' },
];

// Shift-animation timeline (ms) — the whole choreography runs in 1s.
//   forward (mode tapped):   fill 0–180 | intro fades 180–430 | pills shift
//                            430–1000 | question fades in 720–1000
//   reverse ("Change mode"): un-fill 0–180 | question fades 180–430 | pills
//                            shift 430–1000 | intro fades in 720–1000
// The asymmetry the design calls for: the brown fill is *first* in both
// directions (not mirrored), and the pill shift only starts once the
// intro/question fade has fully finished. The shift uses `Easing.out` so
// the pills clear the question zone early and settle slowly, letting the
// question fade overlap the tail.
const T_FILL = 180; // pill brown fill / un-fill (phase 1, both directions)
const T_FADE = 250; // intro-out (fwd) / question-out (rev) — phase 2
const T_SHIFT = 570; // pills sliding centred <-> top — phase 3 (430 -> 1000)
const T_PHASE2 = T_FILL + T_FADE; // 430 — pill shift starts here
const T_REFADE_START = T_PHASE2 + 290; // 720 — the second fade starts here
const T_REFADE = 1000 - T_REFADE_START; // 280 — question-in (fwd) / intro-in (rev)

// Selected pills rest this far below the top of the flow area.
const MODE_PILLS_TOP_INSET = 12;

const AnimatedPressable = Reanimated.createAnimatedComponent(Pressable);

// One mode pill. Owns its own fill animation (0 = unselected white/border,
// 1 = selected accent). This is phase 1 of the shift choreography — it
// fires immediately on `selected` change, in both directions (fill first
// on select, un-fill first on deselect). It also crossfades cleanly when
// the active mode is switched without leaving the picked sub-state.
function ModePill({
  label,
  fontSize,
  selected,
  onPress,
}: {
  label: string;
  fontSize: number;
  selected: boolean;
  onPress: () => void;
}) {
  const fill = useSharedValue(selected ? 1 : 0);
  const press = useSharedValue(0);

  useEffect(() => {
    fill.value = withTiming(selected ? 1 : 0, { duration: T_FILL });
  }, [selected, fill]);

  const pillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(fill.value, [0, 1], [Theme.colors.card, Theme.colors.accent]),
    borderColor: interpolateColor(fill.value, [0, 1], [Theme.colors.border, Theme.colors.accent]),
    opacity: 1 - press.value * 0.25,
  }));
  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(fill.value, [0, 1], [Theme.colors.textPrimary, Theme.colors.onAccent]),
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        press.value = withTiming(1, { duration: 80 });
      }}
      onPressOut={() => {
        press.value = withTiming(0, { duration: 140 });
      }}
      style={[styles.modePill, pillStyle]}>
      <Reanimated.Text style={[styles.modePillLabel, { fontSize }, textStyle]} numberOfLines={1}>
        {label}
      </Reanimated.Text>
    </AnimatedPressable>
  );
}

// Pill-label sizing. All three pills share ONE font size — using per-`<Text>`
// `adjustsFontSizeToFit` instead would shrink "Miscellaneous" alone and break
// visual consistency. The size is derived so the longest label leaves
// ~`MODE_LABEL_SIDE_GAP` of clear space each side within its pill, recomputed
// from real measurements (row width via `onLayout`, the longest label's
// rendered width via `onTextLayout` at a fixed reference size) so it adapts
// to any screen without guessing glyph widths.
const MODE_LABEL_MAX_FONT = 18;
const MODE_LABEL_MIN_FONT = 11;
const MODE_LABEL_FALLBACK_FONT = 13; // used for the first frame, before measurement
const MODE_LABEL_MEASURE_FONT = 16; // reference size the hidden measurer renders at
const MODE_LABEL_SIDE_GAP = 16; // clear space each side of the longest word → 32 total
const MODE_LONGEST_LABEL = MODE_OPTIONS.reduce((a, o) => (o.label.length > a.length ? o.label : a), '');

// The whole mode-select area and its shift choreography.
//
// Everything stays mounted the whole time — nothing swaps screens:
//   - `introWrap` floats *above* the pill row (absolute, `bottom: '100%'`)
//     so it never affects where the pills sit; only its opacity animates.
//   - `pillRow` is the one element that moves. `modeFlowInner` (which holds
//     it) gets a `translateY` that interpolates between a centred position
//     and `MODE_PILLS_TOP_INSET`, driven by the `shift` shared value.
//   - the question slot is absolutely positioned at its final resting spot
//     (just below where the pills end up) and only fades/rises in. The
//     parent passes the real `QuestionArea` as `questionSlot`.
//
// A single `useEffect` on `isSelected` schedules the three shared values
// (`introOpacity`, `shift`, `questionOpacity`) with `withDelay` so the phases
// run in the order + timing the design calls for. The pill fill (phase 1)
// lives in `ModePill` and fires on its own.
function ModeSelectFlow({
  selectedMode,
  onSelectMode,
  questionSlot,
}: {
  selectedMode: Mode | null;
  onSelectMode: (mode: Mode) => void;
  questionSlot: ReactNode;
}) {
  const [rowWidth, setRowWidth] = useState(0);
  const [pillRowHeight, setPillRowHeight] = useState(0);
  const [introHeight, setIntroHeight] = useState(0);
  const [flowHeight, setFlowHeight] = useState(0);
  // Rendered width of MODE_LONGEST_LABEL at MODE_LABEL_MEASURE_FONT.
  const [measuredLabelWidth, setMeasuredLabelWidth] = useState(0);

  const isSelected = selectedMode != null;
  const wasSelected = useRef(isSelected);

  const introOpacity = useSharedValue(isSelected ? 0 : 1);
  const shift = useSharedValue(isSelected ? 1 : 0); // 0 = centred, 1 = top
  const questionOpacity = useSharedValue(isSelected ? 1 : 0);

  useEffect(() => {
    if (wasSelected.current === isSelected) return;
    wasSelected.current = isSelected;

    cancelAnimation(introOpacity);
    cancelAnimation(shift);
    cancelAnimation(questionOpacity);

    if (isSelected) {
      // forward: pill fill (ModePill, 0–180) -> intro fades out (180–430)
      // -> pills shift up (430–1000), question fades in over the tail.
      introOpacity.value = withDelay(T_FILL, withTiming(0, { duration: T_FADE, easing: Easing.out(Easing.quad) }));
      shift.value = withDelay(T_PHASE2, withTiming(1, { duration: T_SHIFT, easing: Easing.out(Easing.cubic) }));
      questionOpacity.value = withDelay(
        T_REFADE_START,
        withTiming(1, { duration: T_REFADE, easing: Easing.out(Easing.quad) })
      );
    } else {
      // reverse: un-fill first (ModePill, 0–180) -> question fades out
      // (180–430) -> pills shift back down (430–1000), intro fades in.
      questionOpacity.value = withDelay(T_FILL, withTiming(0, { duration: T_FADE, easing: Easing.out(Easing.quad) }));
      shift.value = withDelay(T_PHASE2, withTiming(0, { duration: T_SHIFT, easing: Easing.out(Easing.cubic) }));
      introOpacity.value = withDelay(
        T_REFADE_START,
        withTiming(1, { duration: T_REFADE, easing: Easing.out(Easing.quad) })
      );
    }

    return () => {
      cancelAnimation(introOpacity);
      cancelAnimation(shift);
      cancelAnimation(questionOpacity);
    };
  }, [isSelected, introOpacity, shift, questionOpacity]);

  let labelFontSize = MODE_LABEL_FALLBACK_FONT;
  if (rowWidth > 0 && measuredLabelWidth > 0) {
    const pillWidth = (rowWidth - Theme.spacing.sm * (MODE_OPTIONS.length - 1)) / MODE_OPTIONS.length;
    const targetTextWidth = pillWidth - MODE_LABEL_SIDE_GAP * 2;
    const raw = MODE_LABEL_MEASURE_FONT * (targetTextWidth / measuredLabelWidth);
    labelFontSize = Math.max(MODE_LABEL_MIN_FONT, Math.min(MODE_LABEL_MAX_FONT, Math.round(raw)));
  }

  // Position the pill row with a transform, once we've measured the stage
  // height, the row height and the (floating) intro height. `centred` puts
  // the intro+row group in the vertical middle of the stage; `selected`
  // parks the row near the top. Until measured, the inner is kept invisible
  // (a frame or two) rather than risk a first-paint jump.
  const positioned = flowHeight > 0 && pillRowHeight > 0 && introHeight > 0;
  const centredTranslateY = positioned ? (flowHeight - pillRowHeight) / 2 + introHeight / 2 : 0;

  const innerStyle = useAnimatedStyle(() => ({
    opacity: positioned ? 1 : 0,
    transform: [
      { translateY: interpolate(shift.value, [0, 1], [centredTranslateY, MODE_PILLS_TOP_INSET]) },
    ],
  }));
  const introStyle = useAnimatedStyle(() => ({ opacity: introOpacity.value }));
  const questionStyle = useAnimatedStyle(() => ({
    opacity: questionOpacity.value,
    transform: [{ translateY: (1 - questionOpacity.value) * 10 }],
  }));

  // Keep the last-rendered question content mounted for a beat after a mode
  // is deselected, so the reverse animation's "question fades out" phase has
  // something to fade rather than the content vanishing instantly.
  const lastSlot = useRef<ReactNode>(null);
  if (questionSlot != null) lastSlot.current = questionSlot;
  const [keepStaleSlot, setKeepStaleSlot] = useState(false);
  useEffect(() => {
    if (isSelected) {
      setKeepStaleSlot(false);
      return;
    }
    if (lastSlot.current == null) return; // nothing was ever shown
    setKeepStaleSlot(true);
    const t = setTimeout(() => setKeepStaleSlot(false), T_PHASE2 + 80);
    return () => clearTimeout(t);
  }, [isSelected]);
  const slotToRender = questionSlot ?? (keepStaleSlot ? lastSlot.current : null);

  const questionTop = positioned ? MODE_PILLS_TOP_INSET + pillRowHeight + Theme.spacing.xxl : 0;

  return (
    <View style={styles.modeFlow} onLayout={(e) => setFlowHeight(e.nativeEvent.layout.height)}>
      <Reanimated.View style={[styles.modeFlowInner, innerStyle]}>
        <Reanimated.View
          style={[styles.introWrap, introStyle]}
          pointerEvents="none"
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            setIntroHeight((p) => (Math.abs(p - h) < 0.5 ? p : h));
          }}>
          <ThemedText style={styles.tagline}>Unmute your potential.</ThemedText>
          <ThemedText style={styles.chooseMode} themeColor="textSecondary">
            Choose a mode.
          </ThemedText>
        </Reanimated.View>

        <View
          style={styles.modeList}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setRowWidth((p) => (Math.abs(p - width) < 0.5 ? p : width));
            setPillRowHeight((p) => (Math.abs(p - height) < 0.5 ? p : height));
          }}>
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
            <ModePill
              key={option.mode}
              label={option.label}
              fontSize={labelFontSize}
              selected={selectedMode === option.mode}
              onPress={() => onSelectMode(option.mode)}
            />
          ))}
        </View>
      </Reanimated.View>

      <Reanimated.View
        style={[styles.questionSlot, questionStyle, { top: questionTop }]}
        pointerEvents={isSelected ? 'auto' : 'none'}>
        {/* Scrolls — a long pool question + the record disc + hint can still
            overflow a short viewport. */}
        <ScrollView
          style={styles.questionScroll}
          contentContainerStyle={styles.questionScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive">
          {slotToRender}
        </ScrollView>
      </Reanimated.View>
    </View>
  );
}

// The question area, folded into `ModeSelectFlow`'s animated slot. Three
// display states:
//   - 'pool':   the daily question as large centred quoted text, with an
//               "Ask my own question instead" link below it.
//   - 'input':  a bordered input box with a submit icon; the link flips to
//               "‹ Use prompt instead".
//   - 'custom': the confirmed typed question in the same quoted style, with a
//               pencil to re-edit; "‹ Use prompt instead" still abandons it.
// Validation: non-empty after trim. State swaps just cross-fade with a light
// `LinearTransition` for the height change.
//
// `poolQuestion` / `customQuestion` are the parent's state; this component
// only owns the in-progress `draft`, its validation error, and whether the
// input box is open (`editing`).
function QuestionArea({
  mode,
  poolQuestion,
  loading,
  error,
  customQuestion,
  onRetry,
  onConfirmCustom,
  onClearCustom,
  onStartRecording,
}: {
  mode: 'interview' | 'story';
  poolQuestion: DailyQuestion | null;
  loading: boolean;
  error: string | null;
  customQuestion: string | null;
  onRetry: () => void;
  onConfirmCustom: (text: string) => void;
  onClearCustom: () => void;
  onStartRecording: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  const view: 'pool' | 'input' | 'custom' = editing ? 'input' : customQuestion != null ? 'custom' : 'pool';

  function beginEditing() {
    setDraft(customQuestion ?? '');
    setDraftError(null);
    setEditing(true);
  }

  function submitDraft() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraftError('Type a question or topic first.');
      return;
    }
    setDraftError(null);
    setEditing(false);
    onConfirmCustom(trimmed);
  }

  function usePromptInstead() {
    setEditing(false);
    setDraft('');
    setDraftError(null);
    onClearCustom();
  }

  const backLink = <BackLink label="Use prompt instead" onPress={usePromptInstead} style={styles.backLink} />;

  // The record affordance: a red disc on a larger off-white disc, with a hint
  // below. Advances to `flowScreen === 'record'`, where the real recording
  // happens.
  const recordStart = (
    <View style={styles.recordStart}>
      <Pressable
        onPress={onStartRecording}
        style={({ pressed }) => [styles.recordOuter, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Start recording">
        <View style={styles.recordInner} />
      </Pressable>
      <ThemedText style={styles.recordHint}>Tap to start recording</ThemedText>
    </View>
  );

  return (
    <Reanimated.View style={styles.questionArea} layout={LinearTransition.duration(220)}>
      {view === 'pool' && (
        <Reanimated.View style={styles.questionState} entering={FadeIn.duration(180)}>
          {loading && (
            <View style={styles.uploadingRow}>
              <ActivityIndicator />
              <ThemedText type="small" themeColor="textSecondary">
                Loading today&apos;s question…
              </ThemedText>
            </View>
          )}
          {!loading && error && (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.uriLabel}>
                {error}
              </ThemedText>
              <Pressable onPress={onRetry} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText style={styles.questionLink}>Try again</ThemedText>
              </Pressable>
            </>
          )}
          {!loading && !error && poolQuestion && (
            <>
              <ThemedText style={styles.questionQuote}>{`“${poolQuestion.text}”`}</ThemedText>
              <Pressable onPress={beginEditing} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText style={styles.questionLink}>Ask my own question instead</ThemedText>
              </Pressable>
              <View style={styles.questionGapTop} />
              {recordStart}
              <View style={styles.questionGapBottom} />
            </>
          )}
        </Reanimated.View>
      )}

      {view === 'input' && (
        <Reanimated.View style={styles.questionState} entering={FadeIn.duration(180)}>
          {backLink}
          <View style={styles.customInputBox}>
            <TextInput
              style={styles.customInputField}
              placeholder={mode === 'interview' ? 'Type your own interview question…' : 'Type your own story prompt…'}
              placeholderTextColor="#56453D80"
              value={draft}
              onChangeText={(t) => {
                setDraft(t);
                if (draftError) setDraftError(null);
              }}
              multiline
              autoFocus
            />
            <Pressable
              onPress={submitDraft}
              hitSlop={8}
              style={({ pressed }) => [styles.customSubmit, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Use this question">
              <SymbolView name="arrow.up.circle.fill" size={26} tintColor={Theme.colors.accent} />
            </Pressable>
          </View>
          {draftError && (
            <ThemedText type="small" style={styles.uriLabel}>
              {draftError}
            </ThemedText>
          )}
        </Reanimated.View>
      )}

      {view === 'custom' && customQuestion != null && (
        <Reanimated.View style={styles.questionState} entering={FadeIn.duration(180)}>
          {backLink}
          <View style={styles.questionQuoteRow}>
            <ThemedText style={[styles.questionQuote, styles.questionQuoteInRow]}>
              {`“${customQuestion}”`}
            </ThemedText>
            <Pressable
              onPress={beginEditing}
              hitSlop={8}
              style={({ pressed }) => [styles.editPencil, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Edit your question">
              <SymbolView name="pencil" size={16} tintColor={Theme.colors.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.questionGapTop} />
          {recordStart}
          <View style={styles.questionGapBottom} />
        </Reanimated.View>
      )}
    </Reanimated.View>
  );
}

export default function RecordScreen() {
  const { user } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    rpSource?: string;
    rpMode?: string;
    rpQuestion?: string;
    rpQuestionId?: string;
    rpTs?: string;
  }>();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);

  const [flowScreen, setFlowScreen] = useState<FlowScreen>('mode-select');
  // The mode chosen for the current attempt, carried through into
  // handleKeepAndUpload's insert.
  const [selectedMode, setSelectedMode] = useState<Mode | null>(null);
  // The pool pick (loaded for interview/story) and the confirmed custom
  // question, kept as SEPARATE state so `QuestionArea` can toggle between
  // them. The effective question for the recording is
  // `customQuestion ?? poolQuestion?.text`.
  const [poolQuestion, setPoolQuestion] = useState<DailyQuestion | null>(null);
  const [customQuestion, setCustomQuestion] = useState<string | null>(null);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);
  // Non-null while this attempt is a re-practice of an existing recording
  // (see `RePracticeContext` above). Drives the read-only question banner and
  // the `re_practice_of` value on upload.
  const [rePractice, setRePractice] = useState<RePracticeContext | null>(null);

  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);

  // Per-user recording cap (MAX_RECORDINGS_PER_USER), checked in
  // `handleSelectMode`. `checkingCap` guards against a double-tap firing two
  // count queries at once; `blockedByCap` swaps the mode options for a
  // blocking message once the user is at/over the cap.
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
  // If the `POST /recordings/{id}/process` kick-off itself fails (the upload
  // already succeeded), `ProcessingStatus` shows a "couldn't start
  // processing" note + retry rather than the status silently sticking at
  // "Pending".
  const [processingKickoffError, setProcessingKickoffError] = useState<string | null>(null);
  // Set once per recording (on first upload attempt) so a retry after a
  // failure overwrites the same Storage object instead of leaving stray
  // partial uploads behind. Cleared whenever the recording itself resets.
  const audioPathRef = useRef<string | null>(null);

  // After upload the user stays on this screen watching live status. When
  // they *leave* after a recording is done, the screen resets on their next
  // visit so no stale status lingers. `uploadStateRef` lets the blur handler
  // read the latest upload state without re-subscribing; `resetPendingRef` is
  // the "reset me on next focus" flag.
  const uploadStateRef = useRef(uploadState);
  useEffect(() => {
    uploadStateRef.current = uploadState;
  }, [uploadState]);
  const resetPendingRef = useRef(false);

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

  // Clears just the current take (audio + upload + processing state), leaving
  // the chosen mode/question in place — "Discard & re-record" and "Record
  // another" (same prompt). All setters are stable so `[]` deps is correct.
  const resetRecordingState = useCallback(() => {
    setRecordedUri(null);
    audioPathRef.current = null;
    setUploadState('idle');
    setUploadError(null);
    setUploadedRecordingId(null);
    setProcessingKickoffError(null);
  }, []);

  // Full reset back to the mode-select screen — abandons the take *and* the
  // chosen mode/question. Used by "‹ Change mode" and the post-recording
  // reset-on-return below.
  const handleBackToModeSelect = useCallback(() => {
    resetRecordingState();
    setSelectedMode(null);
    setPoolQuestion(null);
    setCustomQuestion(null);
    setQuestionError(null);
    setRePractice(null);
    setFlowScreen('mode-select');
  }, [resetRecordingState]);

  // Reset the screen the next time it's focused, but only if the user left
  // *after* finishing a recording. Leaving mid-take (recorded-not-uploaded)
  // is preserved — an accidental tab tap shouldn't throw away an unsaved take.
  useFocusEffect(
    useCallback(() => {
      if (resetPendingRef.current) {
        resetPendingRef.current = false;
        handleBackToModeSelect();
      }
      return () => {
        if (uploadStateRef.current === 'done') {
          resetPendingRef.current = true;
        }
      };
    }, [handleBackToModeSelect])
  );

  // Kick off backend processing. Best-effort — the upload already succeeded
  // and the row exists, so a failure here doesn't lose the recording; it's
  // surfaced inline with a retry.
  const kickProcessing = useCallback(async (id: string) => {
    setProcessingKickoffError(null);
    try {
      await startProcessing(id);
    } catch (err) {
      console.warn('Failed to start processing for recording', id, err);
      setProcessingKickoffError(err instanceof Error ? err.message : 'Could not start processing.');
    }
  }, []);

  // Fetches today's globally-assigned question for the mode from
  // `GET /questions/daily` and stores it as `poolQuestion` (id + text). Also
  // the retry target for `QuestionArea`'s "Try again".
  async function loadQuestion(mode: 'interview' | 'story') {
    setQuestionLoading(true);
    setQuestionError(null);
    setPoolQuestion(null);
    try {
      const question = await fetchDailyQuestion(mode);
      setPoolQuestion(question);
    } catch (err) {
      setQuestionError(err instanceof Error ? err.message : "Couldn't load today's question.");
    } finally {
      setQuestionLoading(false);
    }
  }

  // Selecting a mode drives `ModeSelectFlow`'s shift animation
  // (interview/story), after which the folded-in `QuestionArea` shows.
  // Miscellaneous has no question step and jumps straight to 'record'. The
  // recording-cap check runs earlier, in `handleSelectMode`.
  function startModeSelection(mode: Mode) {
    // Clear any finished/lingering take so entering the record flow is fresh.
    resetRecordingState();
    setCustomQuestion(null);
    setPoolQuestion(null);
    setQuestionError(null);
    setRePractice(null);
    if (mode === 'miscellaneous') {
      setSelectedMode('miscellaneous');
      setFlowScreen('record');
      return;
    }
    setSelectedMode(mode);
    loadQuestion(mode);
  }

  // Enter the read-only re-practice state from a History 3-dot menu handoff
  // (route params, consumed by the effect below). Runs the same recording-cap
  // check `handleSelectMode` does — no exemption for re-practice. On a cap
  // hit it drops back to mode-select showing the `CapBlockedCard`; otherwise
  // straight to the record screen with the mode + question fixed.
  const enterRePractice = useCallback(
    async (ctx: RePracticeContext) => {
      // A prior finished take's "reset me on next focus" flag would otherwise
      // fire `handleBackToModeSelect` and bounce us out of re-practice.
      resetPendingRef.current = false;
      resetRecordingState();
      setCustomQuestion(null);
      setPoolQuestion(null);
      setQuestionError(null);
      setBlockedByCap(false);

      if (user) {
        try {
          const count = await getActiveRecordingCount(user.id);
          if (count >= MAX_RECORDINGS_PER_USER) {
            setRePractice(null);
            setSelectedMode(null);
            setFlowScreen('mode-select');
            setBlockedByCap(true);
            return;
          }
        } catch (err) {
          // Fail open, same as `handleSelectMode` — the Postgres trigger is
          // the real backstop.
          console.warn('Recording cap check failed for re-practice, allowing it to proceed', err);
        }
      }

      setRePractice(ctx);
      setSelectedMode(ctx.mode);
      setFlowScreen('record');
    },
    [resetRecordingState, user]
  );

  // Consume the History re-practice handoff. `rpTs` is a per-tap nonce — we
  // dedupe on it (via `rpConsumedRef`) so re-focusing this tab later doesn't
  // re-trigger, and so re-practicing the same recording twice in a row still
  // fires. The params are cleared afterward as a belt-and-braces second guard.
  const rpConsumedRef = useRef<string | null>(null);
  useEffect(() => {
    const ts = typeof params.rpTs === 'string' ? params.rpTs : null;
    const source = typeof params.rpSource === 'string' ? params.rpSource : null;
    const mode =
      params.rpMode === 'interview' || params.rpMode === 'story' ? params.rpMode : null;
    if (!ts || !source || !mode || rpConsumedRef.current === ts) return;
    rpConsumedRef.current = ts;

    const question = typeof params.rpQuestion === 'string' ? params.rpQuestion : '';
    const questionId =
      typeof params.rpQuestionId === 'string' && params.rpQuestionId ? params.rpQuestionId : null;

    enterRePractice({ sourceId: source, mode, question, questionId });
    router.setParams({ rpSource: '', rpMode: '', rpQuestion: '', rpQuestionId: '', rpTs: '' });
  }, [
    params.rpTs,
    params.rpSource,
    params.rpMode,
    params.rpQuestion,
    params.rpQuestionId,
    enterRePractice,
    router,
  ]);

  async function handleSelectMode(mode: Mode) {
    if (!user || checkingCap) return;

    // Already in the "mode picked" sub-state — just switch which pill is
    // filled / which question loads. The cap check already passed and the
    // recording count can't have changed since.
    if (selectedMode) {
      startModeSelection(mode);
      return;
    }

    setCheckingCap(true);
    try {
      const count = await getActiveRecordingCount(user.id);
      if (count >= MAX_RECORDINGS_PER_USER) {
        setBlockedByCap(true);
        return;
      }
    } catch (err) {
      // Fail open: don't block over a cap check that couldn't complete (e.g. a
      // network blip) — the Postgres trigger is the real backstop.
      console.warn('Recording cap check failed, allowing recording to proceed', err);
    } finally {
      setCheckingCap(false);
    }

    startModeSelection(mode);
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
      // A re-practice attempt carries the original recording's
      // mode / question / question_id verbatim, plus `rePracticeOf` = the id
      // of the recording the 3-dot menu was opened from.
      //
      // Otherwise: miscellaneous has no question; interview/story pass the
      // chosen question (the custom-typed text if any, else the daily pool
      // pick), and `question_id` is set only for a pool pick.
      const usingCustom = customQuestion != null;
      const mode = rePractice ? rePractice.mode : (selectedMode ?? 'miscellaneous');
      const question = rePractice
        ? rePractice.question
        : mode === 'miscellaneous'
          ? null
          : (customQuestion ?? poolQuestion?.text ?? null);
      const questionId = rePractice
        ? rePractice.questionId
        : mode === 'miscellaneous' || usingCustom
          ? null
          : (poolQuestion?.id ?? null);
      const result = await uploadRecording({
        userId: user.id,
        localUri: recordedUri,
        audioPath: path,
        mode,
        question,
        questionId,
        rePracticeOf: rePractice?.sourceId ?? null,
      });
      setUploadedRecordingId(result.id);
      setUploadState('done');

      // Kick off backend processing, then STAY on this screen —
      // `ProcessingStatus` polls the recording and shows
      // pending -> processing -> done/failed live, with a "See more details"
      // link to the History detail screen once done.
      kickProcessing(result.id);
    } catch (err) {
      const stage = err instanceof RecordingUploadError ? err.stage : 'upload';
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setUploadError({ message, stage });
      setUploadState('error');
    }
  }

  const elapsed = formatDuration(recorderState.durationMillis / 1000);

  // The question banner shown above the record button on the 'record' screen.
  // In re-practice mode it's the fixed original question; otherwise the chosen
  // custom text or daily pool pick. Miscellaneous has none.
  const recordMode: Mode | null = rePractice ? rePractice.mode : selectedMode;
  const recordQuestion = rePractice
    ? rePractice.question
    : (customQuestion ?? poolQuestion?.text ?? null);

  // Show the "Change mode" header back link (in place of `AppHeader`) whenever
  // we're past mode selection but before a take exists: the mode-picked
  // sub-state of mode-select, AND the pre-recording record screen. Once
  // recording starts or a take is captured, `AppHeader` returns. This is the
  // one back affordance for the record flow, and it always lives in the
  // header row, never inline in the body.
  const showChangeModeHeader =
    (flowScreen === 'mode-select' && !!selectedMode) ||
    (flowScreen === 'record' && !recordedUri && !recorderState.isRecording);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* Once a mode is picked (and through the pre-recording record
            screen), the header swaps from `AppHeader` to a "Change mode"
            `HeaderBackLink`. Both render through the same row shape, so the
            header's position never shifts, only its content. */}
        {showChangeModeHeader ? (
          <Reanimated.View
            style={styles.headerFade}
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(150)}>
            <HeaderBackLink label="Change mode" onPress={handleBackToModeSelect} />
          </Reanimated.View>
        ) : (
          <AppHeader />
        )}
        <ThemedView style={styles.heroSection}>
          {flowScreen === 'mode-select' &&
            (blockedByCap ? (
              <CapBlockedCard onGoToHistory={() => router.navigate('/history')} />
            ) : (
              <ModeSelectFlow
                selectedMode={selectedMode}
                onSelectMode={handleSelectMode}
                questionSlot={
                  selectedMode && selectedMode !== 'miscellaneous' ? (
                    <QuestionArea
                      key={selectedMode}
                      mode={selectedMode}
                      poolQuestion={poolQuestion}
                      loading={questionLoading}
                      error={questionError}
                      customQuestion={customQuestion}
                      onRetry={() => loadQuestion(selectedMode)}
                      onConfirmCustom={(t) => setCustomQuestion(t)}
                      onClearCustom={() => setCustomQuestion(null)}
                      onStartRecording={() => setFlowScreen('record')}
                    />
                  ) : null
                }
              />
            ))}

          {flowScreen === 'record' && (
            <>
              {!recordedUri && (
                <View style={styles.recordArea}>
                  {recordMode && recordMode !== 'miscellaneous' && recordQuestion && (
                    <Card style={styles.questionBanner}>
                      <ThemedText type="small" themeColor="textSecondary">
                        {rePractice
                          ? `Re-practising this ${MODE_LABELS[recordMode]} question`
                          : `${MODE_LABELS[recordMode]} question`}
                      </ThemedText>
                      <ThemedText type="smallBold" style={styles.uriLabel}>
                        {recordQuestion}
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
                          <ThemedText type="link">Open Settings</ThemedText>
                        </Pressable>
                      )}
                    </Card>
                  )}

                </View>
              )}

              {recordedUri && (
                <RecordingPlayback
                  uri={recordedUri}
                  uploadState={uploadState}
                  uploadError={uploadError}
                  uploadedRecordingId={uploadedRecordingId}
                  processingKickoffError={processingKickoffError}
                  onKeep={handleKeepAndUpload}
                  onDiscard={resetRecordingState}
                  onRetryKickoff={() => uploadedRecordingId && kickProcessing(uploadedRecordingId)}
                  onSeeDetails={() =>
                    uploadedRecordingId &&
                    router.push({ pathname: '/history/[id]', params: { id: uploadedRecordingId } })
                  }
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
    // No horizontal padding here — `AppHeader`/`HeaderBackLink` and
    // `heroSection` below own their own gutters (see the note on
    // `heroSection`).
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  // Wraps the `HeaderBackLink` shown once a mode is selected, purely so its
  // `alignSelf: 'stretch'` row (see `app-header.tsx`) actually gets to
  // stretch full width — `Reanimated.View` has no layout opinion of its
  // own, and `safeArea` below centres (shrink-wraps) its children rather
  // than stretching them by default.
  headerFade: {
    alignSelf: 'stretch',
  },
  heroSection: {
    // `alignSelf: 'stretch'` is load-bearing: `safeArea` centres its
    // children, so without it `heroSection` hugs its widest child (the
    // tagline) and the mode-select row can never get wider than that line.
    // Also this screen's one horizontal-gutter source below the header (on
    // here, not `safeArea`, so `AppHeader`'s own gutter isn't doubled).
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: Spacing.four,
    paddingHorizontal: Spacing.three,
  },
  // `modeFlow` is the full-height stage; `modeFlowInner` (pill row + the
  // floating intro) sits at the top of it and gets the animated `translateY`
  // that slides it between centred and top.
  modeFlow: {
    flex: 1,
    alignSelf: 'stretch',
  },
  modeFlowInner: {
    alignSelf: 'stretch',
    // Above `questionSlot` in the paint/hit order: the slot's ScrollView
    // overlaps where the centred (unselected) pills sit, so this keeps the
    // pills painted on top and tappable there.
    zIndex: 1,
  },
  // The intro floats *above* the pill row (absolute, its bottom pinned to
  // the row's top) so fading/moving it never shifts the pills.
  introWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xl,
  },
  tagline: {
    fontFamily: Theme.typography.variants.title.fontFamily,
    fontSize: Theme.typography.variants.title.fontSize,
    lineHeight: Theme.typography.variants.title.lineHeight,
    textAlign: 'center',
  },
  chooseMode: {
    fontFamily: Theme.typography.variants.body.fontFamily,
    fontSize: Theme.typography.variants.body.fontSize,
    lineHeight: Theme.typography.variants.body.lineHeight,
    textAlign: 'center',
  },
  // The three mode pills on one horizontal row, each `flex: 1`. Shared
  // measured label font size (see `ModeSelectFlow`). This row is the one
  // element that moves in the shift animation.
  modeList: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: Theme.spacing.sm,
  },
  // `ModeSelectFlow`'s question slot: absolutely positioned from just below
  // the pills (`top`) to the bottom of the stage, only fades/rises in. Holds
  // a `ScrollView` wrapping `QuestionArea` (a long question + the disc + hint
  // can overflow a short screen).
  questionSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'stretch',
  },
  questionScroll: {
    flex: 1,
    alignSelf: 'stretch',
  },
  questionScrollContent: {
    // Fill the slot (so the flex spacers inside have room); question + link
    // stay near the top, the record disc + hint are pushed down by a flex
    // spacer. Scrolls if a long question makes it all overflow.
    flexGrow: 1,
    alignItems: 'center',
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xl,
  },
  // `QuestionArea` root: a plain column (no card / border of its own — only
  // the custom-input state has a box). `flex: 1` so the per-state flex
  // spacers work.
  questionArea: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: Theme.spacing.lg,
    paddingHorizontal: Theme.spacing.sm,
  },
  questionState: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: Theme.spacing.md,
  },
  // Flex spacers that push the record disc down into the lower part of the
  // slot, sitting a touch above the centre of that gap (top spacer < bottom).
  questionGapTop: {
    flex: 1,
  },
  questionGapBottom: {
    flex: 1.3,
  },
  // Centred question text — `regular` weight, 20px: a touch larger than
  // "Choose a mode." (`body`, 16), which the rest of this screen is scaled
  // around.
  questionQuote: {
    fontFamily: Theme.typography.fontFamily.regular,
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
    color: Theme.colors.textPrimary,
  },
  questionQuoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: Theme.spacing.sm,
    alignSelf: 'stretch',
  },
  questionQuoteInRow: {
    flexShrink: 1,
  },
  editPencil: {
    // small nudge so the pencil sits on the first line's optical centre.
    marginTop: 2,
  },
  // The interactive links ("Ask my own question instead" / "‹ Use prompt
  // instead" / "Try again"). `Theme.colors.link` is the one app-wide link
  // blue — no underline, the blue carries it.
  questionLink: {
    fontFamily: Theme.typography.fontFamily.medium,
    fontSize: Theme.typography.variants.label.fontSize,
    lineHeight: Theme.typography.variants.label.lineHeight,
    color: Theme.colors.link,
  },
  backLink: {
    alignSelf: 'flex-start',
  },
  // The custom-question input box — a styled `View` wrapping the TextInput,
  // not a raw RN TextInput border. Icon submit button on the right.
  customInputBox: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Theme.spacing.sm,
    backgroundColor: Theme.colors.card,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: 30,
    paddingLeft: Theme.spacing.lg,
    paddingRight: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
  },
  customInputField: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    paddingVertical: Theme.spacing.xs,
    fontFamily: Theme.typography.fontFamily.regular,
    fontSize: 16,
    lineHeight: 22,
    color: Theme.colors.textPrimary,
    textAlignVertical: 'top',
  },
  customSubmit: {
    paddingBottom: Theme.spacing.xs,
  },
  // The record affordance below the question — a red disc layered on a larger
  // off-white bordered disc, with a hint below. Advances to
  // `flowScreen === 'record'`.
  recordStart: {
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  recordOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Theme.colors.card,
    borderWidth: 1,
    borderColor: Theme.colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: Theme.colors.recordRed,
  },
  recordHint: {
    fontFamily: Theme.typography.fontFamily.regular,
    fontSize: Theme.typography.variants.label.fontSize,
    lineHeight: Theme.typography.variants.label.lineHeight,
    color: Theme.colors.textPrimary,
    textAlign: 'center',
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
    // RN has no shadow "spread", so `shadowRadius` stands in for the design's
    // spread + blur; `elevation` is the Android equivalent.
    shadowColor: Theme.colors.shadow,
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 25,
    elevation: 3,
  },
  modePillLabel: {
    // `fontSize` is set inline by `ModeSelectFlow` (one measured value shared
    // by all three pills — see the MODE_LABEL_* constants).
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
  // Inline processing-status block (`ProcessingStatus`).
  processingStatus: {
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: Theme.spacing.sm,
    marginTop: Theme.spacing.xs,
  },
  errorText: {
    color: '#e5484d',
    textAlign: 'center',
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
  pressed: {
    opacity: 0.7,
  },
});
