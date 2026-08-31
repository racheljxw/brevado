import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { Card } from '@/components/card';
import { FavoriteStar } from '@/components/favorite-star';
import { RecordingActionsMenu, type RecordingMenuAction } from '@/components/recording-actions-menu';
import { ScrollFade } from '@/components/scroll-fade';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TitleSection } from '@/components/title-section';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, NotoSans, Spacing, Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteRecording, deleteRecordingAudio, regenerateReport } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { dayKeyToDate, formatRecordedAt, localDayKey as dayKey } from '@/lib/format-time';
import { formatMode, modePillColors } from '@/lib/modes';
import { TERMINAL_STATUSES } from '@/lib/recording-status';
import {
  buildChains,
  chainFavoriteReference,
  chainQuestion,
  type RePracticeChain,
} from '@/lib/re-practice-chains';
import {
  canRePracticeRecording,
  fetchRecordings,
  rePracticeNavParams,
  setFavorite,
  shareRecordingAudio,
  updateRecordingTitle,
  type RecordingMode,
  type RecordingRow,
} from '@/lib/recordings';

// One recording's list card. `onPress` (pushes `history/[id]`) is threaded
// through rather than reading `useRouter()` in here so this stays a plain
// presentational component. Layout: the recording `title` as the bold
// heading (a muted "Untitled recording" fallback for a NULL title), the
// question/prompt as a secondary line ("No prompt" for miscellaneous), a
// colour-coded mode pill and the date on the meta row, and the favorite star
// + 3-dot actions menu on the heading line.
//
// The NULL-title heading text is a constant so the client-side search below
// matches exactly what the card displays — searching "untitled" surfaces
// those rows.
const UNTITLED_LABEL = 'Untitled recording';

