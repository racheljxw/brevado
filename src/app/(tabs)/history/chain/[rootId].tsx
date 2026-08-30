import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HeaderBackLink } from '@/components/app-header';
import { Card } from '@/components/card';
import { FavoriteStar } from '@/components/favorite-star';
import { RecordingActionsMenu, type RecordingMenuAction } from '@/components/recording-actions-menu';
import { RecordingDetailBody } from '@/components/recording-detail-body';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TitleSection } from '@/components/title-section';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing, Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteRecording, deleteRecordingAudio, regenerateReport } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatRecordedAt } from '@/lib/format-time';
import { formatMode, modePillColors } from '@/lib/modes';
import { TERMINAL_STATUSES } from '@/lib/recording-status';
import { buildChains, chainQuestion } from '@/lib/re-practice-chains';
import {
  canRePracticeRecording,
  fetchRecordingDetailsByIds,
  fetchRecordings,
  rePracticeNavParams,
  setFavorite,
  shareRecordingAudio,
  updateRecordingTitle,
  type RecordingDetail,
} from '@/lib/recordings';

// v4 Epic J Part 2 — the re-practice chain detail screen: an accordion, one
// panel per attempt of a question, replacing Part 1's interim "tap a grouped
// card -> the most recent attempt's normal detail screen".
//
// Route: `/history/chain/[rootId]` — `rootId` is the chain root id the Part 1
// grouped card (`history/index.tsx`) computes via `buildChains`. Only
// multi-member chains navigate here; a single-member chain still opens the
// unchanged `history/[id]` screen.
//
// Data: `fetchRecordings` + `buildChains` to resolve which recordings are in
// this chain (client-side, same query the List uses), then
// `fetchRecordingDetailsByIds` for each member's full transcript / feedback /
// scores. Both re-run on focus so a favorite toggled on the List, a new
// re-practice attempt, or a deletion elsewhere all reflect here.
//
// Layout:
//   - "Back to History" header link.
//   - Chain header: the shared question (`chainQuestion`, same string the
//     grouped card shows), mode pill, "N attempts", and ONE favorite star
//     bound to the chain root's `favorite` flag (the confirmed group-level
//     design — toggling here writes the same row the List card reads).
//   - One `<Card>` panel per attempt, most-recent first, most-recent expanded
//     by default. Each panel header shows that attempt's date + status + its
//     OWN 3-dot `RecordingActionsMenu` (Download / Delete audio / Delete
//     recording / Regenerate — NOT favorite). Expanded, the panel renders
//     `<TitleSection>` (editable per attempt) + the shared
//     `<RecordingDetailBody>`.

type ScreenState = 'loading' | 'not-found' | 'error' | 'loaded';

function panelStatusLabel(status: string): string {
  if (status === 'done') return 'Done';
  if (status === 'failed') return 'Failed';
  return 'Processing…';
}

// Most-recent first; ties broken by id descending (matches `buildChains`).
function sortNewestFirst(rows: RecordingDetail[]): RecordingDetail[] {
  return [...rows].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

// Which member the chain-header favorite star reads from / writes to.
// `buildChains` over the current members resolves this naturally: in a linear
// chain the root is the earliest attempt, and if the root is deleted the FK's
// `on delete set null` (migration 0010) promotes the next attempt to root, so
// the star simply follows the earliest surviving attempt. For a branched
// chain (an attempt re-practised from a middle attempt, then the branch
// point deleted) `buildChains` can return several sub-chains — we take the
// root of the largest, tie-broken by the earliest attempt.
function favoriteReference(members: RecordingDetail[]): RecordingDetail {
  const chains = buildChains(members);
  const primary = [...chains].sort(
    (a, b) =>
      b.members.length - a.members.length ||
      (a.members[a.members.length - 1].created_at < b.members[b.members.length - 1].created_at ? -1 : 1)
  )[0];
  if (!primary) return members[0];
  return primary.members.find((m) => m.id === primary.rootId) ?? members[members.length - 1];
}

// Small local helpers for the per-panel in-flight / error state (keyed by
// recording id), the same shape `history/index.tsx` tracks for its list rows.
function useIdSet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  const add = useCallback((id: string) => setSet((s) => new Set(s).add(id)), []);
  const remove = useCallback(
    (id: string) =>
      setSet((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      }),
    []
  );
  return [set, add, remove] as const;
}

function useIdErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setError = useCallback((id: string, message: string) => setErrors((e) => ({ ...e, [id]: message })), []);
  const clearError = useCallback(
    (id: string) =>
      setErrors((e) => {
        if (!(id in e)) return e;
        const next = { ...e };
        delete next[id];
        return next;
      }),
    []
  );
  return [errors, setError, clearError] as const;
}

