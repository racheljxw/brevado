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
import { MaxContentWidth, Palette, Spacing, Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { validateEmail } from '@/lib/auth-validation';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const theme = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const emailError = validateEmail(email);
    const passwordError = password ? null : 'Password is required.';
    const firstError = emailError ?? passwordError;
    if (firstError) {
      setError(firstError);
      return;
    }

    setError(null);
    setSubmitting(true);
    const { error: signInError } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (signInError) {
      setError(signInError);
    }
    // On success, auth-context's session update flips RootNavigator over to
    // (tabs) automatically — nothing to navigate here.
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.form}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ThemedText type="title" style={styles.title}>
            Log in
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
              textContentType="password"
            />
          </ThemedView>

          {error ? (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}

          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            onPress={handleSubmit}
            disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color={Palette.nearWhite} />
            ) : (
              <ThemedText style={styles.buttonText}>Log in</ThemedText>
            )}
          </Pressable>

          <Link href="/signup" asChild>
            <Pressable style={styles.switchLink}>
              <ThemedText type="small" themeColor="textSecondary">
                Don&apos;t have an account? <ThemedText type="link">Sign up</ThemedText>
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
  button: {
    backgroundColor: Theme.colors.link,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
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
