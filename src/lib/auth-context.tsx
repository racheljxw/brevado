import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';

type AuthResult = { error: string | null };
// Supabase returns a user with no session when email confirmation is
// required — signUp surfaces that distinctly so the screen can explain it
// instead of silently doing nothing (there's no error, just no sign-in yet).
type SignUpResult = AuthResult & { needsEmailConfirmation: boolean };

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  // True only while the initial session check (app boot) is in flight — lets
  // the root layout hold a loading screen instead of flashing login/home.
  loading: boolean;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Turns Supabase's raw AuthError into copy that's safe to show directly in
// the UI. Supabase's messages are generally fine as-is, but this is the one
// seam where we'd swap in friendlier copy or redact anything sensitive later
// — screens should never touch `error.message` themselves.
function toUserMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '');
    if (message) return message;
  }
  return 'Something went wrong. Please try again.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session);
      setLoading(false);
    });

    // Fires on sign-in, sign-out, and token refresh, so `session` stays
    // current without any screen having to re-fetch or poll it.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return;
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      async signUp(email, password) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        return {
          error: error ? toUserMessage(error) : null,
          // If sign-up succeeded but no session came back, email confirmation
          // is required before this account can log in.
          needsEmailConfirmation: !error && !data.session,
        };
      },
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error ? toUserMessage(error) : null };
      },
      async signOut() {
        const { error } = await supabase.auth.signOut();
        return { error: error ? toUserMessage(error) : null };
      },
    }),
    [session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