function ChainPanel({
  recording,
  expanded,
  onToggle,
  onMenuAction,
  menuBusy,
  titleEditing,
  onSaveTitle,
  savingTitle,
  titleError,
  onEndTitleEdit,
  onRegenerate,
  regenerating,
  regenerateError,
  downloadError,
  deleteAudioError,
  deleteRecordingError,
}: {
  recording: RecordingDetail;
  expanded: boolean;
  onToggle: () => void;
  onMenuAction: (action: RecordingMenuAction) => void;
  menuBusy: boolean;
  titleEditing: boolean;
  onSaveTitle: (next: string) => Promise<boolean>;
  savingTitle: boolean;
  titleError: string | null;
  onEndTitleEdit: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
  regenerateError: string | null;
  downloadError?: string;
  deleteAudioError?: string;
  deleteRecordingError?: string;
}) {
  return (
    <Card style={styles.panel}>
      {/* v4 Epic K — the 3-dot menu moved OUT of this collapse header and into
          the expanded body (same row as the title), because it sat right where
          people tap to expand and got hit by accident. The header is now
          purely an expand/collapse target. */}
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.panelHeader, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Attempt from ${formatRecordedAt(recording.created_at)}, ${panelStatusLabel(
          recording.status
        )}`}>
        <View style={styles.panelHeaderText}>
          <ThemedText type="smallBold">{formatRecordedAt(recording.created_at)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {panelStatusLabel(recording.status)}
          </ThemedText>
        </View>
        <SymbolView
          name={expanded ? 'chevron.up' : 'chevron.down'}
          size={16}
          tintColor={Theme.colors.textSecondary}
        />
      </Pressable>

      {expanded && (
        <View style={styles.panelBody}>
          {/* Title (flex) + this attempt's own 3-dot menu, right-aligned —
              mirrors the List card / `[id].tsx` heading row. */}
          <View style={styles.panelTitleRow}>
            <TitleSection
              title={recording.title}
              editing={titleEditing}
              onSave={onSaveTitle}
              saving={savingTitle}
              saveError={titleError}
              onEndEdit={onEndTitleEdit}
            />
            <View style={styles.panelMenu}>
              <RecordingActionsMenu
                canRePractice={canRePracticeRecording(recording)}
                canRename
                canDownload={!recording.audio_deleted && !!recording.audio_path}
                canDeleteAudio={!recording.audio_deleted}
                canRegenerate={recording.status === 'failed'}
                busy={menuBusy}
                onSelect={onMenuAction}
                iconSize={18}
              />
            </View>
          </View>
          {(downloadError || deleteAudioError || deleteRecordingError) && (
            <View style={styles.panelErrors}>
              {downloadError && (
                <ThemedText type="small" style={styles.errorText}>
                  {downloadError}
                </ThemedText>
              )}
              {deleteAudioError && (
                <ThemedText type="small" style={styles.errorText}>
                  {deleteAudioError}
                </ThemedText>
              )}
              {deleteRecordingError && (
                <ThemedText type="small" style={styles.errorText}>
                  {deleteRecordingError}
                </ThemedText>
              )}
            </View>
          )}
          <RecordingDetailBody
            recording={recording}
            onRegenerate={onRegenerate}
            regenerating={regenerating}
            regenerateError={regenerateError}
          />
        </View>
      )}
    </Card>
  );
}

export default function ChainDetailScreen() {
  const params = useLocalSearchParams<{ rootId: string }>();
  const rootId = Array.isArray(params.rootId) ? params.rootId[0] : params.rootId;
  const { user } = useAuth();
  const theme = useTheme();
  const router = useRouter();

  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [members, setMembers] = useState<RecordingDetail[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [favoritePending, setFavoritePending] = useState(false);

  // Per-panel action state, keyed by recording id — same pattern as the
  // History list's per-row state.
  const [regenIds, addRegen, removeRegen] = useIdSet();
  const [regenErrors, setRegenError, clearRegenError] = useIdErrors();
  const [delAudioIds, addDelAudio, removeDelAudio] = useIdSet();
  const [delAudioErrors, setDelAudioError, clearDelAudioError] = useIdErrors();
  const [downloadIds, addDownload, removeDownload] = useIdSet();
  const [downloadErrors, setDownloadError, clearDownloadError] = useIdErrors();
  const [delRecIds, addDelRec, removeDelRec] = useIdSet();
  const [delRecErrors, setDelRecError, clearDelRecError] = useIdErrors();
  const [titleSavingIds, addTitleSaving, removeTitleSaving] = useIdSet();
  const [titleErrors, setTitleError, clearTitleError] = useIdErrors();
  // v4 Epic K — which panels have their title editor open (opened from that
  // panel's "Rename title" menu item; the inline pencil is gone).
  const [renamingIds, addRenaming, removeRenaming] = useIdSet();

  // Out-of-order-response guard shared by the full load and the poll — same
  // purpose as `history/[id].tsx`'s `requestSeqRef`.
  const seqRef = useRef(0);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const membersRef = useRef<RecordingDetail[] | null>(null);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  // Keep the accordion sensible: on first load, expand the most-recent
  // attempt. Thereafter, only re-expand if nothing currently expanded is
  // still present (e.g. the expanded panel was just deleted) — otherwise
  // leave the user's expand/collapse choices alone.
  useEffect(() => {
    if (!members || members.length === 0) return;
    setExpandedIds((prev) => {
      if (members.some((m) => prev.has(m.id))) return prev;
      return new Set([members[0].id]);
    });
  }, [members]);

  // Full (re-)derivation: which recordings are in this chain, then their
  // details. Runs on focus.
  const loadChain = useCallback(async () => {
    if (!user || !rootId) {
      setScreenState('not-found');
      return;
    }
    const requestId = ++seqRef.current;
    if (!membersRef.current) setScreenState('loading');
    setLoadError(null);
    try {
      const rows = await fetchRecordings(user.id);
      if (requestId !== seqRef.current) return;
      const chains = buildChains(rows);
      const known = knownIdsRef.current;
      const chain =
        chains.find((c) => c.rootId === rootId) ??
        // `rootId` is any member of the chain (deep link, or the root shifted).
        chains.find((c) => c.members.some((m) => m.id === rootId)) ??
        // The root was deleted since we first loaded — find the chain that
        // still contains one of the members we already know about.
        (known.size > 0 ? chains.find((c) => c.members.some((m) => known.has(m.id))) : undefined);
      if (!chain || chain.members.length === 0) {
        setScreenState('not-found');
        return;
      }
      const details = await fetchRecordingDetailsByIds(chain.members.map((m) => m.id));
      if (requestId !== seqRef.current) return;
      const sorted = sortNewestFirst(details);
      knownIdsRef.current = new Set(sorted.map((m) => m.id));
      setMembers(sorted);
      setScreenState('loaded');
    } catch (err) {
      if (requestId !== seqRef.current) return;
      setLoadError(err instanceof Error ? err.message : 'Could not load this group.');
      setScreenState('error');
    }
  }, [user, rootId]);

  // Lighter refresh: re-pull just the known members' details (fresh statuses
  // after a regenerate, fresh `re_practice_of` after a middle-attempt delete).
  const refreshDetails = useCallback(async () => {
    const ids = [...knownIdsRef.current];
    if (ids.length === 0) return;
    const requestId = ++seqRef.current;
    try {
      const details = await fetchRecordingDetailsByIds(ids);
      if (requestId !== seqRef.current) return;
      const sorted = sortNewestFirst(details);
      knownIdsRef.current = new Set(sorted.map((m) => m.id));
      setMembers(sorted);
    } catch {
      // Transient — the focus refetch / manual retry covers a real failure.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadChain();
    }, [loadChain])
  );

  // Poll while any member is still non-terminal (a just-uploaded re-practice
  // attempt, or one regenerating) — same 1.5s cadence as the other screens.
  useFocusEffect(
    useCallback(() => {
      const interval = setInterval(() => {
        const rows = membersRef.current ?? [];
        if (rows.some((r) => !TERMINAL_STATUSES.has(r.status))) refreshDetails();
      }, 1500);
      return () => clearInterval(interval);
    }, [refreshDetails])
  );

  // Collapse-to-fewer navigation. Nothing left -> back to the List. Exactly
  // one attempt left -> that's a genuinely single recording now, so
  // `replace` into the normal `history/[id]` screen — keeping the UI
  // consistent with how every other single recording looks in History
  // (rather than showing a one-panel "chain"). `navigatedRef` guards against
  // firing twice before the screen unmounts.
  const navigatedRef = useRef(false);
  useEffect(() => {
    if (navigatedRef.current || screenState !== 'loaded' || members === null) return;
    if (members.length === 0) {
      navigatedRef.current = true;
      router.back();
    } else if (members.length === 1) {
      navigatedRef.current = true;
      router.replace({ pathname: '/history/[id]', params: { id: members[0].id } });
    }
  }, [members, screenState, router]);

  const memberById = useCallback(
    (id: string) => (members ?? []).find((m) => m.id === id) ?? null,
    [members]
  );

  const handleToggleFavorite = useCallback(async () => {
    if (!members || members.length === 0) return;
    const ref = favoriteReference(members);
    const nextFavorite = !ref.favorite;
    setMembers((prev) => prev?.map((m) => (m.id === ref.id ? { ...m, favorite: nextFavorite } : m)) ?? prev);
    setFavoritePending(true);
    try {
      await setFavorite(ref.id, nextFavorite);
    } catch {
      setMembers((prev) => prev?.map((m) => (m.id === ref.id ? { ...m, favorite: !nextFavorite } : m)) ?? prev);
    } finally {
      setFavoritePending(false);
    }
  }, [members]);

  const handleRegenerate = useCallback(
    async (id: string) => {
      addRegen(id);
      clearRegenError(id);
      try {
        await regenerateReport(id);
        // `process_recording()` flips status straight to `processing` — mirror
        // that so the poll picks the panel up immediately.
        setMembers((prev) => prev?.map((m) => (m.id === id ? { ...m, status: 'processing' } : m)) ?? prev);
      } catch (err) {
        setRegenError(id, err instanceof Error ? err.message : 'Could not regenerate.');
      } finally {
        removeRegen(id);
      }
    },
    [addRegen, clearRegenError, removeRegen, setRegenError]
  );

  const handleDeleteAudio = useCallback(
    async (id: string) => {
      addDelAudio(id);
      clearDelAudioError(id);
      try {
        await deleteRecordingAudio(id);
        setMembers(
          (prev) => prev?.map((m) => (m.id === id ? { ...m, audio_deleted: true, audio_path: null } : m)) ?? prev
        );
      } catch (err) {
        setDelAudioError(id, err instanceof Error ? err.message : 'Could not delete audio — try again.');
      } finally {
        removeDelAudio(id);
      }
    },
    [addDelAudio, clearDelAudioError, removeDelAudio, setDelAudioError]
  );

  const handleDownloadAudio = useCallback(
    async (id: string) => {
      const recording = memberById(id);
      if (!recording?.audio_path) {
        setDownloadError(id, 'No audio file to download.');
        return;
      }
      addDownload(id);
      clearDownloadError(id);
      try {
        await shareRecordingAudio(recording.audio_path);
      } catch (err) {
        setDownloadError(id, err instanceof Error ? err.message : 'Could not download audio — try again.');
      } finally {
        removeDownload(id);
      }
    },
    [addDownload, clearDownloadError, memberById, removeDownload, setDownloadError]
  );

  const handleDeleteRecording = useCallback(
    async (id: string) => {
      addDelRec(id);
      clearDelRecError(id);
      try {
        await deleteRecording(id);
        // Not optimistic elsewhere, but here we drop it from local state on
        // success so the accordion updates without waiting on a refetch; the
        // collapse-navigation effect handles 0/1 remaining. Then refresh the
        // survivors so their `re_practice_of` (possibly nulled by this delete)
        // is current for the favorite-reference calc.
        knownIdsRef.current = new Set([...knownIdsRef.current].filter((x) => x !== id));
        setMembers((prev) => prev?.filter((m) => m.id !== id) ?? prev);
        refreshDetails();
      } catch (err) {
        setDelRecError(id, err instanceof Error ? err.message : 'Could not delete recording — try again.');
      } finally {
        removeDelRec(id);
      }
    },
    [addDelRec, clearDelRecError, refreshDetails, removeDelRec, setDelRecError]
  );

  const handleSaveTitle = useCallback(
    async (id: string, nextTitle: string): Promise<boolean> => {
      addTitleSaving(id);
      clearTitleError(id);
      try {
        await updateRecordingTitle(id, nextTitle);
        setMembers((prev) => prev?.map((m) => (m.id === id ? { ...m, title: nextTitle } : m)) ?? prev);
        return true;
      } catch (err) {
        setTitleError(id, err instanceof Error ? err.message : 'Could not save title — try again.');
        return false;
      } finally {
        removeTitleSaving(id);
      }
    },
    [addTitleSaving, clearTitleError, removeTitleSaving, setTitleError]
  );

  const handleMenuAction = useCallback(
    (id: string, action: RecordingMenuAction) => {
      if (action === 're-practice') {
        const recording = memberById(id);
        if (recording) router.navigate({ pathname: '/', params: rePracticeNavParams(recording) });
      } else if (action === 'rename') {
        clearTitleError(id);
        addRenaming(id);
      } else if (action === 'download') handleDownloadAudio(id);
      else if (action === 'delete-audio') handleDeleteAudio(id);
      else if (action === 'delete-recording') handleDeleteRecording(id);
      else if (action === 'regenerate') handleRegenerate(id);
    },
    [
      addRenaming,
      clearTitleError,
      handleDeleteAudio,
      handleDeleteRecording,
      handleDownloadAudio,
      handleRegenerate,
      memberById,
      router,
    ]
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const showChain = screenState === 'loaded' && members !== null && members.length >= 1;
  const question = showChain ? chainQuestion(members) : '';
  const favoriteRef = showChain ? favoriteReference(members) : null;
  const modePill = showChain ? modePillColors(members[0].mode) : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <HeaderBackLink label="Back to History" onPress={() => router.back()} />

        {screenState === 'loading' && (
          <View style={styles.centerFill}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        )}

        {screenState === 'not-found' && (
          <View style={styles.centerFill}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              This group couldn&apos;t be found. Its recordings may have been removed.
            </ThemedText>
          </View>
        )}

        {screenState === 'error' && (
          <View style={styles.centerFill}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {loadError ?? 'Could not load this group.'}
            </ThemedText>
            <Pressable onPress={loadChain}>
              <ThemedText type="link">Retry</ThemedText>
            </Pressable>
          </View>
        )}

        {showChain && favoriteRef && modePill && (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.chainHeader}>
              <View style={styles.chainHeaderTop}>
                <ThemedText type="smallBold" numberOfLines={3} style={styles.chainQuestion}>
                  {question}
                </ThemedText>
                <FavoriteStar
                  favorite={favoriteRef.favorite}
                  onToggle={handleToggleFavorite}
                  disabled={favoritePending}
                />
              </View>
              <View style={styles.chainMeta}>
                <View style={[styles.modePillBox, { backgroundColor: modePill.backgroundColor }]}>
                  <ThemedText type="small" style={[styles.modePillText, { color: modePill.color }]}>
                    {formatMode(members[0].mode)}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {members.length} attempts
                </ThemedText>
              </View>
            </View>

            {members.map((recording) => (
              <ChainPanel
                key={recording.id}
                recording={recording}
                expanded={expandedIds.has(recording.id)}
                onToggle={() => toggleExpanded(recording.id)}
                onMenuAction={(action) => handleMenuAction(recording.id, action)}
                menuBusy={
                  regenIds.has(recording.id) ||
                  delAudioIds.has(recording.id) ||
                  downloadIds.has(recording.id) ||
                  delRecIds.has(recording.id)
                }
                titleEditing={renamingIds.has(recording.id)}
                onSaveTitle={(next) => handleSaveTitle(recording.id, next)}
                savingTitle={titleSavingIds.has(recording.id)}
                titleError={titleErrors[recording.id] ?? null}
                onEndTitleEdit={() => {
                  removeRenaming(recording.id);
                  clearTitleError(recording.id);
                }}
                onRegenerate={() => handleRegenerate(recording.id)}
                regenerating={regenIds.has(recording.id)}
                regenerateError={regenErrors[recording.id] ?? null}
                downloadError={downloadErrors[recording.id]}
                deleteAudioError={delAudioErrors[recording.id]}
                deleteRecordingError={delRecErrors[recording.id]}
              />
            ))}
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
    // Gutter on the sections below, not here — a padded ScrollView frame
    // clips card drop shadows. Same note as `history/index.tsx` / `[id].tsx`.
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  errorText: {
    color: '#e5484d',
  },
  scrollContent: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  chainHeader: {
    gap: Spacing.two,
  },
  chainHeaderTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  chainQuestion: {
    flex: 1,
    fontFamily: Theme.typography.fontFamily.bold,
    fontSize: 22,
    lineHeight: 28,
  },
  chainMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  modePillBox: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Theme.radius.pill,
  },
  modePillText: {
    fontSize: 12,
    lineHeight: 16,
  },
  // No padding / no `overflow: hidden` — the header and body supply their own
  // insets, and `overflow: hidden` would clip the Card's iOS drop shadow.
  panel: {},
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
  },
  panelHeaderText: {
    flex: 1,
    gap: Spacing.half,
  },
  panelBody: {
    gap: Theme.spacing.lg,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    paddingTop: Spacing.one,
  },
  panelTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  panelMenu: {
    // nudge the 3-dot glyph onto the title's first-line optical centre
    marginTop: Spacing.half,
  },
  panelErrors: {
    gap: Spacing.one,
  },
  pressed: {
    opacity: 0.7,
  },
});
