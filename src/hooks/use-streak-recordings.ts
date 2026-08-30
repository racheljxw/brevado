import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth-context';
import { TERMINAL_STATUSES } from '@/lib/recording-status';
import { fetchRecordings, type RecordingRow } from '@/lib/recordings';

// v3 Epic G Part 3 — the shared fetch shell for the Streaks home screen
// (`streaks/index.tsx`) and the metric detail screens (`streaks/[metric].tsx`).
// Both read the exact same `fetchRecordings()` query History's list runs, so
// Streaks and History never disagree about what recordings exist, and the
// home screen and its detail screens never disagree with each other.
//
// Same shape as the History list's own fetch (Phase 2 Step 7): `useFocusEffect`
// refetch, a `requestSeqRef` out-of-order guard, pull-to-refresh, and a 1.5s
// poll while any row is non-terminal so a just-uploaded session's scores fold
// in without a manual refresh. Part 2 inlined this in `streaks.tsx`; Part 3
// pulled it into a hook now that two screens need it.
export function useStreakRecordings() {
  const { user } = useAuth();

  const [recordings, setRecordings] = useState<RecordingRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    const requestId = ++requestSeqRef.current;
    setError(null);
    try {
      const rows = await fetchRecordings(user.id);
      if (requestId !== requestSeqRef.current) return;
      setRecordings(rows);
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not load your streaks.');
    } finally {
      if (requestId === requestSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const recordingsRef = useRef<RecordingRow[] | null>(null);
  useEffect(() => {
    recordingsRef.current = recordings;
  }, [recordings]);

  useFocusEffect(
    useCallback(() => {
      const interval = setInterval(() => {
        const rows = recordingsRef.current ?? [];
        if (rows.some((row) => !TERMINAL_STATUSES.has(row.status))) load();
      }, 1500);
      return () => clearInterval(interval);
    }, [load])
  );

  const refresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  return { recordings, loading, refreshing, error, reload: load, refresh };
}
