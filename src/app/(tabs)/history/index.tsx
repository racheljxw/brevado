import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { Card } from '@/components/card';
import { FavoriteStar } from '@/components/favorite-star';
import { RecordingActionsMenu, type RecordingMenuAction } from '@/components/recording-actions-menu';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, NotoSans, Spacing, Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteRecording, deleteRecordingAudio, regenerateReport } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { dayKeyToDate, formatRecordedAt, localDayKey as dayKey } from '@/lib/format-time';
import { formatMode, modePillColors } from '@/lib/modes';
import { TERMINAL_STATUSES } from '@/lib/recording-status';
import { fetchRecordings, setFavorite, shareRecordingAudio, type RecordingRow } from '@/lib/recordings';

// Phase 3 Step 1: rows are now tappable, pushing `history/[id]` for the full
// detail view (transcript/feedback/metrics/playback). `onPress` is threaded
// through rather than reading `useRouter()` in here so this stays a plain
// presentational component.
//
// v2 Epic D Part 3 — the card is restyled to the design screenshots:
//   - the recording `title` (Part 1/2) as the bold heading, with the
//     favorite star on the same line. NULL title -> a muted "Untitled
//     recording" fallback (see the CLAUDE.md "Recording titles" note on why
//     that over a truncated question).
//   - the question/prompt as a secondary `textSecondary` line; "No prompt"
//     (not blank) for miscellaneous, which has no question.
//   - a colour-coded mode pill (`modeInterview`/`modeStory`/
//     `modeMiscellaneous` bg + the matching `*Text` label tokens) on the
//     meta row, with the date/time right-aligned opposite it. No status
//     badge — the failed-row "Regenerate report" action keys off
//     `recording.status` directly, not a visible badge.
//
// v2 Epic D Part 4 — the old inline row of icon actions (download / delete
// audio) plus the inline "Regenerate report" text action are gone,
// consolidated into a single `RecordingActionsMenu` (the "3-dot" menu) on
// the heading line next to the favorite star, which also carries the new
// "Delete recording" action (removes the whole row + its audio). The star
// deliberately stays its own always-visible icon, not a menu item.
// The heading shown for a recording with a NULL `title` (a legacy row from
// before Epic D Part 1, or one where generation returned nothing usable).
// Pulled out as a constant so the client-side search below matches against
// exactly what the card displays — searching "untitled" surfaces these rows.
const UNTITLED_LABEL = 'Untitled recording';

// `modePillColors` moved to `src/lib/modes.ts` in v2 Epic D Part 7 — the
// History detail screen's restyle needed the identical pill, so both
// screens now share one definition.

