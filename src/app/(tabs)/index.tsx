import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { formatDuration } from '@/lib/format-time';
import { buildAudioPath, RecordingUploadError, uploadRecording, type RecordingUploadStage } from '@/lib/recordings';

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
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const togglePlayback = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish) {
      player.seekTo(0);
    }
    player.play();
  };

  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;
  const isUploading = uploadState === 'uploading';

  return (
    <ThemedView type="backgroundElement" style={styles.playbackCard}>
      <ThemedText type="smallBold">{uploadState === 'done' ? 'Uploaded' : 'Recording ready'}</ThemedText>

      <Pressable
        style={({ pressed }) => [styles.playButton, { borderColor: theme.text }, pressed && styles.pressed]}
        onPress={togglePlayback}>
        <ThemedText type="smallBold">{status.playing ? 'Pause' : 'Play'}</ThemedText>
      </Pressable>

      <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
        <View style={[styles.progressFill, { backgroundColor: theme.text, width: `${progress * 100}%` }]} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {formatDuration(status.currentTime)} / {formatDuration(status.duration)}
      </ThemedText>

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

export default function RecordScreen() {
  const { user, signOut } = useAuth();
  const theme = useTheme();
  const router = useRouter();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);

  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);

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

          {!recordedUri && (
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
  progressTrack: {
    alignSelf: 'stretch',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
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
