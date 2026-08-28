import { Link } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { validateEmail, validatePassword } from '@/lib/auth-validation';

export default function SignupScreen() {
  const { signUp } = useAuth();
  const theme = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set when sign-up succeeded but the account needs email confirmation
  // before it can log in (see auth-context's needsEmailConfirmation).
  const [confirmationNotice, setConfirmationNotice] = useState(false);

  async function handleSubmit() {
    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);
    const firstError = emailError ?? passwordError;
    if (firstError) {
      setError(firstError);
      return;
    }

    setError(null);
    setConfirmationNotice(false);
    setSubmitting(true);
    const { error: signUpError, needsEmailConfirmation } = await signUp(email.trim(), password);
    setSubmitting(false);

    if (signUpError) {
      setError(signUpError);
      return;
    }
    if (needsEmailConfirmation) {
      setConfirmationNotice(true);
      return;
    }
    // Otherwise sign-up returned a session directly (email confirmation is
    // off) — auth-context picks it up and RootNavigator swaps to (tabs).
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.form}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ThemedText type="title" style={styles.title}>
            Sign up
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.field}>
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder="Email"
              placeholderTextColor={theme.textSecondary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.field}>
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder="Password"
              placeholderTextColor={theme.textSecondary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="newPassword"
            />
          </ThemedView>

          {error ? (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}

          {confirmationNotice ? (
            <ThemedText type="small" style={styles.notice}>
              Account created — check your email to confirm it before logging in.
            </ThemedText>
          ) : null}

          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            onPress={handleSubmit}
            disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color={Palette.nearWhite} />
            ) : (
              <ThemedText style={styles.buttonText}>Sign up</ThemedText>
            )}
          </Pressable>

          <Link href="/login" asChild>
            <Pressable style={styles.switchLink}>
              <ThemedText type="small" themeColor="textSecondary">
                Already have an account? <ThemedText type="linkPrimary">Log in</ThemedText>
              </ThemedText>
            </Pressable>
          </Link>
        </KeyboardAvoidingView>
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  form: {
    width: '100%',
    gap: Spacing.three,
  },
  title: {
    marginBottom: Spacing.two,
  },
  field: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  input: {
    height: 48,
    fontSize: 16,
  },
  error: {
    color: '#e5484d',
  },
  notice: {
    color: '#3c87f7',
  },
  button: {
    backgroundColor: '#3c87f7',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    // v2 Epic B Part 2: was '#ffffff' — the app never uses pure white now.
    color: Palette.nearWhite,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
  switchLink: {
    alignItems: 'center',
    marginTop: Spacing.two,
  },
});