function RecordingListItem({
  recording,
  onPress,
  onToggleFavorite,
  favoritePending,
  onRegenerate,
  regenerating,
  regenerateError,
  onDeleteAudio,
  deletingAudio,
  deleteAudioError,
  onDeleteRecording,
  deletingRecording,
  deleteRecordingError,
  onDownloadAudio,
  downloadingAudio,
  downloadAudioError,
}: {
  recording: RecordingRow;
  onPress: () => void;
  onToggleFavorite: () => void;
  favoritePending: boolean;
  onRegenerate: () => void;
  regenerating: boolean;
  regenerateError?: string;
  onDeleteAudio: () => void;
  deletingAudio: boolean;
  deleteAudioError?: string;
  onDeleteRecording: () => void;
  deletingRecording: boolean;
  deleteRecordingError?: string;
  onDownloadAudio: () => void;
  downloadingAudio: boolean;
  downloadAudioError?: string;
}) {
  const modePill = modePillColors(recording.mode);

  function handleMenuAction(action: RecordingMenuAction) {
    if (action === 'download') onDownloadAudio();
    else if (action === 'delete-audio') onDeleteAudio();
    else if (action === 'delete-recording') onDeleteRecording();
    else if (action === 'regenerate') onRegenerate();
  }

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <Card style={styles.row}>
        {/* Heading: the recording title (or a muted fallback for a NULL
            title — a legacy row, or one where generation returned nothing),
            with the favorite star and the 3-dot actions menu sharing the
            line. */}
        <View style={styles.titleRow}>
          <ThemedText
            type="smallBold"
            themeColor={recording.title ? 'text' : 'textSecondary'}
            numberOfLines={2}
            style={[styles.cardTitle, styles.titleFlex]}>
            {recording.title ?? UNTITLED_LABEL}
          </ThemedText>
          <FavoriteStar favorite={recording.favorite} onToggle={onToggleFavorite} disabled={favoritePending} size={20} />
          <RecordingActionsMenu
            canDownload={!recording.audio_deleted && !!recording.audio_path}
            canDeleteAudio={!recording.audio_deleted}
            canRegenerate={recording.status === 'failed'}
            busy={downloadingAudio || deletingAudio || deletingRecording || regenerating}
            onSelect={handleMenuAction}
          />
        </View>

        {/* Phase 4 Step 5 exit-checkpoint review: the question/topic (real as
            of Phase 4 Steps 3-4 for interview/story; still null for
            miscellaneous) is meaningful context when scanning past sessions,
            so it gets a one-line, truncated preview here — the detail screen
            shows it in full. Epic D Part 3: miscellaneous (no question) shows
            a clear "No prompt" rather than blank space. */}
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.promptLine}>
          {recording.question ?? 'No prompt'}
        </ThemedText>

        {/* Meta row: the colour-coded mode pill on the left, the date/time
            right-aligned opposite it. */}
        <View style={styles.metaRow}>
          <View style={[styles.modePill, { backgroundColor: modePill.backgroundColor }]}>
            <ThemedText type="small" style={[styles.modePillText, { color: modePill.color }]}>
              {formatMode(recording.mode)}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.metaDate}>
            {formatRecordedAt(recording.created_at)}
          </ThemedText>
        </View>

        {/* Per-row action outcomes. The actions themselves (download / delete
            audio / delete recording / regenerate) live in the 3-dot
            `RecordingActionsMenu` on the heading line as of Part 4; only
            their error messages surface down here. */}
        {downloadAudioError && (
          <ThemedText type="small" style={styles.actionError}>
            {downloadAudioError}
          </ThemedText>
        )}
        {deleteAudioError && (
          <ThemedText type="small" style={styles.actionError}>
            {deleteAudioError}
          </ThemedText>
        )}
        {deleteRecordingError && (
          <ThemedText type="small" style={styles.actionError}>
            {deleteRecordingError}
          </ThemedText>
        )}
        {regenerateError && (
          <ThemedText type="small" style={styles.actionError}>
            {regenerateError}
          </ThemedText>
        )}
      </Card>
    </Pressable>
  );
}

// v2 Epic D Part 5 — the search bar + Calendar/List toggle above the list.
//
// Search is a purely CLIENT-SIDE substring filter over the already-loaded
// `recordings` (no new backend query — a deliberate decision, the list is
// capped at 30 rows/user so there's nothing to paginate or server-filter).
// It matches, case-insensitively, against the recording `title` (or the
// "Untitled recording" fallback text when the title is NULL, since that's
// what the card actually shows) and the `question`/prompt text.
//
// The toggle is a minimalist underline-style tab pair. "List" is the
// existing restyled-card list. "Calendar" is a real month grid as of Epic D
// Part 6 — see `MonthCalendar` below.
//
// Typing a non-empty search term while on Calendar auto-switches to List so
// the results are actually visible. Clearing the search does NOT switch
// back — that would feel like the UI fighting the user; they stay on
// whichever view they last chose.
//
// v2 Epic D Part 6 — the real Calendar view. A standard 7-column month grid,
// current month by default, with prev/next month navigation (next is capped
// at the current month — there can be no future recordings). Each day that
// has at least one recording gets a dot; the counts are grouped CLIENT-SIDE
// from the already-loaded `recordings` list by the LOCAL date portion of
// `created_at` (`dayKey`) — no new backend query, same data source as List
// and search.
//
// Tapping a day WITH recordings switches to List view filtered to that date
// (`dayFilter`) — reusing Part 3's card styling and Part 4's menu rather
// than building a second list rendering. Tapping the already-selected day
// again clears the filter. Tapping a day with NO recordings is a no-op
// beyond a subtle "No recordings on …" line under the grid.
//
// Search + day filter are treated as MUTUALLY EXCLUSIVE: tapping a day
// clears any active search term ("everything from this day" is a singular
// intent a leftover search would confusingly narrow), and typing a search
// term clears any active day filter. A "Showing {date}" chip above the
// filtered list is the explicit way back to viewing everything.
type HistoryView = 'calendar' | 'list';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// `dayKey` (the local-date `YYYY-MM-DD` grouping key) and `dayKeyToDate` now
// live in `src/lib/format-time.ts` (`localDayKey` / `dayKeyToDate`) so v3's
// Streaks aggregation groups recordings by the exact same rule — see the
// note there. Imported above as `dayKey` to keep this file's call sites
// unchanged.