function RecordingListItem({
  recording,
  onPress,
  onToggleFavorite,
  favoritePending,
  renaming,
  onRename,
  onEndRename,
  onSaveTitle,
  savingTitle,
  titleError,
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
  onRePractice,
}: {
  recording: RecordingRow;
  onPress: () => void;
  onRePractice: () => void;
  onToggleFavorite: () => void;
  favoritePending: boolean;
  renaming: boolean;
  onRename: () => void;
  onEndRename: () => void;
  onSaveTitle: (next: string) => Promise<boolean>;
  savingTitle: boolean;
  titleError?: string;
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
    if (action === 're-practice') onRePractice();
    else if (action === 'rename') onRename();
    else if (action === 'download') onDownloadAudio();
    else if (action === 'delete-audio') onDeleteAudio();
    else if (action === 'delete-recording') onDeleteRecording();
    else if (action === 'regenerate') onRegenerate();
  }

  return (
    <Pressable
      onPress={renaming ? undefined : onPress}
      style={({ pressed }) => pressed && !renaming && styles.pressed}>
      <Card style={styles.row}>
        {/* Heading: the title (a `<TitleSection>`, shared with the detail
            screens, so "Rename title" from the 3-dot menu opens an inline
            editor right here), with the favorite star and 3-dot menu sharing
            the line. */}
        <View style={styles.titleRow}>
          <TitleSection
            title={recording.title}
            editing={renaming}
            onSave={onSaveTitle}
            saving={savingTitle}
            saveError={titleError ?? null}
            onEndEdit={onEndRename}
            textStyle={styles.cardTitle}
            numberOfLines={2}
            compact
          />
          {/* Tight star + 3-dot cluster pinned to the card's right edge; the
              menu is `edgeAlign`ed so its dots line up with the date below. */}
          <View style={styles.headingActions}>
            <FavoriteStar favorite={recording.favorite} onToggle={onToggleFavorite} disabled={favoritePending} size={20} />
            <RecordingActionsMenu
              canRePractice={canRePracticeRecording(recording)}
              canRename
              canDownload={!recording.audio_deleted && !!recording.audio_path}
              canDeleteAudio={!recording.audio_deleted}
              canRegenerate={recording.status === 'failed'}
              busy={downloadingAudio || deletingAudio || deletingRecording || regenerating}
              onSelect={handleMenuAction}
              edgeAlign
            />
          </View>
        </View>

        {/* The question/topic as a one-line truncated preview (the detail
            screen shows it in full); "No prompt" for miscellaneous. */}
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

        {/* Per-row action outcomes — the actions themselves live in the 3-dot
            menu on the heading line; only their errors surface here. */}
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

// A chain of re-practice attempts for one question, rendered as a SINGLE
// card. Only a multi-member chain reaches this component; a single-member
// chain renders as the ordinary `RecordingListItem` above.
//
// Shows: the shared question as the heading (never an individual attempt's
// title), an "×N attempts" line, the mode pill, and the most-recent
// attempt's date + a status note if it isn't `done`. The favorite star
// reflects/toggles the chain root's `favorite` flag; the 3-dot menu operates
// on the most-recent attempt and has no "Rename title" (the heading is the
// shared question). Tapping the card opens the chain detail screen — a
// per-attempt accordion.
function GroupedRecordingListItem({
  chain,
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
  onRePractice,
}: {
  chain: RePracticeChain<RecordingRow>;
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
  onRePractice: () => void;
}) {
  const mostRecent = chain.members[0];
  const root = chain.members.find((m) => m.id === chain.rootId) ?? mostRecent;
  const modePill = modePillColors(mostRecent.mode);
  const count = chain.members.length;

  // Every attempt answers the same question — that's what a chain is. Shared
  // with the chain detail screen's header via `chainQuestion`.
  const question = chainQuestion(chain.members);

  const statusNote =
    mostRecent.status === 'failed'
      ? 'Last attempt failed'
      : !TERMINAL_STATUSES.has(mostRecent.status)
        ? 'Processing…'
        : null;

  function handleMenuAction(action: RecordingMenuAction) {
    if (action === 're-practice') onRePractice();
    else if (action === 'download') onDownloadAudio();
    else if (action === 'delete-audio') onDeleteAudio();
    else if (action === 'delete-recording') onDeleteRecording();
    else if (action === 'regenerate') onRegenerate();
  }

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <Card style={styles.row}>
        <View style={styles.titleRow}>
          <ThemedText
            type="smallBold"
            numberOfLines={2}
            style={[styles.cardTitle, styles.titleFlex]}>
            {question}
          </ThemedText>
          <View style={styles.headingActions}>
            <FavoriteStar
              favorite={root.favorite}
              onToggle={onToggleFavorite}
              disabled={favoritePending}
              size={20}
            />
            <RecordingActionsMenu
              canRePractice={canRePracticeRecording(mostRecent)}
              canDownload={!mostRecent.audio_deleted && !!mostRecent.audio_path}
              canDeleteAudio={!mostRecent.audio_deleted}
              canRegenerate={mostRecent.status === 'failed'}
              busy={downloadingAudio || deletingAudio || deletingRecording || regenerating}
              onSelect={handleMenuAction}
              edgeAlign
            />
          </View>
        </View>

        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.promptLine}>
          ×{count} attempts{statusNote ? ` · ${statusNote}` : ''}
        </ThemedText>

        <View style={styles.metaRow}>
          <View style={[styles.modePill, { backgroundColor: modePill.backgroundColor }]}>
            <ThemedText type="small" style={[styles.modePillText, { color: modePill.color }]}>
              {formatMode(mostRecent.mode)}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.metaDate}>
            {formatRecordedAt(mostRecent.created_at)}
          </ThemedText>
        </View>

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

// The search bar + Calendar/List toggle above the list.
//
// Search is a purely client-side substring filter over the already-loaded
// `recordings` (the list is capped at 30 rows/user, so there's nothing to
// paginate or server-filter). It matches, case-insensitively, against the
// recording `title` (or the "Untitled recording" fallback text) and the
// `question`/prompt text.
//
// The Calendar view is a standard 7-column month grid, current month by
// default, with prev/next navigation (next is capped at the current month —
// there can be no future recordings). Each day with ≥1 recording gets a dot;
// counts are grouped client-side by the local date portion of `created_at`.
// Tapping a day with recordings switches to List view filtered to that date;
// tapping the selected day again clears the filter; tapping an empty day just
// shows a subtle "No recordings on …" line.
//
// Search and the day filter are mutually exclusive: tapping a day clears any
// search term, and typing a search clears any day filter. A "Showing {date}"
// chip above the filtered list is the explicit way back to everything.
type HistoryView = 'calendar' | 'list';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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
        // `#56453D80` = `Theme.colors.textSecondary` at 50% opacity — the one
        // placeholder-text treatment used app-wide.
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

// The History filter bar (mode + favorites-only). Client-side — it narrows
// the already-built chains, no new backend query. Renders only in List view,
// but its STATE persists across a Calendar/List switch (like the search
// term).
//
// A single horizontal-scrolling row — All, the Favorites toggle, then the
// three modes — so every chip stays reachable on a narrow screen.
// `flexGrow: 0` on the ScrollView keeps it content-height (a horizontal
// ScrollView in a flex column would otherwise fill the remaining vertical
// space and push the list off screen).
//
// A chain's members always share a mode (a re-practice keeps the original's),
// so `members[0].mode` is the chain's mode. "Favorited" keys off
// `chainFavoriteReference` — the chain root, exactly what the grouped card's
// star reads. Both combine freely with the search term / day filter (see
// `visibleChains`).
type ModeFilter = 'all' | RecordingMode;

// A local list (not `MODE_LABELS`) because it also carries the `'all'` option.
const MODE_FILTER_OPTIONS: { key: ModeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'interview', label: 'Interview' },
  { key: 'story', label: 'Storytelling' },
  { key: 'miscellaneous', label: 'Miscellaneous' },
];

