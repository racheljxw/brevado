import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioPlaybackControls } from '@/components/audio-playback-controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { startProcessing } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDuration } from '@/lib/format-time';
import {
  buildAudioPath,
  getActiveRecordingCount,
  MAX_RECORDINGS_PER_USER,
  RecordingUploadError,
  uploadRecording,
  type RecordingUploadStage,
} from '@/lib/recordings';

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
    <ThemedView type="backgroundElement" style={styles.playbackCard}>
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
    </ThemedView>
  );
}

// Phase 3 Step 3 — shown in place of the record button once
// `handleStartRecording` finds the user at/over MAX_RECORDINGS_PER_USER.
// See docs/CLAUDE.md's Audio retention section: manual delete (Phase 3 Step
// 5) is the only way to free a slot, so this is the entry point into
// History to do that.
function CapBlockedCard({ onGoToHistory }: { onGoToHistory: () => void }) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={styles.playbackCard}>
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
    </ThemedView>
  );
}

export default function RecordScreen() {
  const { user, signOut } = useAuth();
  const theme = useTheme();
  const router = useRouter();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);

  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);

  // Phase 3 Step 3: per-user recording cap (MAX_RECORDINGS_PER_USER) — see
  // docs/CLAUDE.md's Audio retention section. `checkingCap` guards against a
  // double-tap firing two count queries at once; `blockedByCap` swaps the
  // whole record entry point for a blocking message once we know the user
  // is at/over the cap.
  const [checkingCap, setCheckingCap] = useState(false);
  const [blockedByCap, setBlockedByCap] = useState(false);

  // Re-arm the check on every focus (e.g. coming back from History after
  // freeing a slot) so a stale "blocked" state doesn't linger — the next
  // record tap re-checks for real via handleStartRecording below, this just
  // clears the message so the normal record button reappears.
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

  async function handleStartRecording() {
    if (!user || checkingCap) return;

    // Phase 3 Step 3: check the per-user recording cap BEFORE opening the
    // recording UI at all — not after recording + upload, per
    // docs/CLAUDE.md's Audio retention section. This is the "natural
    // checkpoint" until Phase 4's mode-selection screen replaces this
    // button as the entry point (see the note left there for that).
    setCheckingCap(true);
    try {
      const count = await getActiveRecordingCount(user.id);
      if (count >= MAX_RECORDINGS_PER_USER) {
        setBlockedByCap(true);
        return;
      }
    } catch (err) {
      // Fail open: don't block recording over a cap check that itself
      // couldn't complete (e.g. a network blip) — the Postgres trigger
      // (supabase/migrations/0004_recording_cap_enforcement.sql) is the
      // real safety net if this ever lets someone squeak past the cap.
      console.warn('Recording cap check failed, allowing recording to proceed', err);
    } finally {
      setCheckingCap(false);
    }

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
      const result = await uploadRecording({ userId: user.id, localUri: recordedUri, audioPath: path });
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
        <ThemedView style={styles.heroSection}>
          <ThemedText type="title" style={styles.title}>
            Brevado
          </ThemedText>
          {user?.email ? (
            <ThemedText type="small" themeColor="textSecondary">
              Logged in as {user.email}
            </ThemedText>
          ) : null}

          {!recordedUri && blockedByCap && <CapBlockedCard onGoToHistory={() => router.navigate('/history')} />}

          {!recordedUri && !blockedByCap && (
            <View style={styles.recordArea}>
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
                <ThemedView type="backgroundElement" style={styles.permissionCard}>
                  <ThemedText type="small">
                    Brevado needs microphone access to record practice sessions, and it&apos;s currently
                    turned off. {canAskAgain ? 'Tap the record button to try again.' : 'Enable it in Settings to continue.'}
                  </ThemedText>
                  {!canAskAgain && Platform.OS !== 'web' && (
                    <Pressable onPress={() => Linking.openSettings()}>
                      <ThemedText type="linkPrimary">Open Settings</ThemedText>
                    </Pressable>
                  )}
                </ThemedView>
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
        </ThemedView>

        {/* Temporary — just here so the full login/logout loop is testable
            in Phase 1. Will move somewhere more permanent (settings/profile)
            in a later phase. */}
        <Pressable
          style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}
          onPress={() => signOut()}>
          <ThemedText type="smallBold">Sign out</ThemedText>
        </Pressable>

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
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  heroSection: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  title: {
    textAlign: 'center',
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
  signOutButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5484d',
  },
  pressed: {
    opacity: 0.7,
  },
});