// "Mon, Aug 25" — for the day-filter chip and the empty-day notice.
function formatDayLabel(key: string): string {
  return dayKeyToDate(key).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function matchesSearch(recording: RecordingRow, query: string): boolean {
  const title = (recording.title ?? UNTITLED_LABEL).toLowerCase();
  const question = (recording.question ?? '').toLowerCase();
  return title.includes(query) || question.includes(query);
}

function SearchBar({ value, onChangeText }: { value: string; onChangeText: (next: string) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.searchBar}>
      <SymbolView name="magnifyingglass" size={16} tintColor={theme.textSecondary} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder="Search by title or prompt"
        // `#56453D80` = `Theme.colors.textSecondary` at 50% opacity — the
        // one placeholder-text treatment used app-wide (matches the custom-
        // question input in `index.tsx` and the title editor in
        // `history/[id].tsx`), rather than the full-opacity secondary text
        // colour this used to read.
        placeholderTextColor="#56453D80"
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel="Search recordings"
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear search">
          <SymbolView name="xmark.circle.fill" size={16} tintColor={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

function ViewToggle({ view, onChange }: { view: HistoryView; onChange: (next: HistoryView) => void }) {
  const tabs: { key: HistoryView; label: string }[] = [
    { key: 'calendar', label: 'Calendar' },
    { key: 'list', label: 'List' },
  ];
  return (
    <View style={styles.toggleRow}>
      {tabs.map((tab) => {
        const active = view === tab.key;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={[styles.toggleTab, active && styles.toggleTabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}>
            <ThemedText
              type={active ? 'smallBold' : 'small'}
              themeColor={active ? 'text' : 'textSecondary'}
              style={styles.toggleLabel}>
              {tab.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function MonthCalendar({
  year,
  month,
  countsByDay,
  selectedKey,
  canGoNext,
  onChangeMonth,
  onSelectDay,
}: {
  year: number;
  month: number; // 0-11
  countsByDay: Map<string, number>;
  selectedKey: string | null;
  canGoNext: boolean;
  onChangeMonth: (delta: number) => void;
  onSelectDay: (key: string, count: number) => void;
}) {
  const theme = useTheme();
  const todayKey = dayKey(new Date());

  const firstWeekday = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  // Leading blanks for the first week, then the day numbers, padded out to a
  // whole number of weeks so the grid stays rectangular.
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View>
      <View style={styles.calendarHeader}>
        <Pressable
          onPress={() => onChangeMonth(-1)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Previous month">
          <SymbolView name="chevron.left" size={20} tintColor={theme.text} />
        </Pressable>
        <ThemedText type="smallBold">{monthLabel}</ThemedText>
        <Pressable
          onPress={() => canGoNext && onChangeMonth(1)}
          disabled={!canGoNext}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Next month">
          <SymbolView
            name="chevron.right"
            size={20}
            tintColor={canGoNext ? theme.text : Theme.colors.border}
          />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((label, i) => (
          <View key={i} style={styles.weekdayCell}>
            <ThemedText type="small" themeColor="textSecondary">
              {label}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={i} style={styles.dayCell} />;
          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const count = countsByDay.get(key) ?? 0;
          const isSelected = selectedKey === key;
          const isToday = todayKey === key;
          return (
            <Pressable
              key={i}
              style={styles.dayCell}
              onPress={() => onSelectDay(key, count)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${formatDayLabel(key)}, ${
                count > 0 ? `${count} recording${count === 1 ? '' : 's'}` : 'no recordings'
              }`}>
              {/* `dayInner` is a fixed-size box (constant regardless of
                  today/selected) purely so `dotSlot` below always sits the
                  same distance from the top of the cell — the "today" circle
                  is smaller than the default/selected one, but that sizing
                  lives on the *nested* `dayCircle`, not on this outer box,
                  so it can never shift the dot's vertical position (a bug
                  the previous version had: shrinking `dayInner` itself for
                  "today" pushed its `dotSlot` up relative to every other
                  day's). */}
              <View style={styles.dayInner}>
                <View
                  style={[
                    styles.dayCircle,
                    isToday && !isSelected && styles.dayTodayCircle,
                    isSelected && styles.daySelectedCircle,
                  ]}>
                  <ThemedText
                    type={count > 0 ? 'smallBold' : 'small'}
                    themeColor={count > 0 ? 'text' : 'textSecondary'}
                    style={
                      isSelected ? styles.daySelectedText : isToday ? styles.dayTodayText : undefined
                    }>
                    {day}
                  </ThemedText>
                </View>
              </View>
              <View style={styles.dotSlot}>{count > 0 && <View style={styles.dot} />}</View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function HistoryScreen() {
  const { user } = useAuth();
  const theme = useTheme();
  const router = useRouter();

  // null = not fetched yet, distinct from "fetched and empty".
  const [recordings, setRecordings] = useState<RecordingRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // v2 Epic D Part 5 — client-side search + the Calendar/List view toggle.
  // `view` defaults to List (the functional view; Calendar is a placeholder
  // this step). `search` filters the list client-side — see `matchesSearch`.
  const [search, setSearch] = useState('');
  const [view, setView] = useState<HistoryView>('list');

  // v2 Epic D Part 6 — Calendar state. `calendar` is the month currently
  // shown in the grid (defaults to the current month). `dayFilter` is the
  // selected day's `dayKey`, which — when set — narrows the List view to
  // that day. `emptyDayNotice` is the `dayKey` of a tapped day that had no
  // recordings, shown as a subtle line under the grid.
  const [calendar, setCalendar] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [emptyDayNotice, setEmptyDayNotice] = useState<string | null>(null);

  const now = new Date();
  const canGoNext =
    calendar.year < now.getFullYear() ||
    (calendar.year === now.getFullYear() && calendar.month < now.getMonth());

  const changeMonth = useCallback((delta: number) => {
    setCalendar((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
    setEmptyDayNotice(null);
  }, []);

  // Tapping a day: no recordings -> just the subtle notice; the
  // already-selected day -> clear the filter (toggle off); otherwise -> set
  // the day filter, clear any active search (mutually exclusive — see the
  // comment block above `MonthCalendar`), and switch to List so the filtered
  // cards are visible.
  const handleSelectDay = useCallback(
    (key: string, count: number) => {
      if (count === 0) {
        setEmptyDayNotice(key);
        return;
      }
      setEmptyDayNotice(null);
      setDayFilter((current) => (current === key ? null : key));
      setSearch('');
      setView('list');
    },
    []
  );

  const handleChangeView = useCallback((next: HistoryView) => {
    setView(next);
    setEmptyDayNotice(null);
  }, []);

  // Typing a search term jumps to List so the filtered results are visible
  // and clears any active day filter (mutually exclusive); clearing the
  // search deliberately does NOT jump back or restore a day filter.
  const handleSearchChange = useCallback((next: string) => {
    setSearch(next);
    if (next.trim().length > 0) {
      setDayFilter(null);
      setEmptyDayNotice(null);
      setView((current) => (current === 'calendar' ? 'list' : current));
    }
  }, []);

  // Phase 3 Step 2: per-row "Regenerate report" state — keyed by recording
  // id since any number of failed rows could be regenerated independently
  // (each gets its own in-flight spinner / error message, not a single
  // list-wide one).
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [regenerateErrors, setRegenerateErrors] = useState<Record<string, string>>({});

  // Phase 3 Step 4 — per-row favorite-toggle in-flight state, same shape as
  // the regenerate state above (independent per row, keyed by id).
  const [favoritingIds, setFavoritingIds] = useState<Set<string>>(new Set());

  // Phase 3 Step 5 — per-row audio-delete in-flight/error state, same shape
  // as the regenerate state above.
  const [deletingAudioIds, setDeletingAudioIds] = useState<Set<string>>(new Set());
  const [deleteAudioErrors, setDeleteAudioErrors] = useState<Record<string, string>>({});

  // Phase 3 Step 6 — per-row audio-download in-flight/error state, same
  // shape as delete/regenerate above (independent per row, keyed by id).
  const [downloadingAudioIds, setDownloadingAudioIds] = useState<Set<string>>(new Set());
  const [downloadAudioErrors, setDownloadAudioErrors] = useState<Record<string, string>>({});

  // v2 Epic D Part 4 — per-row "delete recording" (whole row + audio)
  // in-flight/error state, same shape as the audio-delete state above.
  const [deletingRecordingIds, setDeletingRecordingIds] = useState<Set<string>>(new Set());
  const [deleteRecordingErrors, setDeleteRecordingErrors] = useState<Record<string, string>>({});

  // Step 7: monotonically-increasing id for each `load()` call, so a
  // response can tell whether a *newer* request has been issued since it
  // went out. The interval below can have more than one `fetchRecordings()`
  // in flight at once (e.g. a manual pull-to-refresh landing mid-poll), and
  // network timing doesn't guarantee they resolve in the order they were
  // sent — without this, a slower, older request resolving after a faster,
  // newer one briefly overwrites fresh state with stale status (the
  // flashing bug flagged in Step 3's review). Only the response matching the
  // most recently *issued* request is applied; anything else is discarded
  // as stale. A ref, not state, since bumping it should never itself
  // trigger a re-render.
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    const requestId = ++requestSeqRef.current;
    setError(null);
    try {
      const rows = await fetchRecordings(user.id);
      if (requestId !== requestSeqRef.current) return; // a newer request has since been issued — discard
      setRecordings(rows);
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not load your history.');
    } finally {
      if (requestId === requestSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [user]);

  // Refetch every time this tab gains focus (e.g. arriving here right after
  // an upload from the Home tab, or backing out of a detail screen), not
  // just on first mount — a plain mount effect wouldn't see recordings
  // created since the screen last loaded, since tabs stay mounted in the
  // background rather than remounting on switch.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // A ref (not state) so the poll interval below can read the latest list
  // on every tick without needing to be torn down and recreated each time
  // `recordings` changes.
  const recordingsRef = useRef<RecordingRow[] | null>(null);
  useEffect(() => {
    recordingsRef.current = recordings;
  }, [recordings]);

  // Phase 2 Step 7 (was a flat "poll while anything's in flight" loop since
  // Step 2): refetch on an interval while any row is still pending/
  // processing, so status visibly moves pending -> processing -> done
  // without a manual pull-to-refresh. Only runs while this tab is focused.
  //
  // Per-row stop condition: fetching is one query for the whole list, not
  // one request per row, so there's no separate "stop polling this row"
  // switch to build — the granularity that matters is whether *any* row is
  // still non-terminal, which is what `stillInFlight` checks. Once every
  // row has reached `done`/`failed` (TERMINAL_STATUSES), this stops firing
  // `load()` at all. A finished row riding along in an in-flight tick's
  // response costs nothing extra (same one query either way), so there's no
  // benefit to scoping the query itself down to just the non-terminal rows
  // at this app's scale (max 30 rows/user) — that'd be added complexity for
  // no real savings.
  useFocusEffect(
    useCallback(() => {
      const interval = setInterval(() => {
        const rows = recordingsRef.current ?? [];
        const stillInFlight = rows.some((row) => !TERMINAL_STATUSES.has(row.status));
        if (stillInFlight) {
          load();
        }
      }, 1500);
      return () => clearInterval(interval);
    }, [load])
  );

  function handleRefresh() {
    setRefreshing(true);
    load();
  }

  async function handleRegenerate(id: string) {
    setRegeneratingIds((prev) => new Set(prev).add(id));
    setRegenerateErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await regenerateReport(id);
      // Optimistically flip this row to 'processing' (what
      // `process_recording()` sets as its first step regardless of entry
      // point — see `src/lib/api.ts`) so it reads as back in progress
      // immediately and so the polling effect above — which already
      // refetches whenever *any* row is non-terminal — picks it up on its
      // very next tick instead of waiting on a stale 'failed' row to be
      // overwritten by a slower background update.
      setRecordings((prev) => prev?.map((row) => (row.id === id ? { ...row, status: 'processing' } : row)) ?? prev);
    } catch (err) {
      setRegenerateErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Could not regenerate.',
      }));
    } finally {
      setRegeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // Phase 3 Step 4: optimistic, responsive favorite toggle — flip local
  // state immediately (no waiting on a refetch/poll tick), then persist via
  // `setFavorite` (direct Supabase update, see src/lib/recordings.ts). On
  // failure, revert the optimistic flip rather than leaving the UI showing
  // a state that didn't actually save.
  async function handleToggleFavorite(id: string, nextFavorite: boolean) {
    setRecordings((prev) => prev?.map((row) => (row.id === id ? { ...row, favorite: nextFavorite } : row)) ?? prev);
    setFavoritingIds((prev) => new Set(prev).add(id));
    try {
      await setFavorite(id, nextFavorite);
    } catch {
      // Revert — the update didn't actually persist.
      setRecordings((prev) => prev?.map((row) => (row.id === id ? { ...row, favorite: !nextFavorite } : row)) ?? prev);
    } finally {
      setFavoritingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // Phase 3 Step 5 — no confirmation dialog before this fires, per an
  // explicit product decision (see docs/CLAUDE.md's History section):
  // tapping delete calls the backend immediately, no "are you sure?" step.
  // Unlike the favorite toggle above, this is NOT optimistic — local state
  // only flips to audio_deleted once the backend confirms the delete
  // actually completed (Storage object gone + row updated; see
  // `delete_audio` in `backend/app/routers/recordings.py`). Flipping it
  // eagerly and reverting on failure would risk briefly showing "audio
  // deleted" for audio that's still there, or the reverse.
  async function handleDeleteAudio(id: string) {
    setDeletingAudioIds((prev) => new Set(prev).add(id));
    setDeleteAudioErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await deleteRecordingAudio(id);
      setRecordings((prev) => prev?.map((row) => (row.id === id ? { ...row, audio_deleted: true } : row)) ?? prev);
    } catch (err) {
      setDeleteAudioErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Could not delete audio — try again.',
      }));
    } finally {
      setDeletingAudioIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // Phase 3 Step 6 — downloads a recording's audio and opens the native
  // share sheet (see `shareRecordingAudio` in src/lib/recordings.ts for the
  // full flow and why a cancelled share sheet isn't treated as a failure
  // here — the promise resolves the same way on cancel as on a completed
  // share, so there's nothing to special-case in this handler). Guards on
  // `audioPath` even though the button is only rendered when one exists
  // (`RecordingListItem` above) — defensive, matching how the rest of this
  // file treats a theoretically-missing audio_path.
  async function handleDownloadAudio(id: string, audioPath: string | null) {
    if (!audioPath) {
      setDownloadAudioErrors((prev) => ({ ...prev, [id]: 'No audio file to download.' }));
      return;
    }
    setDownloadingAudioIds((prev) => new Set(prev).add(id));
    setDownloadAudioErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await shareRecordingAudio(audioPath);
    } catch (err) {
      setDownloadAudioErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Could not download audio — try again.',
      }));
    } finally {
      setDownloadingAudioIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // v2 Epic D Part 4 — permanently delete a whole recording (row + audio).
  // Gated behind a confirmation dialog in `RecordingActionsMenu` before it
  // reaches here. Not optimistic, matching `handleDeleteAudio`: the row is
  // only dropped from local state once the backend confirms the delete
  // landed (see `deleteRecording` in src/lib/api.ts / `delete_recording` in
  // the backend router). The list refetches on focus anyway, so a slot
  // freed under `MAX_RECORDINGS_PER_USER` reflects on the next Record-tab
  // visit — the deleted row simply no longer exists to be counted.
  async function handleDeleteRecording(id: string) {
    setDeletingRecordingIds((prev) => new Set(prev).add(id));
    setDeleteRecordingErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await deleteRecording(id);
      setRecordings((prev) => prev?.filter((row) => row.id !== id) ?? prev);
    } catch (err) {
      setDeleteRecordingErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Could not delete recording — try again.',
      }));
    } finally {
      setDeletingRecordingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const query = search.trim().toLowerCase();
  const filteredRecordings = useMemo(() => {
    if (!recordings) return [];
    let rows = recordings;
    // Day filter and search are mutually exclusive in the UI, but applying
    // both here is harmless and keeps this robust if that ever changes.
    if (dayFilter) rows = rows.filter((row) => dayKey(new Date(row.created_at)) === dayFilter);
    if (query) rows = rows.filter((row) => matchesSearch(row, query));
    return rows;
  }, [recordings, query, dayFilter]);

  // v2 Epic D Part 6 — recording counts grouped by local calendar day, for
  // the month grid's per-day dots. Computed from the full already-loaded
  // list (not the filtered one) so the dots always reflect every recording.
  const recordingsByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of recordings ?? []) {
      const key = dayKey(new Date(row.created_at));
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [recordings]);

  const hasRecordings = !!recordings && recordings.length > 0;
  const showInitialLoading = loading && recordings === null;
  // Error on the very first load (nothing to fall back to) — show just the
  // error card, no search bar / toggle / list.
  const showErrorOnly = !!error && !hasRecordings && !showInitialLoading;
  const showEmpty = !loading && !error && recordings?.length === 0;
  // A search that matched nothing — distinct from "no recordings at all".
  const showNoResults = view === 'list' && hasRecordings && query.length > 0 && filteredRecordings.length === 0;
  // A day filter that now matches nothing (e.g. the day's last recording was
  // just deleted) — the "Showing {date}" chip is still the way back.
  const showEmptyDayFilter =
    view === 'list' && hasRecordings && !!dayFilter && query.length === 0 && filteredRecordings.length === 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <AppHeader />

        {error && (
          <Card style={styles.errorCard}>
            <ThemedText type="small">{error}</ThemedText>
            <Pressable onPress={load}>
              <ThemedText type="link">Retry</ThemedText>
            </Pressable>
          </Card>
        )}

        {showInitialLoading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : showErrorOnly ? null : showEmpty ? (
          <View style={styles.centerFill}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
              No recordings yet. Head to the Record tab and record your first practice session.
            </ThemedText>
          </View>
        ) : (
          <>
            <SearchBar value={search} onChangeText={handleSearchChange} />
            <ViewToggle view={view} onChange={handleChangeView} />
            {view === 'calendar' ? (
              <View style={styles.calendarScreen}>
                <MonthCalendar
                  year={calendar.year}
                  month={calendar.month}
                  countsByDay={recordingsByDay}
                  selectedKey={dayFilter}
                  canGoNext={canGoNext}
                  onChangeMonth={changeMonth}
                  onSelectDay={handleSelectDay}
                />
                {emptyDayNotice && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.dayNotice}>
                    No recordings on {formatDayLabel(emptyDayNotice)}.
                  </ThemedText>
                )}
              </View>
            ) : (
              <>
                {dayFilter && (
                  <Pressable
                    onPress={() => setDayFilter(null)}
                    style={styles.dayFilterChip}
                    accessibilityRole="button"
                    accessibilityLabel="Show all recordings">
                    <ThemedText type="small" themeColor="text">
                      Showing {formatDayLabel(dayFilter)}
                    </ThemedText>
                    <SymbolView name="xmark.circle.fill" size={16} tintColor={theme.textSecondary} />
                  </Pressable>
                )}
                {showNoResults || showEmptyDayFilter ? (
                  <View style={styles.centerFill}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                      {showEmptyDayFilter
                        ? `No recordings on ${formatDayLabel(dayFilter!)}.`
                        : `No recordings match “${search.trim()}”. Try a different search.`}
                    </ThemedText>
                  </View>
                ) : (
                  <FlatList
                    style={styles.list}
                    data={filteredRecordings}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                      <RecordingListItem
                        recording={item}
                        onPress={() => router.push({ pathname: '/history/[id]', params: { id: item.id } })}
                        onToggleFavorite={() => handleToggleFavorite(item.id, !item.favorite)}
                        favoritePending={favoritingIds.has(item.id)}
                        onRegenerate={() => handleRegenerate(item.id)}
                        regenerating={regeneratingIds.has(item.id)}
                        regenerateError={regenerateErrors[item.id]}
                        onDeleteAudio={() => handleDeleteAudio(item.id)}
                        deletingAudio={deletingAudioIds.has(item.id)}
                        deleteAudioError={deleteAudioErrors[item.id]}
                        onDeleteRecording={() => handleDeleteRecording(item.id)}
                        deletingRecording={deletingRecordingIds.has(item.id)}
                        deleteRecordingError={deleteRecordingErrors[item.id]}
                        onDownloadAudio={() => handleDownloadAudio(item.id, item.audio_path)}
                        downloadingAudio={downloadingAudioIds.has(item.id)}
                        downloadAudioError={downloadAudioErrors[item.id]}
                      />
                    )}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                      <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        tintColor={theme.textSecondary}
                      />
                    }
                  />
                )}
              </>
            )}
          </>
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
    // NB: the horizontal gutter lives on the individual sections below
    // (`headerRow`, `centerFill`, `errorCard`, and the FlatList's
    // `listContent`), NOT here — a ScrollView/FlatList clips its content to
    // its own frame, so if this container were padded the card drop shadows
    // would be sliced off at the list's left/right edges. Keeping the list
    // full-bleed and insetting only its contentContainer lets the shadow
    // bleed into the gutter.
  },
  // `AppHeader` (brevado logo + profile icon) owns its own padding — see
  // src/components/app-header.tsx. This screen's own "History" heading
  // renders as its own line right below it, not sharing that row, so the
  // header row itself is identical across Record/History/Streaks.
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  emptyText: {
    textAlign: 'center',
  },
  // v2 Epic D Part 5 — pill-shaped search bar (card fill + hairline border),
  // sitting in the same horizontal gutter as the header and list.
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Theme.colors.card,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Platform.OS === 'ios' ? Spacing.two : Spacing.one,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
  },
  searchInput: {
    flex: 1,
    padding: 0,
    fontFamily: NotoSans.regular,
    fontSize: 16,
    lineHeight: 20,
    color: Theme.colors.textPrimary,
  },
  // Minimalist underline-style tabs — active tab carries a 2px bottom
  // border sitting on the row's hairline divider.
  toggleRow: {
    flexDirection: 'row',
    gap: Spacing.four,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.border,
  },
  toggleTab: {
    paddingVertical: Spacing.two,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
  },
  toggleTabActive: {
    borderBottomColor: Theme.colors.textPrimary,
  },
  toggleLabel: {
    fontSize: 16,
    lineHeight: 22,
  },
  list: {
    // fill the space left under the header / search bar / toggle so the
    // list scrolls within its own frame
    flex: 1,
  },
  // v2 Epic D Part 6 — Calendar view.
  calendarScreen: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: Spacing.one,
  },
  weekdayCell: {
    width: '14.2857%',
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.2857%',
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  // Fixed-size box — constant regardless of today/selected — so `dotSlot`
  // below always sits the same distance from the cell's top. See the JSX
  // comment at the call site for the bug this fixes.
  dayInner: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The actual visible circle, nested inside `dayInner` — its size is what
  // varies (today vs. selected vs. neither), never `dayInner`'s.
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: Theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Today's cell: a smaller, filled circle (brown bg + off-white number) so
  // it stands out at a glance without competing with a selected day's own
  // (larger) accent fill — `isSelected` takes precedence when a day is both
  // today and selected (see the `isToday && !isSelected` check at the call
  // site).
  dayTodayCircle: {
    width: 26,
    height: 26,
    backgroundColor: Theme.colors.accent,
  },
  dayTodayText: {
    color: Theme.colors.onAccent,
  },
  daySelectedCircle: {
    backgroundColor: Theme.colors.accent,
  },
  daySelectedText: {
    color: Theme.colors.onAccent,
  },
  dotSlot: {
    height: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: Theme.radius.pill,
    backgroundColor: Theme.colors.accent,
  },
  dayNotice: {
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  // The "Showing {date}" chip above a day-filtered list — the explicit way
  // back to viewing everything.
  dayFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    alignSelf: 'center',
    backgroundColor: Theme.colors.card,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
  },
  listContent: {
    // generous vertical padding so the first/last card's drop shadow has
    // room to blur instead of being clipped at the scroll frame edge
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  row: {
    // Card supplies the fill (Theme.colors.card), inset border, radius
    // (Theme.radius.card) and shadow — this just adds the interior layout.
    gap: Spacing.two,
    padding: Spacing.three,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  titleFlex: {
    // grow to fill the row so the star + 3-dot menu are pinned to the right
    // edge as a fixed cluster, regardless of how short the title is
    flex: 1,
  },
  cardTitle: {
    // "smallBold" (Noto Sans bold) bumped up to a list-card heading size —
    // smaller than the detail screen's `subtitle`, larger than body.
    fontSize: 17,
    lineHeight: 22,
  },
  promptLine: {
    // pull the secondary line up snug under the heading
    marginTop: -Spacing.one,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  modePill: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Theme.radius.pill,
  },
  modePillText: {
    fontSize: 12,
    lineHeight: 16,
  },
  metaDate: {
    flexShrink: 1,
    textAlign: 'right',
  },
  actionError: {
    color: '#e5484d',
  },
  errorCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
});