function FilterBar({
  modeFilter,
  favoritesOnly,
  onChangeMode,
  onToggleFavorites,
}: {
  modeFilter: ModeFilter;
  favoritesOnly: boolean;
  onChangeMode: (next: ModeFilter) => void;
  onToggleFavorites: () => void;
}) {
  const modeChip = (opt: { key: ModeFilter; label: string }) => {
    const active = modeFilter === opt.key;
    return (
      <Pressable
        key={opt.key}
        onPress={() => onChangeMode(opt.key)}
        style={[styles.filterChip, active && styles.filterChipActive]}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`Filter by ${opt.label}`}>
        <ThemedText
          type="small"
          style={[styles.filterChipText, active && styles.filterChipTextActive]}>
          {opt.label}
        </ThemedText>
      </Pressable>
    );
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.filterScroll}
      contentContainerStyle={styles.filterBar}
      keyboardShouldPersistTaps="handled">
      {/* All */}
      {modeChip(MODE_FILTER_OPTIONS[0])}

      {/* Favorites — sits between "All" and the mode chips */}
      <Pressable
        onPress={onToggleFavorites}
        style={[styles.filterChip, favoritesOnly && styles.filterChipActive]}
        accessibilityRole="button"
        accessibilityState={{ selected: favoritesOnly }}
        accessibilityLabel="Show favorites only">
        <SymbolView
          name={favoritesOnly ? 'star.fill' : 'star'}
          size={13}
          tintColor={favoritesOnly ? Theme.colors.onAccent : Theme.colors.favoriteGold}
        />
        <ThemedText
          type="small"
          style={[styles.filterChipText, favoritesOnly && styles.filterChipTextActive]}>
          Favorites
        </ThemedText>
      </Pressable>

      {/* Interview / Storytelling / Miscellaneous */}
      {MODE_FILTER_OPTIONS.slice(1).map(modeChip)}
    </ScrollView>
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
              {/* `dayInner` is a fixed-size box regardless of today/selected,
                  so `dotSlot` below always sits the same distance from the
                  top of the cell. The "today" circle is smaller, but that
                  sizing lives on the nested `dayCircle`, not this box, so it
                  can't shift the dot's vertical position. */}
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

  // Client-side search + the Calendar/List view toggle. `search` filters the
  // list client-side — see `matchesSearch`.
  const [search, setSearch] = useState('');
  const [view, setView] = useState<HistoryView>('list');

  // Client-side mode + favorites-only filters. State lives here (not in
  // `FilterBar`) so it survives a Calendar/List toggle, same as the search
  // term. `'all'` = no mode filter applied.
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const filtersActive = modeFilter !== 'all' || favoritesOnly;
  // Measured height of the overlaid filter-pill zone (pills + day chip + the
  // cream→transparent fade tail). The list content is inset by this so its
  // first card starts just below the fade, and cards scroll *under* the pills
  // rather than hard-clipping.
  const [filterZoneHeight, setFilterZoneHeight] = useState(56);
  const handleClearFilters = useCallback(() => {
    setModeFilter('all');
    setFavoritesOnly(false);
  }, []);

  // Calendar state. `calendar` is the month shown in the grid (defaults to
  // the current month). `dayFilter`, when set, narrows the List view to that
  // day. `emptyDayNotice` is the `dayKey` of a tapped day with no recordings.
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
  // already-selected day -> clear the filter; otherwise -> set the day
  // filter, clear any active search (mutually exclusive), and switch to List.
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

  // Per-row action state, all keyed by recording id so failed/in-flight rows
  // are independent — each gets its own spinner / error, not a list-wide one.
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [regenerateErrors, setRegenerateErrors] = useState<Record<string, string>>({});
  const [favoritingIds, setFavoritingIds] = useState<Set<string>>(new Set());
  const [deletingAudioIds, setDeletingAudioIds] = useState<Set<string>>(new Set());
  const [deleteAudioErrors, setDeleteAudioErrors] = useState<Record<string, string>>({});
  const [downloadingAudioIds, setDownloadingAudioIds] = useState<Set<string>>(new Set());
  const [downloadAudioErrors, setDownloadAudioErrors] = useState<Record<string, string>>({});
  const [deletingRecordingIds, setDeletingRecordingIds] = useState<Set<string>>(new Set());
  const [deleteRecordingErrors, setDeleteRecordingErrors] = useState<Record<string, string>>({});
  // `renamingIds` = which rows have their inline title editor open (opened
  // from the 3-dot menu's "Rename title").
  const [renamingIds, setRenamingIds] = useState<Set<string>>(new Set());
  const [titleSavingIds, setTitleSavingIds] = useState<Set<string>>(new Set());
  const [titleErrors, setTitleErrors] = useState<Record<string, string>>({});

  // Monotonically-increasing id for each `load()` call. The poll below can
  // have more than one `fetchRecordings()` in flight at once (e.g. a manual
  // pull-to-refresh landing mid-poll), and they aren't guaranteed to resolve
  // in send order — so only the response matching the most recently *issued*
  // request is applied, and a slower older one can't overwrite fresh state.
  // A ref, not state, so bumping it doesn't re-render.
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

  // Refetch on an interval while any row is still pending/processing, so
  // status visibly moves pending -> processing -> done without a manual
  // pull-to-refresh. Only runs while this tab is focused, and stops firing
  // once every row has reached a terminal state. Fetching is one query for
  // the whole list, so there's no per-row "stop polling this row" — just
  // "is any row non-terminal", which is what `stillInFlight` checks.
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
      // Flip this row to 'processing' (what `process_recording()` sets as its
      // first step) so it reads as back in progress immediately and the poll
      // above picks it up on its next tick.
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

  // Optimistic favorite toggle: flip local state immediately, then persist
  // via `setFavorite` and revert on failure.
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

  // No confirmation dialog — tapping delete calls the backend immediately.
  // Not optimistic: local state only flips to audio_deleted once the backend
  // confirms, so it never briefly shows "audio deleted" for audio that's
  // still there (or the reverse).
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

  // Downloads a recording's audio and opens the native share sheet. A
  // cancelled share sheet isn't a failure — `shareRecordingAudio` resolves
  // the same way on cancel as on a completed share. Guards on `audioPath`
  // defensively even though the menu item is only shown when one exists.
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

  // Permanently delete a whole recording (row + audio). Gated behind a
  // confirmation dialog in `RecordingActionsMenu`. Not optimistic: the row is
  // dropped from local state only once the backend confirms. A cap slot
  // frees up automatically — the deleted row no longer exists to be counted.
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

  // "Re-practice this question" navigates to the Record tab carrying the
  // original recording's id + mode + question via route params; that screen
  // consumes them into a read-only re-practice state and writes
  // `re_practice_of` on upload.
  function handleRePractice(recording: RecordingRow) {
    router.navigate({ pathname: '/', params: rePracticeNavParams(recording) });
  }

  // Title editing, opened from the 3-dot menu's "Rename title". A direct
  // `updateRecordingTitle` Supabase update, not optimistic — the row's
  // `title` only changes once the write lands. `handleSaveTitle` returns
  // whether it persisted so `TitleSection` knows whether to close.
  function handleStartRename(id: string) {
    setTitleErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setRenamingIds((prev) => new Set(prev).add(id));
  }

  function handleEndRename(id: string) {
    setRenamingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setTitleErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function handleSaveTitle(id: string, nextTitle: string): Promise<boolean> {
    setTitleSavingIds((prev) => new Set(prev).add(id));
    setTitleErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await updateRecordingTitle(id, nextTitle);
      setRecordings((prev) => prev?.map((row) => (row.id === id ? { ...row, title: nextTitle } : row)) ?? prev);
      return true;
    } catch (err) {
      setTitleErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Could not save title — try again.',
      }));
      return false;
    } finally {
      setTitleSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const query = search.trim().toLowerCase();

  // Group the full list into re-practice chains, then filter whole chains: a
  // chain stays visible if ANY of its attempts matches, and the card shows
  // the whole chain. A single-member chain is just an ordinary recording.
  const allChains = useMemo(() => buildChains(recordings ?? []), [recordings]);

  const visibleChains = useMemo(() => {
    let chains = allChains;
    // A chain's members share a mode, so `members[0].mode` is the chain's
    // mode. "Favorited" keys off the same recording the grouped card's star
    // reads (`chainFavoriteReference`).
    if (modeFilter !== 'all') {
      chains = chains.filter((chain) => chain.members[0].mode === modeFilter);
    }
    if (favoritesOnly) {
      chains = chains.filter((chain) => chainFavoriteReference(chain).favorite);
    }
    // Day filter and search are mutually exclusive in the UI, but applying
    // both here is harmless and robust if that ever changes.
    if (dayFilter) {
      chains = chains.filter((chain) =>
        chain.members.some((m) => dayKey(new Date(m.created_at)) === dayFilter)
      );
    }
    if (query) {
      chains = chains.filter((chain) => chain.members.some((m) => matchesSearch(m, query)));
    }
    return chains;
  }, [allChains, query, dayFilter, modeFilter, favoritesOnly]);

  // Recording counts by local calendar day, for the month grid's per-day
  // dots. Computed from the full list (not the filtered one) so the dots
  // always reflect every recording.
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
  // Three visually-distinct "nothing to show" states for List view, in
  // priority order (mutually exclusive by construction):
  const noVisible = view === 'list' && hasRecordings && visibleChains.length === 0;
  // 1. A mode/favorites filter combo (possibly + a search term) matched
  //    nothing — offers a "Clear filters" reset.
  const showNoFilterMatches = noVisible && filtersActive;
  // 2. A search that matched nothing, no filters active.
  const showNoResults = noVisible && !filtersActive && query.length > 0 && !dayFilter;
  // 3. A day filter that now matches nothing (e.g. the day's last recording
  //    was just deleted) — the "Showing {date}" chip is still the way back.
  const showEmptyDayFilter =
    noVisible && !filtersActive && !!dayFilter && query.length === 0;

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
              <View style={styles.listRegion}>
                {showNoFilterMatches || showNoResults || showEmptyDayFilter ? (
                  <View style={[styles.centerFill, { paddingTop: filterZoneHeight }]}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                      {showNoFilterMatches
                        ? query.length > 0
                          ? `Nothing matches your filters and “${search.trim()}”.`
                          : 'No recordings match your filters.'
                        : showEmptyDayFilter
                          ? `No recordings on ${formatDayLabel(dayFilter!)}.`
                          : `No recordings match “${search.trim()}”. Try a different search.`}
                    </ThemedText>
                    {showNoFilterMatches && (
                      <Pressable onPress={handleClearFilters} accessibilityRole="button">
                        <ThemedText type="link">Clear filters</ThemedText>
                      </Pressable>
                    )}
                  </View>
                ) : (
                  <FlatList
                    style={styles.list}
                    data={visibleChains}
                    keyExtractor={(chain) => chain.rootId}
                    renderItem={({ item: chain }) => {
                      // Multi-attempt chain -> one grouped card that opens the
                      // accordion chain detail screen. Its 3-dot menu acts on
                      // the most-recent attempt.
                      if (chain.members.length > 1) {
                        const root = chain.members.find((m) => m.id === chain.rootId) ?? chain.members[0];
                        const latest = chain.members[0];
                        return (
                          <GroupedRecordingListItem
                            chain={chain}
                            onPress={() =>
                              router.push({
                                pathname: '/history/chain/[rootId]',
                                params: { rootId: chain.rootId },
                              })
                            }
                            onToggleFavorite={() => handleToggleFavorite(chain.rootId, !root.favorite)}
                            favoritePending={favoritingIds.has(chain.rootId)}
                            onRegenerate={() => handleRegenerate(latest.id)}
                            regenerating={regeneratingIds.has(latest.id)}
                            regenerateError={regenerateErrors[latest.id]}
                            onDeleteAudio={() => handleDeleteAudio(latest.id)}
                            deletingAudio={deletingAudioIds.has(latest.id)}
                            deleteAudioError={deleteAudioErrors[latest.id]}
                            onDeleteRecording={() => handleDeleteRecording(latest.id)}
                            deletingRecording={deletingRecordingIds.has(latest.id)}
                            deleteRecordingError={deleteRecordingErrors[latest.id]}
                            onDownloadAudio={() => handleDownloadAudio(latest.id, latest.audio_path)}
                            downloadingAudio={downloadingAudioIds.has(latest.id)}
                            downloadAudioError={downloadAudioErrors[latest.id]}
                            onRePractice={() => handleRePractice(latest)}
                          />
                        );
                      }
                      // Single-member chain -> the ordinary recording card.
                      const item = chain.members[0];
                      return (
                        <RecordingListItem
                          recording={item}
                          onPress={() => router.push({ pathname: '/history/[id]', params: { id: item.id } })}
                          onToggleFavorite={() => handleToggleFavorite(item.id, !item.favorite)}
                          favoritePending={favoritingIds.has(item.id)}
                          renaming={renamingIds.has(item.id)}
                          onRename={() => handleStartRename(item.id)}
                          onEndRename={() => handleEndRename(item.id)}
                          onSaveTitle={(next) => handleSaveTitle(item.id, next)}
                          savingTitle={titleSavingIds.has(item.id)}
                          titleError={titleErrors[item.id]}
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
                          onRePractice={() => handleRePractice(item)}
                        />
                      );
                    }}
                    contentContainerStyle={[
                      styles.listContent,
                      { paddingTop: filterZoneHeight + Spacing.two },
                    ]}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                      <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        tintColor={theme.textSecondary}
                        progressViewOffset={filterZoneHeight}
                      />
                    }
                  />
                )}

                {/* The filter pills + day chip, overlaid on the list. A
                    cream→transparent `ScrollFade` sits BEHIND the pills
                    (`opaqueFraction` keeps the top of the row solid, the fade
                    starting ~mid-pill) so cards flow seamlessly under them
                    while scrolling. Measured so the list content is inset by
                    exactly its height. */}
                <View
                  style={styles.filterZone}
                  pointerEvents="box-none"
                  onLayout={(e) => setFilterZoneHeight(e.nativeEvent.layout.height)}>
                  <ScrollFade style={StyleSheet.absoluteFill} opaqueFraction={0.45} />
                  <FilterBar
                    modeFilter={modeFilter}
                    favoritesOnly={favoritesOnly}
                    onChangeMode={setModeFilter}
                    onToggleFavorites={() => setFavoritesOnly((v) => !v)}
                  />
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
                </View>
              </View>
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
    // The horizontal gutter lives on the individual sections below, NOT here:
    // a ScrollView/FlatList clips its content to its own frame, so a padded
    // container would slice the card drop shadows off at the list's edges.
    // Full-bleed list + inset contentContainer lets the shadow bleed into the
    // gutter.
  },
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
  // Pill-shaped search bar (card fill + hairline border), in the same
  // horizontal gutter as the header and list.
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
  // The mode + favorites filter row. Pill chips in the app's standard
  // "unselected control" treatment (card fill + hairline border), flipping to
  // the `accent` fill + `onAccent` text of every other active control when
  // narrowing. `flexGrow: 0` so the horizontal ScrollView stays
  // content-height instead of filling the column's remaining vertical space.
  filterScroll: {
    flexGrow: 0,
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Theme.radius.pill,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: Theme.colors.card,
  },
  filterChipActive: {
    backgroundColor: Theme.colors.accent,
    borderColor: Theme.colors.accent,
  },
  filterChipText: {
    fontSize: 13,
    lineHeight: 18,
    color: Theme.colors.textSecondary,
  },
  filterChipTextActive: {
    color: Theme.colors.onAccent,
  },
  // The list + the overlaid filter zone share this relative box so the pills
  // can sit `position: absolute` on top of the scrolling list.
  listRegion: {
    flex: 1,
  },
  // The pills + day chip float over the top of the list, with a `ScrollFade`
  // as `absoluteFill` behind them (opaque up top, fading from ~mid-pill down
  // through this `paddingBottom`) so list cards dissolve as they scroll up
  // under the row.
  filterZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
    paddingBottom: Spacing.three,
  },
  list: {
    // fill the space left under the header / search bar / toggle so the
    // list scrolls within its own frame
    flex: 1,
  },
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
  // below always sits the same distance from the cell's top.
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
  // Tight star + 3-dot cluster, hugging the card's right edge.
  headingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  titleFlex: {
    // grow to fill the row so the star + 3-dot menu are pinned to the right
    // edge as a fixed cluster, regardless of how short the title is
    flex: 1,
  },
  cardTitle: {
    // Noto Sans bold at a list-card heading size — smaller than the detail
    // screen's `subtitle`, larger than body.
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
