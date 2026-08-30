# Brevado

Mobile-first app for practicing concise, intentional public speaking. Each day the user picks a
mode (interview, story, or miscellaneous), records a voice memo answering a prompt (or a
self-chosen topic), and gets AI-generated feedback shortly after — focused on structure,
conciseness, and filler-word usage. Past sessions and feedback are stored as a searchable
history. Goal: make it effortless to build a daily practice habit and see, over time, whether
speaking is actually getting more concise — not just generate one-off feedback.

Full detail lives in [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md) — read it when a task needs
more context than what's here.

## Current phase

**v1 is complete and tested end-to-end** — Phases 1-4 (auth, recording UI, upload, AI pipeline,
history/retention/retry, hardcoded question pool + mode selection) are all built. Phase 4 Step 5,
the v1 exit checkpoint's on-device pass (docs/PROJECT_PLAN.md's full test script — see
[Phase 4 exit checkpoint](#phase-4-exit-checkpoint) for the script itself), has now been run and
confirmed working, closing out the "still needs a manual on-device pass" caveat that this section
used to carry for most of Phase 3 and all of Phase 4. No further v1 feature work is planned. The
detailed step-by-step history of how each Phase 1-4 feature was built is kept in that feature's own
section below (e.g. [Recording cap](#recording-cap), [Mode selection](#mode-selection),
[Question selection](#question-selection), [History](#history), [Audio delete](#audio-delete),
[Audio download](#audio-download), [Phase 3 assessment](#phase-3-assessment),
[Phase 4 exit checkpoint](#phase-4-exit-checkpoint)) rather than repeated here — all of it is still
accurate for what exists in the repo today.

**v2 — a UI redesign plus a handful of new features — is complete** (type-check / lint / pytest
clean; the full on-device pass in the [Epic D wrap-up](#epic-d-wrap-up) test plan is still the one
standing caveat, shared with several Phase 3/4 steps). See [Scope](#scope) below for the full
summary. What shipped:
- **Epic A (done):** nav shell restructure (Record / History / Streaks), Settings screen.
- **Epic B (done):** the shared design system (`src/constants/theme.ts` — warm palette, Noto
  Sans, `Card`, nav styling).
- **Epic C (done — all 4 parts):** the Record flow — mode-select restyle, the shift animation,
  the `QuestionArea` (pool / custom question), the record disc, and the **post-recording
  behaviour change** (stay on Record + live status + "See more details", replacing the
  auto-navigate-to-History). See [Epic C](#epic-c--record-flow-restyle-parts-14-all-done--epic-c-is-complete).
- **Epic D (done — all 7 parts, Epic D is complete):** the History redesign + recording titles —
  title generation, title editing, list restyle, 3-dot menu, search + Calendar/List toggle, the
  real Calendar view, and the detail-screen visual restyle. See the per-part breakdown below and
  the [Epic D wrap-up](#epic-d-wrap-up) assessment.
  - **Part 1 (done):** a colour consolidation (all link blues → one `Theme.colors.link`
    token — see [Design system](#design-system)'s "Link colour consolidation"), plus the
    `title` column + its AI generation, backend/data only. See
    [Recording titles](#recording-titles).
  - **Part 2 (done):** inline title editing on the (pre-restyle) History detail screen —
    pencil-edit mirroring `QuestionArea`'s custom-question pattern, direct-Supabase save,
    handles NULL titles. See [Recording titles](#recording-titles)'s "Editing" subsection.
  - **Part 3 (done):** the History **list** card restyle — each row is a `<Card>` showing
    the recording `title` as a bold heading (muted "Untitled recording" fallback for a NULL
    title), the question/prompt as a `textSecondary` secondary line ("No prompt" for
    miscellaneous), a colour-coded mode pill (`modeInterview`/`modeStory`/`modeMiscellaneous`
    bg + matching saturated `*Text` label tokens → purple/pink/blue), the date/time
    right-aligned opposite the pill, and a theme-tinted favorite star. **No status badge on
    the list card** (the failed-row "Regenerate report" action keys off `recording.status`
    directly). The existing inline download/delete/regenerate actions are **unchanged in
    behaviour** — only their icon tint was neutralised to theme tokens. See
    [History](#history)'s "List card restyle (Epic D Part 3)" bullet.
  - **Part 4 (done):** the per-row **3-dot menu** consolidation. A shared
    `RecordingActionsMenu` (`src/components/recording-actions-menu.tsx` — a small `<Card>`
    popover that hovers by the trigger; vertical-dots icon; not `ActionSheetIOS`) replaces
    the old inline icon row (`DownloadAudioButton` /
    `DeleteAudioButton`, both **deleted**) and the inline "Regenerate report" text action,
    on both the History **list** card (heading line, next to the always-visible favorite
    star) and the **detail** screen (header row). Actions: **Download audio**, **Delete
    audio** (unchanged Phase 3 Step 5 behaviour — row kept, audio cleared), **Delete
    recording** (NEW — removes the whole row + its audio via a new backend endpoint), and
    **Regenerate report** (shown only when `status === 'failed'`). "Delete recording" is the
    one action gated behind an `Alert.alert` confirmation; "Delete audio" keeps its explicit
    no-confirmation behaviour. See [History](#history)'s "3-dot actions menu (Epic D Part 4)"
    bullet and [Delete recording](#delete-recording).
  - **Part 5 (done):** the History **search bar** + the **Calendar/List view toggle**.
    Search is a client-side substring filter (case-insensitive) over the already-loaded
    list, matching `title` (incl. the "Untitled recording" NULL fallback text) and the
    `question`/prompt — no new backend query. The toggle is a minimalist underline-style
    tab pair; **List** is the existing restyled-card list (now filtered by the search term,
    with a distinct "no results" empty state), **Calendar** was an intentional **placeholder**
    this step (the real grid landed in Part 6). Typing a non-empty search
    term while on Calendar auto-switches to List; clearing it does not switch back. See
    [History](#history)'s "Search + view toggle (Epic D Part 5)" bullet.
  - **Part 6 (done):** the real **Calendar view** — a standard 7-column month grid, current
    month by default, prev/next month navigation (next capped at the current month), a dot on
    each day that has ≥1 recording (counts grouped **client-side** from the already-loaded
    list by the local-date portion of `created_at` — no new backend query), and tap-to-filter:
    tapping a day with recordings switches to **List** view filtered to that date (reusing
    Part 3/4's card + menu), tapping it again clears the filter, tapping an empty day is a
    no-op beyond a subtle "No recordings on …" line. Search and the day filter are **mutually
    exclusive** — tapping a day clears any search term, typing a search clears any day filter.
    A "Showing {date}" chip above the filtered list is the explicit reset. **Not** in Part 6:
    the History detail-screen visual restyle — deferred to Part 7 (see [Recording
    titles](#recording-titles) and the [Epic D wrap-up](#epic-d-wrap-up)). See
    [History](#history)'s "Calendar view (Epic D Part 6)" bullet.
  - **Part 7 (done — closes out Epic D):** the History **detail-screen** visual restyle, deferred
    out of Part 6 — see [History](#history)'s "Detail screen (Phase 3 Step 1, done)" bullet for
    the full new layout (editable title as the large bold heading, mode pill + status badge +
    date meta row, an always-shown Question/"No prompt" block, a restyled pill-shaped audio
    player, compact metric stat blocks, and bold Feedback/Transcript section headers). Also
    fixed in this part, flagged in the Part 6 wrap-up: **a pipeline run (initial generation or
    "Regenerate report") used to silently overwrite a user's hand-edited title** — see
    [Recording titles](#recording-titles)'s "Editing (Part 2)" subsection for the fix (a new
    `title_edited_by_user` column, migration `0006_title_edited_by_user.sql`).

Sections below that predate a given Epic still describe the v1 implementation where that Epic
hasn't rewritten them. All of History — list, search, calendar, and now the detail screen — is
fully v2 (Epic D, all 7 parts).

**v3 (Phase 6) — scoring + the Streaks tab — is complete** (type-check / lint / `pytest` /
`npm run test:streaks` all clean; the on-device pass in the [v3 wrap-up](#v3-wrap-up) test plan is
the one standing caveat, shared with every Phase 3/4 and Epic C/D step). Three 0–100 per-recording
scores (Impact / Clarity / Structure) come from the *existing* Gemini feedback call (Epic F), and
the Streaks tab — home screen + three per-metric detail screens — aggregates them entirely
client-side (Epic G). See [v3 scope](#v3-scope) and the [v3 wrap-up](#v3-wrap-up) below.

**v4 (Phase 7) — the global daily-question system + re-practice mode — is now the current
phase.** Scope summary in [v4 scope](#v4-scope) below. **Epic H is complete — Step 1 (backend)
and Step 2 (frontend wiring). Epic I (re-practice mode) is complete.**
- **Step 1 (done):** the schema (migration `0008_daily_questions.sql` + seed
  `0009_seed_question_pool.sql`), the lazy daily-question assignment logic
  (`backend/app/services/daily_questions.py`), the `GET /questions/daily` endpoint, and unit
  tests.
- **Step 2 (done):** the Record flow now calls `GET /questions/daily?mode=interview|story`
  (`fetchDailyQuestion` in `src/lib/api.ts`) instead of the old client-side pool pick; a
  pool-picked recording stores both `question` text and the new `question_id` FK, a
  custom-typed one stores only text (`question_id` null), miscellaneous unchanged. The old
  path — `src/lib/question-selection.ts` (`pickQuestionForMode`) and `src/lib/questions.ts`
  (the static 25+25 pool) — is **deleted**. Also fixed the Step 1 flagged FK gap:
  `recordings.re_practice_of` now has `on delete set null` (migration
  `0010_re_practice_of_on_delete.sql`). Type-check / lint clean; on-device pass is the one
  standing caveat (shared with every Phase 3/4 and Epic C/D/F/G step).

`recordings.re_practice_of` **is now set** — by a re-practice recording's upload (**Epic I**,
done). Full detail in [Re-practice mode](#re-practice-mode). **Epic J Part 1 is done** — the pure
chain-building logic (`src/lib/re-practice-chains.ts`, unit-tested) plus grouping applied to
History's **List** view (a question's re-practice attempts render as one card). The real
**accordion detail screen + per-attempt 3-dot menus is Epic J Part 2** (next). See
[Re-practice chains](#re-practice-chains). Additional modes beyond interview/story stay **out of
scope** for v4.

**Terminology note:** docs/PROJECT_PLAN.md's original "v2" scope was renamed **v3** to free up
"v2" for the UI-redesign release. That v3 list has since been **narrowed**: criteria-based scoring
(now the three fixed scores) + the Streaks tab stay in **v3**; re-practice mode, the dynamic
question pool, and additional modes moved to a new **v4** (Phase 7). The "Streaks" bottom-nav tab
was added in v2 as an empty placeholder — v3 fills it, v3 doesn't introduce it. Old "v2"/"v3"
references in git history predate these moves.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React Native + TypeScript (Expo), run via Expo Go | Mobile-first UI: recording (expo-audio), playback, history, dashboard. Free, no Mac needed to develop (EAS Build compiles in the cloud if ever needed) |
| Auth | Supabase Auth | Account creation/login |
| Database | Supabase Postgres | Users, recordings, transcripts, feedback, questions |
| File storage | Supabase Storage | Audio files, capped per user (`MAX_RECORDINGS_PER_USER`) and manually deleted rather than time-expired |
| API | Python (FastAPI) on Render | Handles uploads, serves data to the frontend, and runs background processing in-process via FastAPI's `BackgroundTasks` — no separate queue/broker/worker service |
| AI | Gemini API (Flash model, free tier) | Transcription (native audio input) + feedback generation (v2 extends this call to also return an auto-generated recording title; v3 extends it again for three 0–100 scores + a grammar-issue count); dynamic question generation in v4 |
| Hosting | Render (API only) | Frontend isn't web-hosted — it runs as an Expo project loaded through the Expo Go app; free-tier API subdomain, custom domain optional |

## Scope

**v1 (complete):** recording/playback/AI feedback pipeline, mode selection with a hardcoded
question pool, auth, history view, retry/regenerate logic, audio retention rules. Everything else
in this document describes v1 as it exists in the repo today, unless a section explicitly says
otherwise (nothing does yet — v2 work hasn't started touching code).

**v2 (building now) — UI redesign + new features:**
- **Nav:** bottom nav gains a third tab, "Streaks" (empty placeholder — v3 fills it in later).
  Home tab renamed/restructured as "Record".
- **Settings screen** (not a tab): a profile icon in the header on Record/History/Streaks only,
  never on a detail/sub-screen. Shows the user's email + a sign-out action, migrated from
  wherever sign-out currently lives (see [Auth](#auth)).
- **Visual redesign:** a new shared design system (colors, typography, card/button shapes,
  spacing), app-wide — not a per-screen reskin. **Matched from design screenshots outside this
  repo, screen by screen, as we build — this doc does not and should not specify exact hex values
  or measurements.** Qualitative direction only, for now: warm cream/peach background, dark
  brown/maroon text, pill-shaped buttons, rounded cards. Expect exact values from the user
  screen-by-screen as each one is built, not from anything written down here.
- **Record flow:** a shift/transition animation on mode selection; after upload, the app stays on
  Record showing live processing status instead of auto-navigating to History, with a "See more
  details" link to the History detail screen once done.
- **Recording titles:** a new `title` field, auto-generated by the existing Gemini feedback call
  (extended to also return one), user-editable afterward.
- **History:** a search bar (title + question, client-side filter), a Calendar/List toggle with a
  real calendar (dot per day with recordings, tap to filter), and a restyled list/detail view. Per-row
  actions move from inline icons/text to a 3-dot menu: Download audio, Delete audio, **Delete
  recording** (new — removes the row + audio together, unlike the existing audio-only delete),
  Regenerate report (failed rows only).

**v3 (Phase 6 — building now):** three 0–100 per-recording scores — **Impact / Clarity /
Structure** — from the existing Gemini feedback call, plus the **Streaks tab** (client-side
aggregation). No "overall" score, no backfill. The recording detail screen's raw-metrics display
(filler rate / WPM / repetition) is *replaced* by the three score badges. Full detail in
[v3 scope](#v3-scope) below.

**v4 (Phase 7 — deferred, do NOT build yet):** re-practice / redo-question mode, dynamically
growing AI-generated question pool (+ event-driven top-up generation), additional modes beyond
interview/story. Split back out of v3; see docs/PROJECT_PLAN.md Section 2.

**Out of scope for now:** email notifications, Apple Developer Program / App Store / TestFlight
distribution, multi-tenant scaling concerns (rate limiting, abuse prevention, paid AI tier), push
notifications (deletion warning is in-app badge only).

## v3 scope

v3 (Phase 6) is **scoring + the Streaks tab**, nothing else. Two epics: **Epic F** (the scores —
schema, generation, storage, recording-detail display) and **Epic G** (the Streaks tab —
client-side aggregation UI). Detailed step writeups land in their own sections below as each is
built, same as v2's epics; this is the reference summary.

**Epic F Step 1 is done** (schema + scoring generation + storage + the recording-detail display
swap — type-check / lint / backend pytest clean, no on-device pass yet). Migration
`0007_recording_scores.sql`. The per-section writeups below ([Database](#database),
[Feedback generation](#feedback-generation), [Background processing](#background-processing),
[History](#history)) now describe the scored pipeline. **Epic F Step 2** would be any remaining
scoring polish; **Epic G** is the Streaks tab.

**Epic G Part 1 is done** — the pure client-side aggregation logic (`src/lib/streaks.ts`), no UI
yet. Isolated, dependency-free, unit-tested functions (`buildDailyAverages` / `calculateStreak` /
`calculateTrend` / `buildGraphPoints`) verified against hand-written cases before any screen
consumes them, same spirit as the backend's `metrics.py`. Type-check / lint clean; `npm run
test:streaks` (25 cases) green. Full contract in [Streaks aggregation](#streaks-aggregation) below.

**Epic G Part 2 is done** — the Streaks **home screen** (`src/app/(tabs)/streaks/index.tsx` —
moved into a directory in Part 3), replacing the Epic A empty placeholder: a streak header
("You're on a {n} day streak!" + a "Longest streak" line) and three metric cards (Impact /
Clarity / Structure), each with a fixed **7-day** % change, an up/down trend triangle, a mini
inline line graph, and a "See details" link (inert in Part 2 — Part 3 wired it up). All
client-side over the same `fetchRecordings()` query History uses — widened in this part to also
select `impact_score` / `clarity_score` / `structure_score`. Full layout in
[Streaks home screen](#streaks-home-screen) below.

**Epic G Part 3 is done — this closes out Epic G and v3's core scope.** The per-metric **detail
screens** ("See details" → `/streaks/impact` | `/streaks/clarity` | `/streaks/structure`): a
Week / Month / Year / All Time tab row that recalculates the headline % *and* the full-size graph
together, plus — on Clarity only — three windowed supporting badges (Filler rate / Repetition /
Grammar), the new home for the raw metrics Epic F removed from individual recordings.
`src/lib/streaks.ts` gained a **5th** function, `averageClaritySupportingMetrics`; `fetchRecordings()`
widened again to select `metrics` + `grammar_issue_count`. Type-check / lint / `npm run
test:streaks` (31 cases) clean; no on-device pass yet. Full detail in
[Streaks detail screen](#streaks-detail-screen) below; assessment in the [v3 wrap-up](#v3-wrap-up).

**The three scores.** Every new recording gets `impact_score`, `clarity_score`, `structure_score`
— each an **integer 0–100** — displayed in that order (Impact, Clarity, Structure). **No combined
"overall" score.** They are produced by *extending the existing Gemini feedback call* (the one in
`backend/app/services/feedback.py` that already returns `feedback` + `title`) to return them in the
same structured-JSON response — **no new API call, no second model**. A fourth new field,
`grammar_issue_count` (integer), also comes back from that call — it is a Clarity grounding input,
not itself a displayed score.

- **Impact** — mode-specific prompt guidance, genuinely different per mode (not one instruction
  with the mode name swapped in): interview → did the answer actually address the question; story →
  narrative cohesion / engagement; miscellaneous → substance and coherence of the take.
- **Clarity** — **one holistic LLM judgment** of how clear / easy-to-follow the speech was
  overall, *not* a mechanical average of anything. Merges the originally-separate "conciseness" and
  "clarity" ideas. The prompt is **grounded by** three sub-metrics (same grounding pattern as the
  existing feedback prose): the deterministic `filler_word_rate` and `repetition_count` from
  `metrics.py`, plus `grammar_issue_count`, which the model assesses itself (there is no
  deterministic grammar check) and returns as a count of notable issues.
- **Structure** — mode-aware organization / coherence judgment, consistent with how the existing
  feedback text is already mode-aware about structure.

**Schema (Epic F Step 1).** Migration `0007_recording_scores.sql` adds four nullable, no-default
`integer` columns to `recordings`: `impact_score`, `clarity_score`, `structure_score`,
`grammar_issue_count`. Run manually in the Supabase SQL editor like `0001`–`0006`.

**No backfill.** Existing recordings keep all four columns NULL. They are **excluded from every
Streaks aggregation** (a NULL score never counts toward a daily average, streak, or trend). A row
gets scores only if generated fresh or via "Regenerate report".

**Lenient failure (same philosophy as title generation).** If the feedback call succeeds and
`feedback` is usable but a score is missing/unparseable, the recording still reaches `done` — the
missing score(s) stay NULL and it's logged. Only a bad `feedback` field fails/retries the
recording. A bad score never does.

**Recording detail screen display change (Epic F Step 1).** The existing Metrics section
(`MetricsRow` / `formatMetrics` in `src/app/(tabs)/history/[id].tsx` — filler rate / WPM /
repetition stat blocks) is **replaced** by three score badges (Impact / Clarity / Structure, plain
percentages, no trend arrows — a single recording has no history). After this change, **filler
rate, WPM, and repetition appear nowhere on an individual recording's detail screen.** Those
numbers still compute and store in `recordings.metrics` exactly as before — they only *surface*
again inside Streaks → Clarity's detail screen as supporting badges (Epic G).

**Streaks tab (Epic G).** Fills the empty placeholder tab (`src/app/(tabs)/streaks/`, a directory
as of Epic G Part 3) added in v2. Daily-average score trends, streak counting, and trend-% calculation are all computed
**client-side** over already-fetched recordings data — **no new backend endpoint**, consistent
with how v2's History search and calendar view were built (`fetchRecordings()` may need widening to
select the score columns). Per-metric detail screens; **Clarity's is the one place the old raw
metrics resurface** — pace (WPM), filler rate, repetition, and grammar-issue count, shown as
supporting badges (of those, filler rate / repetition / grammar-issue count are also its
scoring-grounding inputs).

**Not in v3 — do not build:** re-practice mode, the dynamic AI question pool, additional modes.
Those are **v4** (Phase 7). Old notes / git history may still lump them under "v3".

## Streaks aggregation

v3 Epic G Part 1 — the **pure computation layer** the Streaks tab (Part 2 onward) renders on top
of. Lives in `src/lib/streaks.ts`: **five** functions (four from Part 1; `averageClaritySupportingMetrics`
added in Part 3), no React / React Native / Supabase imports, no network, all deriving from the
already-fetched recordings list (**no new backend endpoint** — consistent with v2's History search
/ calendar; `fetchRecordings()` was widened in Part 2 for the three score columns and again in
Part 3 for `metrics` + `grammar_issue_count`). Also exports `SCORE_METRICS` (the three metrics'
key / slug / label / description, shared by the home and detail screens so they can't drift).
Unit-tested in `src/lib/streaks.test.ts` — see
[Running the streaks tests](#running-the-streaks-tests) below.

**Day-key reuse.** All day grouping goes through **`localDayKey(d: Date)`** (now in
`src/lib/format-time.ts`, alongside new `dayKeyToDate` / `addLocalDays` helpers) — the *exact*
same `YYYY-MM-DD`-in-device-local-time rule History's Calendar view (v2 Epic D Part 6) groups by.
That function was extracted from `history/index.tsx`'s inline `dayKey` in this step; `history/
index.tsx` now imports it (aliased back to `dayKey`, call sites unchanged). Local-time-zone
tradeoff (a recording can appear to shift days if the user travels across time zones between
recording and viewing) is unchanged and documented at the function.

**Input shape.** Every function takes `StreakRecording[]` — `{ status, created_at, impact_score,
clarity_score, structure_score }` (the minimal subset; a widened `RecordingRow` is assignable to
it). `ScoreMetric` = `'impact_score' | 'clarity_score' | 'structure_score'` (note:
`grammar_issue_count` is **not** a trend metric — it's a Clarity grounding input only).

### `buildDailyAverages(recordings, metric)` → `DailyAverage[]`

Groups **`done`** recordings that have a **non-null, finite** value for `metric` by local calendar
day, averages each day, returns a new array **sorted ascending by `date`**. `DailyAverage` =
`{ date: string /* localDayKey */, average: number }`. The average is **not rounded** (scores
80 + 95 → `87.5`) so downstream trend math stays exact — the UI rounds for display.

- **`done`-only** and **non-null-only** are the two filters. A `pending`/`processing`/`failed`
  recording never contributes; neither does a recording whose `metric` is `null` (pre-v3 row, or
  a score that missed generation per Epic F's lenient failure).
- Empty input, or nothing qualifying, → `[]`.
- Multiple recordings on one day → that day's single entry is their mean.

### `calculateStreak(recordings)` → `{ current, longest }`

Practice-**activity** streak — counts days the user *recorded*, **regardless of scores** (a
recording with all-null scores still counts). Only **`status === 'done'`** recordings count as a
completed practice day. Multiple recordings on a day count that day **once**.

- **`current`** — consecutive local days with ≥1 `done` recording, counted **backward from
  today**. If today has a recording, it's included and counting continues into yesterday, etc. If
  today has **none**, that's allowed ("haven't practised yet today") and counting anchors on
  **yesterday** instead. The streak ends at the first **fully skipped day**. If **neither today
  nor yesterday** has a recording, `current` is `0`.
- **`longest`** — the longest consecutive-day run anywhere in history (DST-safe: day gaps are
  computed by rounding the ms delta between local-midnight dates, so a 23h/25h DST day still
  counts as 1).
- No `done` recordings at all → `{ current: 0, longest: 0 }`.

### `calculateTrend(dailyAverages, windowDays)` → `TrendResult`

`dailyAverages` is `buildDailyAverages`' output; `windowDays` is `7` (Week) / `30` (Month) /
`365` (Year) / `'all-time'`. Returns a **discriminated union on `status`**:

| `status` | fields | when |
|---|---|---|
| `'no-data'` | — | `dailyAverages` is empty. UI: home card shows "No sessions yet"; the detail screen hides its stat badge entirely. |
| `'insufficient-history'` | `todayValue`, `todayDate` | Exactly **one** day of scored data (or an all-zero history). UI shows just that value — no delta, no arrow, no sublabel. |
| `'ok'` | `percentChange`, `todayValue`, `todayDate`, `comparisonValue`, `comparisonDate` | Two or more days of data — a real trend. |

- **"today"** = the most recent entry (last in the sorted array) — **not** necessarily the real
  calendar today.
- **Windowed (7/30/365):** the comparison target is `today − windowDays`. If that exact day has
  **no data OR its value is exactly `0`**, walk **further back** day by day to the most recent
  earlier day with real, **non-zero** data. If **nothing is that old** — practice only *started*
  within the window — fall back to the **earliest** non-zero day instead, so a real `'ok'` trend
  still shows over the shorter span (the UI labels it **"Last N days"** rather than the nominal
  "Last 7 days"). Only a lone day of data, or an all-zero history, → `'insufficient-history'`. No
  comparison path ever uses a `0`, so `percentChange` can't divide by zero.
- **`'all-time'`:** the comparison is the **earliest** dated entry with a **non-zero** value.
- `percentChange = ((today − comparison) / comparison) * 100`.

### `buildGraphPoints(dailyAverages, tab)` → `GraphPoint[]`

`tab` is `'week' | 'month' | 'year' | 'all-time'`. Returns a **fixed, contiguous run of buckets**
covering the window, each `{ date: string /* bucket anchor day */, label: string /* short axis
tick */, value: number | null }` — **`value` is `null` for a bucket with no qualifying
recordings**, so the UI gets an even x-axis and decides how to render gaps itself. All windows are
anchored on the **real local today**.

| `tab` | window | buckets | each `value` |
|---|---|---|---|
| `week` | last **7 days** (`today−6 … today`) | 7 daily | that day's average (or null) |
| `month` | last **28 days** | 4 consecutive **7-day** buckets, oldest first | mean of that bucket's **daily averages** (not recording-weighted) |
| `year` | current calendar month + the **11 before** it | 12 monthly | mean of that month's daily averages |
| `all-time` | month of earliest data → current month | **monthly** if span ≤ 24 months, else **quarterly** (`Q1 26`-style labels) | mean of that bucket's daily averages |

`all-time` with no data → `[]`.

### `averageClaritySupportingMetrics(recordings, window)` → `ClaritySupportingAverages` (Part 3)

The **5th** function, added in Epic G Part 3 for the Clarity detail screen's three supporting
badges (**Filler rate / Repetition / Grammar**). **Not a trend metric** — it never feeds
`calculateTrend` / `buildGraphPoints`; it's a windowed read-out of the deterministic signals
(`metrics.filler_word_rate` / `metrics.repetition_count` from `metrics.py`) plus the
model-assessed `grammar_issue_count` that *ground* the Clarity score. Surfaced only on
`/streaks/clarity`.

- **Input** is `ClaritySupportingRecording[]` — `{ status, created_at, metrics: { filler_word_rate,
  repetition_count } | null, grammar_issue_count }` (structural; a widened `RecordingRow` — which
  now selects `metrics` + `grammar_issue_count` — is assignable). Kept structural so `streaks.ts`
  stays free of a `recordings.ts` import.
- **`window`** is the same `TrendWindow` the detail screen's active tab maps to: `7` / `30` / `365`
  / `'all-time'` — so the badges move in lockstep with the headline % and the graph.
- Only **`status === 'done'`** recordings whose local day is `≥ today − (window − 1)` count
  (`'all-time'` = no lower bound). Each of the three fields **averages independently** over just
  the recordings that have a finite value for it — a pre-v3 row missing `metrics` /
  `grammar_issue_count` simply doesn't contribute to that field. A field with nothing to average
  is **`null`** (UI shows `—`); all three `null` → the screen shows one "No supporting metrics for
  this period yet." line instead of a badge card.
- Averages are **not rounded** — the UI formats each (filler rate as a `%`, repetition / grammar
  as one-decimal counts).

### The edge-case behaviors (for the UI)

1. **Zero-skip** (`calculateTrend`, windowed) — a comparison day whose average is **exactly 0** is
   treated as "no usable data there" and the walk-back continues past it. Rationale: a 0 would
   divide-by-zero the % formula, and in practice a genuine 0 daily-average score is
   indistinguishable from a data artifact. A *today* value of 0 is fine (yields `percentChange`
   `-100`); only the *comparison* is zero-skipped.
2. **Short-history fallback** (`calculateTrend`, windowed — Part 3) — if the walk-back finds
   nothing on/before `today − windowDays` (practice started within the window), the comparison
   falls back to the **earliest** non-zero day rather than returning `'insufficient-history'`. So
   **2+ days of data always yields a real `'ok'` trend**; the UI just labels it "Last N days"
   (the actual span) instead of "Last 7 days".
3. **Gap-skip** (`calculateStreak`, `current`) — a fully skipped local day ends the current
   streak. Today itself not-yet-recorded is **not** a gap (the anchor falls back to yesterday);
   two consecutive dayless days *is*.
4. **One-day** (`calculateTrend` → `'insufficient-history'`) — exactly one day of scored data:
   the UI shows that value alone (no delta, no arrow, no sublabel).
5. **No-data** — `buildDailyAverages` → `[]`; `calculateStreak` → `{ current: 0, longest: 0 }`;
   `calculateTrend` → `{ status: 'no-data' }`; `buildGraphPoints('all-time')` → `[]` (the other
   tabs still return their fixed bucket run, all `value: null`). The Streaks screens render a
   distinct "start practicing" state off these rather than showing `0%` / `0`-length graphs — the
   detail screen hides its stat badge entirely.

### Running the streaks tests

The Expo project has **no test runner of its own** (only `backend/` uses pytest). Rather than add
`jest-expo` + its toolchain for five pure functions, `src/lib/streaks.test.ts` runs on **Node's
built-in test runner** (`node:test`, zero new dependencies): **`npm run test:streaks`** compiles
just `streaks.ts` + its test to plain JS under `.expo/streaks-test/` (gitignored) and runs
`node --test` on it. 31 cases — normal paths for all five functions plus the zero-skip,
short-history fallback (Part 3), gap-skip (active / broken-today / broken-yesterday), no-data, and
multi-recording-same-day cases, and (Part 3) `averageClaritySupportingMetrics`' window / non-done
/ per-field-null / empty cases.

**Recommendation if the frontend grows more logic worth testing:** add `jest-expo`
(`npx expo install -- --save-dev jest-expo @types/jest`, run **by the human** per the
[dependency convention](#dependency-installation-convention)) and port these — the assertions
translate directly. The `test:streaks` script is a deliberate stopgap, not the long-term answer.

## Streaks home screen

v3 Epic G Part 2 — `src/app/(tabs)/streaks/index.tsx` (moved into a directory in Part 3),
replacing the Epic A empty placeholder. The **home screen**; the per-metric detail screens
(Week/Month/Year/All Time tabs, full graphs) are **Part 3** — see
[Streaks detail screen](#streaks-detail-screen). Everything is computed **client-side** over the
same recordings list History uses — **no new backend endpoint**, consistent with v2's History
search / calendar.

- **Data:** `fetchRecordings(user.id)` (`src/lib/recordings.ts`), the exact query History's list
  runs, so Streaks and History never disagree about what recordings exist. **Widened in this
  part:** `RecordingRow` and the `select()` now also carry `impact_score` / `clarity_score` /
  `structure_score` (nullable — a pre-v3 row or a missed score stays `null`), which makes
  `RecordingRow` structurally a `StreakRecording`. The History screens don't read those columns,
  they just ride along. **Part 3** moved this fetch shell into a shared hook,
  **`useStreakRecordings()`** (`src/hooks/use-streak-recordings.ts`), so the home screen and the
  three detail screens all read one query and can't disagree — same shape as the History list:
  `useFocusEffect` refetch, `requestSeqRef` out-of-order guard, pull-to-refresh, and a 1.5s poll
  while any row is non-terminal (`TERMINAL_STATUSES`) so a just-uploaded session's scores fold in
  without a manual refresh. Loading / fetch-error (with Retry) / empty ("No recordings yet…")
  states all explicit.
- **Aggregation:** `src/lib/streaks.ts` (Part 1) — `calculateStreak(recordings)` for the header;
  per metric, `buildDailyAverages(recordings, metric)` → `calculateTrend(daily, 7)` +
  `buildGraphPoints(daily, 'week')` for the cards. All in `useMemo`s keyed on `recordings`.
- **Streak header (`StreakHeader`):** three states off `{ current, longest }`:
  - `current > 0` → **"You're on a {current} day streak!"** + **"Longest streak: {longest}
    day(s)"** (the longest line is a confirmed addition, not in the original mockup).
  - `current === 0` but `longest > 0` → **"No active streak right now"** + "Record today to start
    a new one · longest was {longest} day(s)". **Never** renders "0 day streak".
  - `current === 0` and `longest === 0` (brand-new account, no `done` recordings) → **"Start your
    first streak today"** + "Record a session on the Record tab to get going".
- **Metric cards (`MetricCard`), order Impact / Clarity / Structure.** The metric **name**
  (`metricName`, 20px Noto Sans bold) sits **outside / above** the `<Card>`. Card interior is a
  two-row layout:
  - **top row:** a `medium`-weight `textSecondary` short description (top-left) sharing the line
    with the "See details" link (top-right). Descriptions (from `SCORE_METRICS` in `streaks.ts` as
    of Part 3 — was a local `METRICS` array — kept short so they fit on one line beside the link):
    Impact → "Relevance & engagement", Clarity → "Brevity & grammar", Structure → "Speaking
    frameworks".
  - **bottom row:** the **statistic** (bottom-left) beside the **mini line graph** (bottom-right,
    `flex: 1`).
  - the **statistic** is the **7-day % change** as a large bold number (30px Noto Sans bold) via
    **`TrendReadout`** — `src/components/trend-readout.tsx` (with `TrendTriangle`), shared with the
    detail screen. Props: `trend`, `windowLabel` (nominal — "Last 7 days"), `windowDays` (`7`
    here), and a `variant` (`'card'` here — 30px + sublabel; `'compact'` on the detail badge —
    ~17px, number + triangle only). It maps `calculateTrend`'s discriminated union so the card can
    never show `NaN%`:
    - `status: 'ok'` → signed `{+/-}{Math.round(percentChange)}%` in **`Theme.colors.positive`**
      (the green — up) or **`Theme.colors.recordRed`** (down), with a matching `TrendTriangle`;
      a rounded value of exactly `0` shows a plain grey "0%", no triangle. Sublabel = `windowLabel`
      ("Last 7 days"), **auto-shortened to "Last N days"** when the compared span is under 7 days
      (practice only started a few days ago — see `calculateTrend`'s short-history fallback).
    - `status: 'no-data'` → just **"No sessions yet"** (small grey text, no big number).
    - `status: 'insufficient-history'` (exactly one day of data) → just that day's value
      (`{Math.round(todayValue)}%`, grey) — **no sublabel, no triangle**.
  - the **mini line graph** is `MiniLineGraph` (`src/components/mini-line-graph.tsx`) over the
    week-granularity `GraphPoint[]`. This project has **no `react-native-svg`**, so the line is a
    run of thin **rotated `View` segments** between consecutive non-null points (a `null` bucket
    leaves a gap); y-axis pinned to 0–100 so cards are comparable. No baseline/axis line — with
    < 2 plottable points it just renders the dot(s), or nothing. Small/glanceable — the full-size
    graph (`MetricLineGraph`) on the detail screen is a separate component (Part 3, same drawing
    technique).
  - the **"See details" link** is a `Pressable` (`ThemedText type="link"` + a chevron) that, as of
    Part 3, `router.push({ pathname: '/streaks/[metric]', params: { metric: slug } })` to the
    metric's detail screen — `slug` is `'impact'` / `'clarity'` / `'structure'` from
    `SCORE_METRICS`.
- **Trend colours (the confirmation asked for):** declines use the existing
  **`Theme.colors.recordRed`** token (no new negative colour introduced); gains use a **new
  `Theme.colors.positive` / `Palette.positive` (`#2F7A55`)** token — the one green in the app,
  approximate (no Figma sample), added because the warm palette had no green and a warm-palette
  "up" colour would be indistinguishable from body text. Documented in
  [Design system](#design-system)'s `Theme.colors` table.
- **Styling:** flat cream background, Noto Sans, `Theme.colors.card` card fills via `<Card>`,
  `Theme` radius/spacing, no pure white/black — same standing rules as the rest of v2.
- **Verification:** `npx tsc --noEmit`, `expo lint`, and `npm run test:streaks` all clean. **No
  on-device pass yet** — same standing caveat as every Phase 3/4 and Epic C/D step; the
  [v3 wrap-up](#v3-wrap-up) test plan covers the whole Streaks surface (home + detail) in one run.

## Streaks detail screen

v3 Epic G Part 3 — the per-metric detail screen the home cards' "See details" links open, and the
last part of Epic G. Route: **`src/app/(tabs)/streaks/[metric].tsx`** (dynamic, mirroring
History's `history/[id].tsx`), with `src/app/(tabs)/streaks/_layout.tsx` a headerless `Stack` like
`history/_layout.tsx`. Part 3 restructured the former `streaks.tsx` file into the `streaks/`
directory (`index.tsx` = the moved home screen, `[metric].tsx`, `_layout.tsx`) — the
`NativeTabs.Trigger name="streaks"` / web `href="/streaks"` still resolve to `index.tsx`
unchanged, same as History.

- **Route param** is a **slug** — `impact` / `clarity` / `structure` — looked up in `SCORE_METRICS`
  (`streaks.ts`) to get the score column, label, and description. An unknown slug renders a plain
  "That metric couldn't be found." state (no crash).
- **Data:** the shared **`useStreakRecordings()`** hook (same `fetchRecordings()` query as the home
  screen and History), so nothing here can disagree with the home screen. Loading / fetch-error
  (with Retry) states explicit.
- **Layout, top to bottom** (all `Theme` tokens, Noto Sans, flat cream — same design system as the
  rest of v2/v3):
  1. **`HeaderBackLink` "‹ Back to Streaks"** → `router.back()` (the shared header back-link
     component, same as History detail's "Back to History").
  2. **Header row:** the metric name as a large bold heading (28px) with its short description
     under it on the left, and — top-**right**, in the same row — a **small square `<Card>` badge**
     (76×76, shared card UI) showing the **currently-selected tab's** % change via
     `TrendReadout variant="compact"` (~17px number + up/down triangle, **no sublabel** — the tab
     row already names the period). The badge is rendered **only for a real trend**
     (`trend.status === 'ok'`, i.e. 2+ days of scored data) — with no data, or just one day of it
     (nothing to compare against), the badge is omitted and the corner is simply empty.
  3. **Week / Month / Year / All Time tab row** — the minimalist underline style, matching
     History's Calendar/List toggle (v2 Epic D Part 5) for visual consistency. Switching a tab
     recalculates the **stat badge**, the graph, and — on Clarity — the supporting badges, all
     together: the % via `calculateTrend(daily, window)` with `window` = `7` / `30` / `365` /
     `'all-time'`, the graph via `buildGraphPoints(daily, tab)` with `tab` = `'week'` / `'month'` /
     `'year'` / `'all-time'`.
  4. **Full-size graph** in a `<Card>` — `MetricLineGraph` (`src/components/metric-line-graph.tsx`),
     the same rotated-`View`-segment technique as `MiniLineGraph` (no `react-native-svg` — Part 2's
     no-new-dependency choice holds), just larger (200px) with faint 0/25/50/75/100 y-gridlines
     behind the line, a **right-hand y-axis scale** (`25% / 50% / 75% / 100%` in a fixed 36px
     gutter, aligned to the gridlines — `0%` is the baseline, left unlabelled), and a thinned
     x-axis tick row below it (aligned under the plot, not the y-gutter). Null buckets leave gaps
     exactly like
     the mini version; with < 2 plottable points it renders just the gridlines + whatever dot(s)
     exist (the mini's "dots-or-nothing" behaviour, plus the always-on faint gridlines as the
     "baseline"). When there's no scored data at all, a "Record a few scored sessions…" line shows
     under the (gridlines-only) graph.
  5. **Clarity only — three supporting badges** below the graph: **Filler rate / Repetition /
     Grammar**, in the same visual as the old recording-detail Metrics section (Epic F removed
     those from individual recordings — this is their new home). Each is the **average over the
     currently-selected tab's window** via `averageClaritySupportingMetrics(recordings, window)`
     (see [Streaks aggregation](#streaks-aggregation)), so they update in lockstep with the
     headline and graph when you switch tabs. Filler rate renders as a `%` (the stored fraction
     ×100), repetition/grammar as one-decimal counts, `—` for a `null` field; all three `null` →
     one "No supporting metrics for this period yet." line instead of the badge card. **WPM is
     not** one of the badges — an earlier v3 note mentioned "pace (WPM)" here, but Part 3's scope
     fixed the set at these three.
- **`averageClaritySupportingMetrics` is a helper added to `streaks.ts`** (its 5th function) rather
  than computed inline in the screen — testable, and consistent with the other four living there.
  Documented in [Streaks aggregation](#streaks-aggregation). `fetchRecordings()` widened again
  (select + `RecordingRow`) to carry `metrics` + `grammar_issue_count` for it; the History screens
  and the Impact/Structure detail screens don't read them.
- **Verification:** `npx tsc --noEmit`, `expo lint`, `npm run test:streaks` (31 cases) all clean.
  **No on-device pass yet** — see the [v3 wrap-up](#v3-wrap-up) test plan.

## v3 wrap-up

Same spirit as the [Phase 3 assessment](#phase-3-assessment), [Phase 4 exit
checkpoint](#phase-4-exit-checkpoint), and [Epic D wrap-up](#epic-d-wrap-up): does v3's full
scope — the three scores (Epic F) plus the Streaks tab, home screen and all three detail screens
(Epic G) — hold together end-to-end, and what's shaky before calling v3 done?

**v3 is scope-complete.** Epic F (schema `0007_recording_scores.sql`, scoring folded into the
existing Gemini feedback call, the recording-detail display swap) and Epic G (Part 1 aggregation,
Part 2 home screen, Part 3 detail screens) are all built. Type-check, `expo lint`, backend
`pytest`, and `npm run test:streaks` (31 cases) are all clean.

**Built and internally consistent, confirmed by reading the code:**
- Every Streaks screen reads recordings through **one** path — `useStreakRecordings()` →
  `fetchRecordings()`, the same query History's list runs — so Streaks can never disagree with
  History, or with itself, about what recordings exist.
- All aggregation is the five pure functions in `streaks.ts`, unit-tested against hand-written
  cases before any screen consumes them (same discipline as the backend's `metrics.py`). The
  screens only `useMemo` over their output.
- Tab switching on a detail screen drives `calculateTrend`, `buildGraphPoints`, and (Clarity)
  `averageClaritySupportingMetrics` off the **same** `window`/`tab` value, so the headline, the
  graph, and the badges always reflect the same period — there's no way for one to update without
  the others.
- A `NULL` score (pre-v3 row, or a score that missed generation per Epic F's lenient failure) is
  excluded from every aggregation — it never counts toward a daily average, streak, trend, or
  badge.

**Shaky / worth knowing before v3 is "done":**
- **No on-device pass yet across any of v3** — type-check + lint + tests only, same standing
  caveat as every Phase 3/4 and Epic C/D step. The test plan below is the single pass meant to
  close that for the whole Streaks surface.
- **`.expo/types/router.d.ts` was regenerated locally** to teach typed-routes the new
  `/streaks/[metric]` route (it's a gitignored build artifact; `expo start` regenerates it). If a
  fresh clone's `tsc` complains about that route before the dev server has run once, that's why —
  start Metro once.
- **`MetricLineGraph`'s x-axis ticks are evenly spaced, not pinned under their data points** — the
  line's points sit at `i/(n-1)` of the width, but the tick labels are `flex: 1` cells, so a
  label can be up to half a cell off from its point. Fine for a trend glance; noted in case the
  design wants exact alignment later. For dense windows (year = 12, all-time multi-year) the ticks
  are also thinned (first, last, every ~n/6th) so they don't overlap.
- **The detail screen has no pull-to-refresh** (unlike the home screen) — it still refetches on
  focus and polls while a row is non-terminal via the shared hook, so it's not stale, just no
  manual refresh gesture. Deliberate: you reach it from the home screen, which already has one.
- **`getStatusPresentation` / raw error-hex** flagged in [Design system](#design-system) are still
  unaddressed — out of v3's scope, same as they were out of Epic C/D's.

**v3 end-to-end test plan** (one pass):
1. From Streaks home, tap **"See details"** on each of the three cards — confirm you land on the
   right metric's detail screen each time (Impact / Clarity / Structure heading + description).
2. On each detail screen, switch **Week → Month → Year → All Time** — confirm the top-right stat
   badge **and** the graph both change together each time, and both look sensible against your real
   history (no `NaN%`, no empty graph area where there should be data). On a fresh account with two
   days of practice, confirm the Week tab's badge reads e.g. "+12%" (a real trend) and the home
   card's sublabel reads "Last N days". Also confirm the graph's right-hand scale reads
   25% / 50% / 75% / 100%.
3. On a metric with exactly **one** day of scored data — or **no** scored data at all — confirm
   the detail screen's top-right corner is **empty** (no badge). The home card shows just the
   value (one day) or "No sessions yet" (none); the graph shows just faint gridlines (+ any
   dots), not a crash.
4. On **Clarity's** detail screen specifically: confirm the three badges (Filler rate / Repetition
   / Grammar) appear below the graph, and that switching tabs updates their numbers too. Confirm a
   window with no data shows `—` / the "No supporting metrics…" line rather than `NaN`.
5. Tap **"‹ Back to Streaks"** from each detail screen — confirm it returns to the Streaks home
   screen (not History, not a blank screen) with the home cards intact.
6. Record a fresh session, then open Streaks while it's still processing — confirm the poll folds
   its score into the trends/graph within ~1.5s of it reaching `done`, no manual refresh.

**Nothing found that blocks calling v3 complete** — the shakiness above is "unverified on device",
not "known-broken".

## v4 scope

v4 (Phase 7) is **two features** — a global daily-question system and re-practice mode — plus a
small client-side History-filters addition. Full plan detail in docs/PROJECT_PLAN.md Sections 2
and 5. **Epic H** (the global daily-question system) is **complete** — Step 1 (backend) + Step 2
(frontend wiring). **Epic I** (re-practice mode) is **complete** — see
[Re-practice mode](#re-practice-mode). **Epic J Part 1** (chain-building logic + grouped History
**List** card) is **complete** — see [Re-practice chains](#re-practice-chains); **Epic J Part 2**
(the accordion detail screen + per-attempt 3-dot menus) is next. Detailed step writeups land in
their own sections below as each is built, same as every prior epic; this is the reference summary.

**Global daily-question system (replaces v1's per-user random-pick pool).**
- Interview and Story each get exactly **one "question of the day," identical for every user**.
  Miscellaneous is unchanged (free topic, no question).
- **Lazy assignment, no cron.** The day's question for a mode is computed on the first request
  that needs it and stored in a new `daily_questions` table; every later request that day reads
  the stored row. No scheduled/background job — same "no cron" philosophy as the rest of the
  backend (see [Background processing](#background-processing)).
- **Day boundary = US Eastern (`America/New_York`), DST-aware** — real IANA rules via Python
  `zoneinfo`, *not* a fixed UTC-5 offset. Colloquially "EST"; implemented as true US Eastern
  with spring/fall transitions. **This is an interpretation of "daily" and is flagged for the
  human to confirm** — it is the one product decision in Epic H Step 1 that isn't
  mechanically forced.
- **Structural no-repeat guarantee.** A pool question is **retired the instant it's assigned**
  as a daily question (`questions.used_date` set to that day) — never assigned again, for
  anyone. This is why v4 needs **no per-user "recently used" / exclusion tracking at all**:
  the old `pickQuestionForMode` immediately-previous-question exclusion has nothing to
  replace it because the situation it guarded against can no longer occur.
- **Synchronous batch top-up on exhaustion.** When a mode's `used_date IS NULL` pool hits
  zero, the request that triggered it generates **15 new questions** for that mode via one
  Gemini call, **synchronously** (the user is waiting), inserts them, and assigns from the
  new batch. Rare (≤ once per ~15 days per mode); adds one Gemini call's latency to that one
  request. Deliberately *not* the old proactive/event-driven `BackgroundTasks` top-up idea —
  the user needs an actual question back now.

**Re-practice mode (Epic I — done).** A new recording made against an already-answered question
carries a `recordings.re_practice_of` self-reference to the original recording. **That reference
is the only attempt-grouping mechanism History needs** — because a freshly-assigned pool question
is retired on assignment, the *only* way two recordings share a `question_id` is a deliberate
re-practice, so following the `re_practice_of` chain to its root fully groups the attempts
(no need to also group by `question_id`). Epic I built the entry point (a "Re-practice this
question" item in History's 3-dot menu → the Record screen in a read-only re-practice state) and
the write (`re_practice_of` set on upload). Full detail in [Re-practice mode](#re-practice-mode).
The **grouped** History **List** view over these links landed in **Epic J Part 1** (see
[Re-practice chains](#re-practice-chains)); the **accordion detail screen + per-attempt 3-dot
menus** is **Epic J Part 2** (next). Until Part 2, tapping a grouped card opens the most recent
attempt's existing detail screen.

**Favorite / per-attempt actions in grouped History cards.** With re-practice groups, the
3-dot menu splits: **favorite becomes a per-question-group concept** (the group card's star
reads/writes the chain root's `favorite` flag — **done in Epic J Part 1**), while **download
audio / delete audio / delete recording / regenerate report all become per-*attempt* actions**
inside each accordion panel's own 3-dot menu (**Part 2** — the grouped card has no 3-dot menu
yet; per-attempt actions stay reachable via the interim tap-through to a single attempt's detail
screen). This is also the first real consumer of the `favorite` flag, which has had no behavior
attached to it anywhere until now.

**History filters (small addition).** A **mode filter** and a **favorites-only toggle**, both
client-side over the already-loaded list (same approach as v2's search / calendar — see
[History](#history)), alongside the existing search bar.

**Not in v4 — do not build:** additional modes beyond interview/story.

**Old path removed (Epic H Step 2, done):** `src/lib/question-selection.ts`'s
`pickQuestionForMode` + its exclusion logic, and the static `src/lib/questions.ts` pool, were
**replaced** by the server-side path (`GET /questions/daily` via `fetchDailyQuestion` in
`src/lib/api.ts`) and **deleted**. See [Daily questions](#daily-questions).

## Daily questions

v4 Epic H — the global daily-question system. **Step 1** (backend: schema + seed + assignment
logic + endpoint + tests) and **Step 2** (frontend wiring + old-path removal + the FK fix) are
both done. **Epic H is complete.**

**Step 2 (frontend wiring):**
- **The Record flow now reads the endpoint.** `loadQuestion(mode)` in `src/app/(tabs)/index.tsx`
  calls **`fetchDailyQuestion(mode)`** (`src/lib/api.ts` — bearer-token `GET
  /questions/daily?mode=…`, returns `{ id, mode, text }`) instead of the old client-side
  `pickQuestionForMode`. `QuestionArea`'s pool state renders `poolQuestion.text`; its
  loading / error+"Try again" states now point at the endpoint (a cold Render free-tier wake
  can make the first fetch slow — the existing spinner covers it, a `502` shows the message +
  retry). The **custom-question path is unchanged** — "Ask my own question instead" / the input
  box / confirmed-custom all work exactly as in Epic C Part 3.
- **Recording creation stores `question_id`.** `uploadRecording()` (`src/lib/recordings.ts`)
  takes a new `questionId?: string | null` and inserts it as `recordings.question_id`.
  `handleKeepAndUpload` passes `poolQuestion.id` **only** when the question came from the pool
  (not custom-typed, not miscellaneous) — so a pool recording has both `question` text and a
  matching `question_id`, a custom recording has `question` text + `question_id` null, and
  miscellaneous has both null. (`re_practice_of` is set by Epic I — see
  [Re-practice mode](#re-practice-mode); it also threads through `uploadRecording()`.)
- **Old path deleted:** `src/lib/question-selection.ts` (`pickQuestionForMode` + its
  immediately-previous-question exclusion) and `src/lib/questions.ts` (the static 25 + 25
  pool) are **gone**. Their content lives on only in `0009_seed_question_pool.sql` (the DB
  seed) and the backend generator. `RecordingMode` (`src/lib/recordings.ts`) is now a
  self-contained `'interview' | 'story' | 'miscellaneous'` literal (was `QuestionMode |
  'miscellaneous'`); the `QuestionMode` type is gone with `questions.ts`.

**FK-on-delete fix (was flagged in Step 1):** `recordings.re_practice_of`'s foreign key had no
`on delete` action. Migration **`0010_re_practice_of_on_delete.sql`** drops and re-adds it with
**`on delete set null`** — deleting a recording never cascade-deletes its re-practice attempts
and is never blocked by them; an attempt just loses the link and becomes standalone if its
direct parent is removed. The migration looks the constraint name up from `pg_constraint`
rather than assuming the `recordings_re_practice_of_fkey` convention (though that is the name),
then re-adds it under that canonical name. Run it manually in the Supabase SQL editor after
`0008`/`0009`.

**Verification (Step 2):** `npx tsc --noEmit` + `eslint` clean. No on-device pass yet — the
hand-off test plan: select Interview → confirm today's assigned question shows (matches
`daily_questions` for today/interview in Supabase) → record + upload → the `recordings` row has
both `question` text and a matching `question_id`. Repeat for Story. Custom question → `question`
text set, `question_id` NULL. Miscellaneous → both NULL, unaffected. Reopen the app / use a
second account → the **same** daily question appears, not a new random one.

**Schema (migrations `0008_daily_questions.sql` + `0009_seed_question_pool.sql` + Step 2's
`0010_re_practice_of_on_delete.sql`, run manually in the Supabase SQL editor like `0001`–`0007`):**
- `questions.used_date date` (nullable, no default) — `NULL` = unused / available to be
  assigned; a date = the day this question was assigned as a daily question, which retires it
  permanently. Also `questions` now actually gets **rows** for the first time: `0009` seeds the
  25 interview + 25 story prompts (the former `src/lib/questions.ts` static pool — now the
  only place that text lives, since Step 2 deleted that file) as the starting pool, all
  `used_date = NULL`. `0009` is idempotent (guarded by
  `where not exists (select 1 from public.questions)`), so a double-run won't duplicate.
- `daily_questions (date date, mode text check in ('interview','story'), question_id uuid
  references questions(id), primary key (date, mode))` — the one assigned question per mode
  per day. RLS on, open read (`using (true)`), writes via the service-role key only (same as
  `questions`).
- `recordings.question_id uuid references questions(id)` — which pool question a recording
  answered. `NULL` for custom topics, miscellaneous, and every pre-v4 row.
- `recordings.re_practice_of uuid references recordings(id)` — self-FK, set when a recording
  is a re-practice of an earlier one (**written by `uploadRecording()` as of Epic I** — see
  [Re-practice mode](#re-practice-mode); the column landed in `0008`). Step 2's
  `0010_re_practice_of_on_delete.sql` gave it **`on delete set null`** (see the "FK-on-delete
  fix" note below) — deleting a recording with re-practice children no longer FK-violates the
  `DELETE /recordings/{id}` endpoint ([Delete recording](#delete-recording)); the children just
  lose the link.
- Indexes: `questions (mode) where used_date is null` (the candidate lookup),
  `recordings (re_practice_of)` (grouping queries later).

**Assignment algorithm — `get_or_assign_daily_question(mode)` in
`backend/app/services/daily_questions.py`:**
1. Compute "today" as `datetime.now(UTC).astimezone(ZoneInfo("America/New_York")).date()`
   (`eastern_today()`, a module-level helper; takes an optional `now` for tests).
2. **Fast path:** `select question_id from daily_questions where date = today and mode = ?` —
   if a row exists, resolve + return that question, no further work.
3. Otherwise pick a **random** `questions` row for the mode with `used_date is null`.
4. **Exhaustion:** if there are none, call Gemini **synchronously** for a batch of
   `QUESTION_BATCH_SIZE` (15) new questions (`generate_question_batch` — structured-JSON
   response, `{"questions": [string, ...]}` schema, prompted with the existing pool texts to
   avoid near-duplicates), dedupe them against the existing pool + each other, `insert` them
   into `questions` (`used_date` null), and pick a random one of the new rows. A batch that
   comes back empty/unusable raises `DailyQuestionError` → the endpoint 502s.
5. **Concurrency guard:** `insert into daily_questions (date, mode, question_id) values (...)
   on conflict (date, mode) do nothing returning question_id` (via supabase-py
   `.upsert(..., on_conflict="date,mode", ignore_duplicates=True)`).
   - Insert **returned a row** → we won the race → also `update questions set used_date = today
     where id = <candidate>`, then return the candidate.
   - Insert **returned nothing** → a concurrent request already assigned today's question →
     re-read the `daily_questions` row and return **that** question; our candidate is left
     untouched (`used_date` still null), available for a future day.
6. Return the resolved `Question` (`{id, mode, text}`).

`mode` must be `'interview'` or `'story'` (`DAILY_QUESTION_MODES`); anything else (incl.
`'miscellaneous'`) raises `DailyQuestionError`.

**Why this concurrency shape:** the `primary key (date, mode)` + `on conflict do nothing` makes
the *database* the single arbiter of who assigns a given day's question — two near-simultaneous
first-of-the-day requests can both pick a candidate, but only one insert succeeds, only that
one marks its candidate `used_date`, and both return the same resolved question. The loser's
candidate is never marked, so it stays available. (A simultaneous *exhaustion* race is
possible-but-vanishingly-rare: both requests generate a batch, both insert 15, one wins the
assignment, the other's 15 simply stay unused for future days — wasteful, not incorrect.)

**Endpoint:** `GET /questions/daily?mode=interview` (`backend/app/routers/questions.py`) —
standard bearer-token auth (`Depends(get_current_user_id)`), **no ownership check** (the data
isn't user-specific). Returns `{"id", "mode", "text"}`. `400` for a bad/missing `mode`, `502`
(`DailyQuestionError`) if generation was needed and failed. Registered in `app/main.py`.

**Tests** (`backend/tests/test_daily_questions.py`, pytest — same isolation discipline as
`test_processing.py`: a `FakeStore` in-memory implementation of the tiny store protocol
`get_or_assign_daily_question` depends on, so no live Supabase/Gemini): `eastern_today()`
DST-awareness (same UTC wall-clock time lands on different local dates in January vs. July;
plus a spring-forward same-day check), the already-assigned fast path (never calls the
generator), pick-from-pool + `used_date` marking, exhaustion → batch generation → assignment,
an empty-generation → `DailyQuestionError`, the unsupported-mode guard, and the concurrency
guard (a `RacingFakeStore` where a competitor wins the `try_assign`: our candidate is **not**
marked used, and both calls resolve to the competitor's question).

**Dependency:** `tzdata` added to `backend/requirements.txt` — `zoneinfo` needs the IANA
database, which isn't guaranteed present on Windows (local dev) or a slim Linux container.
Re-run `pip install -r requirements.txt -r requirements-dev.txt` from `backend/` before
running the tests.

**Verification:** `pytest` from `backend/` (the new file + the existing suite). **Not yet
exercised against the live Supabase project or a live Gemini call** — that's the manual pass
in the Step 1 hand-off test plan (run the migrations, hit `GET /questions/daily?mode=interview`
twice, confirm one `daily_questions` row, same question both times, exactly one `questions`
row with `used_date` set).

## Re-practice mode

v4 Epic I — lets a user re-record their answer to a question they've already practised. The new
recording stores `recordings.re_practice_of` pointing at the original; that link is the whole
feature at the data level. **No migration** — the column has existed since
`0008_daily_questions.sql` and got `on delete set null` in `0010_re_practice_of_on_delete.sql`
(Epic H). **Type-check + `eslint` clean; no on-device pass yet** — same standing caveat as every
Phase 3/4 and Epic C/D/F/G step.

The **grouped History view** that makes re-practice attempts *visible as a group* is
**Epic J** — Part 1 (the List card) is done, see [Re-practice chains](#re-practice-chains); the
accordion detail screen is Part 2. This section covers only the Epic I write path.

**Entry point — a 3-dot menu item.** `RecordingActionsMenu`
(`src/components/recording-actions-menu.tsx`) gained a **"Re-practice this question"** action
(`RecordingMenuAction` `'re-practice'`, listed first, `arrow.counterclockwise` icon, not
destructive, no confirmation). It's shown via a new `canRePractice` prop, computed by
**`canRePracticeRecording()`** (`src/lib/recordings.ts`): the recording's `mode` is `interview`
or `story` **and** it has a question (a pool `question_id` **or** custom `question` text). So it
**never appears on Miscellaneous**, and never on an interview/story row that somehow has no
question. Wired identically on the **History list card** (`history/index.tsx` →
`RecordingListItem`) and the **detail screen** (`history/[id].tsx` header menu) — same
`canRePracticeRecording` guard, same handler shape, consistent with every other menu action.

To make `question_id` available for the guard and the handoff, **`fetchRecordings()` and
`fetchRecordingById()` both now select `question_id`** (added to `RecordingRow` /
`RecordingDetail`) — the History screens didn't read it before.

**The handoff — route params into the shared Record screen.** Tapping the menu item calls
`router.navigate({ pathname: '/', params: rePracticeNavParams(recording) })`. **`rePracticeNavParams()`**
(`src/lib/recordings.ts`, shared by list + detail so they can't drift) returns
`{ rpSource, rpMode, rpQuestion, rpQuestionId, rpTs }` — the original recording's id, mode,
question text, pool `question_id` (`''` when none), and a `Date.now()` **nonce** (`rpTs`).

The Record screen (`src/app/(tabs)/index.tsx`) is the same component three flows already share
(mode-select→pool-pick, mode-select→custom, and now re-practice). It reads the params with
`useLocalSearchParams` and a `useEffect` **consumes** them: it dedupes on `rpTs` (a ref —
re-focusing the tab later doesn't re-fire; re-practising the same recording twice *does*, because
`rpTs` changes), then clears the params via `router.setParams` as a second guard, then calls
`enterRePractice(ctx)`. `enterRePractice`:
- runs the **same recording-cap check** `handleSelectMode` does (`getActiveRecordingCount` vs
  `MAX_RECORDINGS_PER_USER`) — **no exemption for re-practice**. On a cap hit it drops to
  `flowScreen: 'mode-select'` with `blockedByCap` true, so the user sees the existing
  `CapBlockedCard`. Fails open on a check error, same as `handleSelectMode` (the Postgres trigger
  `0004` is the real backstop).
- otherwise sets a new **`rePractice` state** (`RePracticeContext` = `{ sourceId, mode, question,
  questionId }`), `selectedMode`, and `flowScreen: 'record'` — **straight to the record screen,
  no mode-select animation, no `QuestionArea`, no pool fetch, no custom-input toggle**. The
  question shows **read-only** in the record screen's existing question banner (its label reads
  "Re-practising this {Interview|Storytelling} question").
- The "‹ Change mode" back link still works as an escape hatch — `handleBackToModeSelect` now
  also clears `rePractice`.

**Writing `re_practice_of`.** `handleKeepAndUpload` branches on `rePractice`: when set, `mode` /
`question` / `questionId` come **verbatim from `rePracticeContext`** (not from
`poolQuestion`/`customQuestion`, which aren't populated in this flow), and `uploadRecording()` is
passed a new **`rePracticeOf: rePractice.sourceId`** arg → inserted as `recordings.re_practice_of`.
It always points at **the exact recording the menu was opened from** — if that recording is
itself a re-practice of something else, this still points at it directly, not at a deeper
ancestor. Walking the chain to a root is Epic J's job. A normal (non-re-practice) recording
passes `rePracticeOf: null` and is unchanged.

**Post-recording behaviour is unchanged** — after upload the screen stays on Record with inline
`ProcessingStatus` and "See more details" (v2 Epic C Part 4). No re-practice-specific
post-recording UI; the visible comparison is Epic J.

**Test plan (hand-off, no on-device pass yet):** from an Interview recording's 3-dot menu (list
*and* detail), tap "Re-practice this question" → land directly on the record screen with the
exact same question shown read-only (no toggle, no pool load, no custom input) → record + upload
→ check the new `recordings` row in Supabase: `mode` and `question` match the original,
`question_id` matches iff the original was a pool pick, and **`re_practice_of` = the original
recording's id**. Confirm Miscellaneous recordings never show the menu option. Confirm the cap
still blocks at 30 (the `CapBlockedCard` appears instead of the record screen).

## Re-practice chains

v4 Epic J — grouping a question's re-practice attempts (linked by `recordings.re_practice_of`,
written by Epic I) into one History entry. **Part 1 is done** — the chain-building logic + the
grouped **List** card. **Part 2** (next) is the real accordion detail screen with per-attempt
3-dot menus. **No migration, no backend change** — this is entirely client-side over the
already-fetched recordings list (same approach as v2's History search / calendar and v3's
Streaks aggregation). Type-check / `eslint` / `npm run test:chains` (11 cases) clean; no
on-device pass yet — same standing caveat as every Phase 3/4 and Epic C/D/F/G/I step.

### `buildChains` (`src/lib/re-practice-chains.ts`)

Pure, dependency-free, unit-tested (`re-practice-chains.test.ts`, Node's built-in runner via
**`npm run test:chains`** — same stopgap setup as `test:streaks`, no new dependency). Same
discipline as `streaks.ts`: verified against hand-written cases before any screen consumes it.

**Contract.** `buildChains<T extends ChainRecording>(recordings: T[]): RePracticeChain<T>[]`
where `ChainRecording = { id, re_practice_of: string | null, created_at }` (a widened
`RecordingRow` is assignable — `fetchRecordings()` now also selects `re_practice_of`). Each
`RePracticeChain` is `{ rootId: string, members: T[] }`:

- **Grouping** follows `re_practice_of` links to a **root** — a chain is a root recording plus
  every recording that points at it or at another chain member, directly or transitively.
- A recording with **no re-practice relationship** (`re_practice_of` null) is its **own
  single-member chain**.
- A recording whose `re_practice_of` points at an id **not in the input list** (original
  deleted — the FK is `on delete set null` so the value is usually already null; also covers a
  filtered/paginated list missing the parent) **starts a fresh chain of its own** — never a
  crash, never dropped. A chain with a **missing middle link** splits at the gap.
- `rootId` is **always one of `members`** (never an absent recording) — for a single-member
  chain it's just that recording's id. The History list reads the **root's `favorite`** flag
  for the group card's star.
- `members` are sorted **most-recent-first** by `created_at` (ties broken by `id` desc).
- Returned **chains are ordered by where each chain's first member appears in the input** — the
  History list passes recordings already sorted newest-first, so each chain surfaces at its
  most-recent attempt's position.
- **Cycle-safe** — a malformed `re_practice_of` cycle stops the walk instead of hanging.

Because a freshly-assigned daily-pool question is retired on assignment (Epic H), the only way
two recordings relate to one question is a deliberate re-practice — so `re_practice_of` alone
fully groups a question's attempts; there's **no need to also group by `question_id`**.

### Grouped List card (`GroupedRecordingListItem` in `src/app/(tabs)/history/index.tsx`)

`HistoryScreen` now builds `allChains = buildChains(recordings)` and filters **whole chains**:
a chain stays visible if **any** member matches the search term / day filter (so a group
appears whenever any attempt would have appeared individually), and the card shows the whole
chain. `keyExtractor` is `chain.rootId`; the empty-state checks key off `visibleChains.length`.

- A **single-member chain** renders **exactly** the pre-Epic-J `RecordingListItem` — no visual
  change, all existing per-row actions (favorite / 3-dot menu / regenerate / delete / download /
  re-practice) unchanged.
- A **multi-member chain** renders one `<Card>` showing:
  - the **shared question** as the bold heading (a member's `question` text, not any attempt's
    `title`);
  - an **"×N attempts"** line (`textSecondary`), plus `· Last attempt failed` / `· Processing…`
    when the most-recent attempt isn't `done`;
  - the **mode pill** (all members share a mode) + the **most-recent attempt's** date, in the
    meta row;
  - the **favorite star**, reflecting/toggling the **chain root's** `favorite` (via the
    existing `handleToggleFavorite(chain.rootId, …)` — optimistic, keyed by root id).
  - **No 3-dot menu** — per-attempt actions (download / delete audio / delete recording /
    regenerate) are Part 2's per-panel menus. Until then they're reachable by tapping through.
- **Interim tap-through:** tapping a grouped card `router.push`es the **most recent** member's
  existing (ungrouped) `history/[id]` detail screen. **Part 2 replaces this** with the accordion.

### Part 1 test plan (hand-off, no on-device pass yet)

With ≥1 re-practiced recording from Epic I testing: open History → **List** and confirm the
question shows as **one** card (not two), with **×2 attempts** (or however many), the right mode
pill, and the **most recent** date. Confirm every non-re-practiced recording looks **exactly**
as before. Tap the grouped card → confirm it opens the **most recent** attempt's detail screen.
Toggle the grouped card's favorite star → confirm in Supabase that it's the **root** recording's
`favorite` that flipped. Search for text that only one attempt's question/title contains →
confirm the group still appears.

## Database

Supabase Postgres, no ORM — query via the `supabase-js` client (`src/lib/supabase.ts`) using
`.from(...)`, not raw SQL from the app. Schema lives as versioned SQL in
`supabase/migrations/` (`0001_initial_schema.sql`, `0002_storage_bucket.sql`, …) — that's the
source of truth; don't assume a table shape without checking there first, and add new schema
changes as a new numbered migration file rather than editing an applied one.

- `recordings` — one row per practice session: mode, question/topic, `audio_path`, `status`
  (`pending`/`processing`/`done`/`failed`), `transcript`, `feedback`, `title` (nullable text,
  v2 Epic D Part 1, migration `0005_recording_title.sql` — a short 2-4 word auto-generated
  label; see [Recording titles](#recording-titles)), `title_edited_by_user` (boolean, not null,
  default `false` — v2 Epic D Part 7, migration `0006_title_edited_by_user.sql`; set `true` only
  by `updateRecordingTitle()`'s hand-edit save, read by `process_recording()` to skip
  overwriting a hand-set title on a later run — see [Recording titles](#recording-titles)'s "Not
  overwriting a hand-edited title (Part 7)" subsection), `metrics` (jsonb, Phase 2
  Step 4 — see [Metrics](#metrics) for the exact shape stored),
  `impact_score` / `clarity_score` / `structure_score` / `grammar_issue_count` (all nullable
  `integer`, no default, no backfill — v3 Epic F Step 1, migration `0007_recording_scores.sql`;
  the first three are 0–100 scores from the same Gemini feedback call, `grammar_issue_count` a
  non-negative Clarity grounding input; written on every pipeline run — `title_edited_by_user`
  does NOT guard them, nothing lets a user hand-edit a score — and a missing/garbage one stays
  NULL without failing the recording; see [v3 scope](#v3-scope) and
  [Feedback generation](#feedback-generation)),
  `favorite`/`audio_deleted` flags. `favorite` is a personal star marker (renamed from `saved`,
  which used to mean "exempt from the old 7-day auto-delete") — it's no longer tied to any
  deletion behavior. As of Phase 3 Step 4 it's toggleable from the History list and detail screen
  (star icon, direct Supabase update via `setFavorite()` in `src/lib/recordings.ts` — see
  [History](#history)'s "Favorite toggle" bullets) — **it is purely a manual marker for the user's
  own reference, with no automated behavior tied to it anywhere**: no retention exemption, no
  confirmation step before Step 5 deletes a favorited recording's audio. Don't let a future step
  assume favoriting protects a recording from anything. `report_generated_at` has been removed — it
  only existed to compute the old
  7-day window. Retention is now a per-user cap, `MAX_RECORDINGS_PER_USER = 30` (counting rows
  where `audio_deleted = false`) — as of Phase 3 Step 3 this is enforced, not just defined; see
  [Recording cap](#recording-cap) for where and how. **Audio** deletion is manual (the 3-dot
  menu's "Delete audio" per history row — built in Phase 3 Step 5, see
  [Audio delete](#audio-delete)) and only ever clears `audio_path`/sets `audio_deleted = true`;
  it never removes the row. As of v2 Epic D Part 4 the menu also has a **"Delete recording"**
  action that *does* remove the whole row (+ its audio) — see [Delete recording](#delete-recording).
  That runs through a backend endpoint on the service-role client, so it needs no `recordings`
  DELETE RLS policy (none was added).
- `questions` — the global question pool. `id`, `mode`, `prompt_text`, `created_at`, plus
  `used_date date` (nullable — v4 Epic H Step 1, migration `0008_daily_questions.sql`; `NULL`
  = unused/available, a date = the day it was assigned as a daily question, which retires it
  permanently). **Seeded for the first time in v4** — `0009_seed_question_pool.sql` inserts the
  25 interview + 25 story prompts (the former `src/lib/questions.ts` pool, now deleted) as the
  starting pool. Read by the backend's `daily_questions.py` (service-role); the frontend never
  reads this table directly — it goes through `GET /questions/daily`. Through v1–v3 this table
  was an unqueried stub.
- `daily_questions` — v4 Epic H Step 1, migration `0008_daily_questions.sql`. `(date, mode,
  question_id)` with `primary key (date, mode)` — the one question-of-the-day per mode per day.
  Written lazily by `get_or_assign_daily_question` (service-role); the PK doubles as the
  concurrency guard for first-of-the-day assignment. See [Daily questions](#daily-questions).
- `recordings` also gains (v4 Epic H, migration `0008_daily_questions.sql`):
  `question_id uuid references questions(id)` (which pool question this recording answered —
  `NULL` for custom topics / miscellaneous / every pre-v4 row; **written by `uploadRecording()`
  as of Epic H Step 2** — only for a daily-pool pick) and `re_practice_of uuid references
  recordings(id) on delete set null` (self-FK — set when a recording re-practices an earlier
  question; **written by `uploadRecording()` as of Epic I** — see
  [Re-practice mode](#re-practice-mode); the `on delete set null` was added in migration
  `0010_re_practice_of_on_delete.sql`, Epic H Step 2, so deleting a parent recording nulls its
  attempts' link instead of FK-violating).

RLS is **on** for both tables and scoped to `user_id = auth.uid()` on `recordings` (select/insert/
update only — **still no DELETE policy, deliberately**: the v2 Epic D Part 4 "Delete recording"
feature deletes rows through a backend endpoint using the service-role client, which bypasses RLS,
so no client-facing DELETE policy was opened up — 0001's "add one deliberately if a delete feature
shows up" note is satisfied by routing deletion server-side instead). `questions` and
`daily_questions` are both open-read (no user-specific data); all writes to them go through the
service-role key only, bypassing RLS. Storage (`recordings-audio` bucket, private) mirrors this: objects must
live under a `{user_id}/...` path prefix, enforced by storage RLS policies in
`0002_storage_bucket.sql`.

## Auth

- The auth context/provider lives at `src/lib/auth-context.tsx` (`AuthProvider` + `useAuth()`).
  It wraps the whole app from `src/app/_layout.tsx`, holds `session`/`user`/`loading` state via
  Supabase's `onAuthStateChange`, and exposes `signUp` / `signIn` / `signOut` — these already
  convert raw Supabase `AuthError`s into a plain `error: string | null` for screens to show
  directly, so screens should never touch `error.message` from a raw Supabase call themselves.
- Routes are split into two Expo Router groups off `src/app/`: the signed-in side — `(tabs)/` (the
  real app — Record, History, Streaks; see [Navigation shell](#navigation-shell)) plus the non-tab
  `settings.tsx` ([Settings screen](#settings-screen)), both inside one `Stack.Protected` block —
  and two ungrouped signed-out screens, `login.tsx` and `signup.tsx`. `src/app/_layout.tsx`
  reads `useAuth()` and renders one side or the other via `Stack.Protected` — signed-in users only
  ever see `(tabs)`/`settings`, signed-out users only ever see login/signup, and a loading screen
  covers the initial session check on boot. **Future screens that only make sense when logged in
  belong under `(tabs)/`** (or as another screen in the protected block, like `settings`) — don't
  add ad hoc auth checks inside individual screens, the routing layer already handles it.
- Sign-out lives on the [Settings screen](#settings-screen) (v2 Epic A Step 2), reached via the
  header profile icon — migrated there from the old Phase 1 button on the Record tab, which is
  gone.
- Basic client-side validation (non-empty, email shape, min password length) lives in
  `src/lib/auth-validation.ts`, shared by both screens.
- Email confirmation is **on by default** for new hosted Supabase projects — an account created
  via `signUp` gets no session back until the confirmation link is clicked, which `auth-context`
  surfaces as `needsEmailConfirmation` (the signup screen shows a "check your email" notice in
  that case rather than silently doing nothing). To turn it off for solo/local testing: Supabase
  dashboard → **Authentication → Sign In / Providers → Email**, toggle off **Confirm email**. This
  wasn't verified against this project's actual dashboard state — check it directly and flip it
  per your own testing needs; flip it back on before any real users sign up.

## Navigation shell

v2 Epic A Step 1 — a structural-only change (no visual redesign, no new features): the bottom nav
is now **three tabs, in this order: Record / History / Streaks**, matching the design screenshots.
Defined in `src/components/app-tabs.tsx` (native, `NativeTabs` from
`expo-router/unstable-native-tabs`) and its `app-tabs.web.tsx` counterpart (custom `Tabs`/`TabList`
UI), both rendered from `src/app/(tabs)/_layout.tsx`.

- **Record** is the renamed/restructured former **Home** tab. The route file is still
  `src/app/(tabs)/index.tsx` and the recording flow it renders (mode-select → question → record →
  upload → inline status) is **completely unchanged** — only the tab's `<Label>` moved from "Home"
  to "Record". Any older "Home tab" reference elsewhere in this doc means this same screen.
- **History** — `src/app/(tabs)/history/` — unchanged in this step; its redesign is Epic D.
- **Streaks** — `src/app/(tabs)/streaks/` (was `streaks.tsx` — became a directory in v3 Epic G
  Part 3, `index.tsx` + `[metric].tsx` + `_layout.tsx`) — was an intentional empty placeholder
  through v2; **v3 Epic G filled it** with the real streak header + three metric cards
  ([Streaks home screen](#streaks-home-screen)) and the per-metric detail screens
  ([Streaks detail screen](#streaks-detail-screen)).
- No dedicated Streaks icon asset yet — the native tab uses an `sf="flame"` SF Symbol placeholder,
  same "swap when a real asset exists" situation as History still reusing the scaffold's
  `explore.png`.
- Profile icon + Settings screen were **not** part of Step 1 — added in Step 2, see
  [Settings screen](#settings-screen) below.

## Settings screen

v2 Epic A Step 2 — a structural/functional step, not the visual redesign (Epic B restyles this
along with everything else). Built with existing app patterns (`SafeAreaView` + `ThemedText`/
`ThemedView`, SF Symbol icons), no polish.

- **Route:** `src/app/settings.tsx` — a **non-tab stack screen**, not a fourth bottom-nav item.
  Registered in `src/app/_layout.tsx` inside the same `Stack.Protected guard={!!session}` block as
  `(tabs)`, so it's only reachable when signed in. Reached via `router.push('/settings')`; the
  screen's own "‹ Back" link is `router.back()`.
- **Profile icon:** `src/components/profile-button.tsx` (`ProfileButton`) — an SF Symbol
  (`person.crop.circle`) placeholder, same convention as `FavoriteStar` / the Streaks tab icon.
  **Visibility rule:** rendered only on the three main tab screens — Record
  (`src/app/(tabs)/index.tsx`), History (`src/app/(tabs)/history/index.tsx`), Streaks
  (`src/app/(tabs)/streaks/index.tsx`) — in a top header row. **Deliberately absent from every
  detail/sub-screen** (History's detail view `history/[id].tsx` and the Streaks metric detail
  screen `streaks/[metric].tsx`, both of which keep just their own "‹ Back to …" link). Any new
  sub-screen should follow the same rule — don't add `ProfileButton` to it.
- **What it shows:** the signed-in user's email (`useAuth().user?.email`) and a single **"Sign
  Out"** button calling `useAuth().signOut()`. On success the root navigator's auth guard flips and
  swaps the whole stack out for the login screen — the screen doesn't navigate itself; a failed
  sign-out shows an inline error and re-enables the button.
- **Sign-out migration:** the Phase 1 temporary "Sign out" button on the Record/Home tab
  (`src/app/(tabs)/index.tsx`) has been **removed** — Settings is now the only place sign-out
  lives, no duplication. (The Record screen still shows a "Logged in as {email}" line from Phase 1;
  that's cosmetic and left for Epic B to reconcile.)

## Design system

v2 Epic B. **Part 1** defined the token layer; **Part 2** (this pass) wired it in: Noto Sans
loads at boot, `ThemedText` renders it, the v1 `Colors` object is repointed at the warm palette
(so every screen reading `useTheme()` / `ThemedText` / `ThemedView` picks up the redesign without
being individually rewritten), all pure white/black is gone, the background is flat cream
everywhere, and the bottom nav is styled to the Figma spec as far as the system tab bar allows.
Full per-screen restyling of Record and History (cards, pills, buttons, spacing) is **deferred to
Epic C/D**, which rebuild those screens — Part 2 was a light-touch app-wide pass, not a
screen-by-screen redesign. Epic C (the Record flow) has now started — see the
[Epic C Part 1](#epic-c-part-1--mode-select-screen-restyle) subsection below; it is multi-part and
Part 1 covered only the mode-select screen's look.

- **Where it lives:** `src/constants/theme.ts` — one module, extended, not replaced. Exports:
  `Colors` (v1, light/dark keyed, **now pointing at the warm palette** — both `light` and `dark`
  resolve to the same values), `Fonts`/`Spacing`/`BottomTabInset`/`MaxContentWidth` (v1,
  unchanged), and the v2 layer: `Palette` (raw hex, single source of truth), `NotoSans` (family
  names), `Theme` (`.colors` / `.radius` / `.spacing` / `.typography`), `ThemeColorToken`.
- **v2 is a single warm light theme** — `Theme` is a flat object, not light/dark keyed. `Colors`
  stays light/dark keyed only for backward compatibility; the two halves are identical. App is
  pinned to light: `app.json` `userInterfaceStyle: "light"`, and `src/app/_layout.tsx` gives
  React Navigation a cream container theme so transitions never flash a white/grey ground.
- **`textPrimary` was corrected `#1F0400` → `#2D1306`** (`Palette.brownBlack`). The old value was
  pixel-sampled from a PNG and carried compression noise; `#2D1306` is the authoritative Figma
  value. Applied via the `Colors`/`Palette` repoint, so it propagated to every `ThemedText` and
  every `theme.text` reader automatically — no per-screen edits.
- **Flat background, no gradient.** Part 1's `backgroundGradientStart` / `backgroundGradientEnd`
  tokens and `Palette.peach` are **removed** — the real spec is a single flat `#FFFAF6`. No
  `expo-linear-gradient` / `react-native-svg` gradient was ever added; `Theme.colors.background`
  is the one screen-background value.

**`Theme.colors`** (all values from `Palette`):

| Token | Hex | Role |
|---|---|---|
| `background` | `#FFFAF6` | screen background — flat, everywhere |
| `textPrimary` | `#2D1306` | primary text, headings, most icons, inactive nav icons/label (Figma-authoritative) |
| `textSecondary` | `#56453D` | muted/secondary text — best-available, no dedicated Figma sample (approximate) |
| `card` | `#FFFEFE` | card / raised surface fill |
| `cardBorder` | `#56453D` | 1px **inset** border on a card surface (Figma-authoritative) |
| `border` | `#DFCFC7` | hairline borders, dividers, unselected outlines — **also the active nav-tab pill** |
| `accent` | `#56453D` | fill for a selected/active control (e.g. active mode pill) — approximate, exact value in Epic C |
| `onAccent` | `#FFFEFE` | text/icon on top of an `accent` fill |
| `recordRed` | `#C53030` | the record button — approximate, exact value in Epic C |
| `favoriteGold` | `#F3BF16` | a filled favorite star — approximate |
| `modeInterview` / `modeStory` / `modeMiscellaneous` | `#E2CDF8` / `#F8CDE5` / `#CDE3F8` | mode pill bg (unselected) — approximate |
| `modeInterviewText` / `modeStoryText` / `modeMiscellaneousText` | `#3E0877` / `#7F084C` / `#093C6B` | mode pill **label** colour — saturated tone of the matching pill bg (Epic D Part 3, from the design) |
| `navStroke` | `#FFFEFE` | the 2px stroke around the nav capsule (Figma-authoritative) |
| `navIconActive` | `#B63700` | active bottom-nav tab icon (Figma-authoritative) |
| `shadow` | `#BEA398` | drop-shadow tint — **cards and** the nav capsule (Figma-authoritative; RN approximates spread/blur) |
| `link` | `#4B75DF` | **all** link / interactive text, app-wide — the single source of truth (Epic D Part 1). A deliberate warm-palette exception; see "Link colour consolidation" |
| `positive` | `#2F7A55` | an upward / improving trend — the Streaks metric cards' "+%" reading + up-triangle (v3 Epic G Part 2). The one green in the app; approximate, no Figma sample. A *declining* trend reuses `recordRed`, not a second negative token |

Old `navActive` / `navActiveIcon` (`#FF8040` / `#FF9966`, pixel-sampled in Part 1) are **removed** —
the Figma nav spec superseded them (capsule is `background`, active pill is `border`, active icon
is `navIconActive`). `navShadow` was renamed **`shadow`** once the same tint started backing card
shadows too.

**`Theme.radius`:** `sm: 8`, `card: 16`, `lg: 24`, `pill: 999`. **`Theme.spacing`** (4pt): `xs: 4`,
`sm: 8`, `md: 12`, `lg: 16`, `xl: 24`, `xxl: 32`, `xxxl: 48`. **`Theme.shadows.card`**: `{ shadowColor:
shadow, shadowOpacity: 0.25, shadowOffset: {0, 4}, shadowRadius: 18, elevation: 6 }` — the Figma card
shadow (`#BEA398` @ 25%, y+4, ~30 blur + 5 spread; RN has no spread so `shadowRadius` stands in).
**`Theme.typography`:** `fontFamily` `{ regular, medium, semiBold, bold }` → `NotoSans_400Regular` /
`_500Medium` / `_600SemiBold` / `_700Bold`; `variants` (`display` 40 / `title` 28 / `heading` 20 /
`body`+`bodyMedium` 16 / `label` 14 / `caption` 12), each `{ fontSize, lineHeight, fontFamily }`,
weight carried by family.

### Cards

`src/components/card.tsx` — **`<Card>`**, the shared raised-surface component: near-white fill
(`theme.backgroundElement` = `#FFFEFE`), a **1px inset** `#56453D` border (`Theme.colors.cardBorder`;
RN borders are always drawn inside the box, which is what "inside" in the spec means), and the
`Theme.shadows.card` drop shadow. Takes `View` props; pass padding / gap / alignment / an overriding
`borderRadius` via `style`. Default radius is `Theme.radius.card` (16).

Applied to every content card in the app, replacing bare `<ThemedView type="backgroundElement">`:
- `src/app/settings.tsx` — the "Signed in as" card.
- `src/app/(tabs)/index.tsx` — `playbackCard` (the post-record / cap-blocked / question-select
  panel), `questionBanner`, `permissionCard`, and the mode-select cards (`ModeSelect` now wraps a
  `<Card>` in the `Pressable` instead of a hairline-bordered `Pressable`).
- `src/app/(tabs)/history/index.tsx` — the list row and the fetch-error card.
- `src/app/(tabs)/history/[id].tsx` — the audio-deleted / no-audio / audio-error notices, the
  failed / still-processing notices, and the metrics card.

**Deliberately NOT converted** (kept their own treatment): the upload-error / question-lookup-error
cards in `index.tsx` (`<ThemedView type="background">` with a red `#e5484d` border — an error banner,
not a content card), and the unused scaffold components (`hint-row.tsx`, `collapsible.tsx`).
`iOS shadows need a non-transparent background and are clipped by `overflow: 'hidden'` — `<Card>`
sets a background; don't add `overflow: hidden` to one that should cast a shadow.

### Noto Sans loading

- Package: **`@expo-google-fonts/noto-sans`** (`^0.4.2`), added to `package.json`. Bundles the TTFs,
  no native code — Expo Go safe.
- `src/app/_layout.tsx` calls `useFonts({ NotoSans_400Regular, _500Medium, _600SemiBold, _700Bold })`
  (subpath imports, so only those 4 weights bundle, not all 9 + italics) and returns `null` until
  fonts resolve — the native splash stays up, then `AnimatedSplashOverlay` hides it as before. A
  load **error** is logged and the app proceeds on the system sans-serif fallback rather than
  wedging.
- `src/components/themed-text.tsx` now sets `fontFamily` (not `fontWeight`) per `type`:
  `default`/`small` → medium, `smallBold` → bold, `title`/`subtitle` → semiBold, `link`
  → regular, `code` → unchanged (`Fonts.mono`). Sizes/line-heights unchanged from the v1 scale.
  (The old `linkPrimary` `type` was folded into `link` in the Epic D Part 1 colour
  consolidation — see [Design system](#design-system)'s "Link colour" note.)
- The `Theme.typography.variants` are still the eventual target; `ThemedText`'s `type` prop and the
  `variants` get reconciled into one system in Epic C/D.

### Nav bar (bottom tabs)

The Figma nav spec (from the actual file, treat as exact): label **Noto Sans Regular `#2D1306`,
constant regardless of active state** — only icon colour and pill vary; capsule background
`#FFFAF6` with a **2px `#FFFEFE` stroke** (deliberate, visible); drop shadow `#BEA398` @ 15%, 0/0
offset, 25 spread, 100 blur; active-tab pill `#DFCFC7` (= `Theme.colors.border` — the 50%-opacity
`#BEA398` flattens to exactly this, reuse the token, don't duplicate); active icon `#B63700`;
inactive icon `#2D1306`; Record tab icon = a microphone.

**Native (`src/components/app-tabs.tsx`) — still `NativeTabs` (the system UIKit tab bar), styled as
far as it allows** (the decision to keep `NativeTabs` and approximate, rather than build a custom
JS tab bar, was made deliberately for this pass):
- ✅ capsule background → `backgroundColor={Theme.colors.background}`
- ✅ label colour constant + Noto Sans → `labelStyle={{ default: {...}, selected: {...} }}` with the
  same `color: textPrimary` and `fontFamily: NotoSans.regular` in both states
- ✅ icon colours → `iconColor={{ default: textPrimary, selected: navIconActive }}`
- ✅ Record = mic (`sf={{ default: 'mic', selected: 'mic.fill' }}`); History = `list.bullet`;
  Streaks = `star`/`star.fill` (was the leftover `flame`). No more `home.png`/`explore.png`.
- ⚠️ `shadowColor={Theme.colors.shadow}` — on iOS this tints the tab bar's **top hairline
  separator**, NOT a real drop shadow. UIKit exposes no spread/blur bar-shadow API. Closest
  single knob; **expect to revisit on a device.**
- ❌ **2px capsule stroke** — no `NativeTabs` API. Not done.
- ❌ **real drop shadow** (spread + blur) — not done (see ⚠️ above for the partial stand-in).
- ❌ **tan active-tab pill on iOS** — `indicatorColor` is Android/web only; it's set to
  `Theme.colors.border` but has no effect on the iOS system bar. Not done.
- ❌ **icon size / icon-to-label gap** — the system tab bar sizes SF Symbol icons and spaces them
  from the label itself; `NativeTabs` exposes no `iconSize` / inset / `titlePositionAdjustment`
  passthrough for it. Not adjustable.

  The ❌ items all require replacing `NativeTabs` with a custom floating JS tab bar — a future call,
  not this pass.

**Web (`src/components/app-tabs.web.tsx`) — a custom component, so it renders the full spec:** the
`#FFFAF6` capsule, the 2px `#FFFEFE` `borderColor`, an approximated `shadow*` (no "spread" on
web/RN, so `shadowRadius` is bumped to compensate — tune later) + `elevation`, and the `#DFCFC7`
active-tab pill. Label colour constant. Scaffold cruft removed (the "Expo Starter" brand text is
now "Brevado", the Docs external-link is gone). Web isn't a shipping target but the file compiles
and previews correctly.

**`app.json` `web.output` is `"single"`, not the scaffold default `"static"`.** `"static"` makes
`expo start` / `expo export` **prerender every route in Node**, and that path crashes:
`src/lib/supabase.ts` hands `AsyncStorage` to `createClient` as the auth store, AsyncStorage's web
build reads `window` at import/init, and `window` doesn't exist in Node → `ReferenceError: window
is not defined` inside Supabase's `_initialize`, which takes down the whole dev server (so iOS
testing breaks too, even though nothing web-related is wanted). `"single"` = client-rendered SPA,
no Node prerender, so that path never runs; `w` / web preview still work. If static web is ever
actually needed, the real fix is a platform-conditional auth storage in `supabase.ts` (skip
`AsyncStorage` when `Platform.OS === 'web'`).

### White / black sweep (Epic B Part 2 global rule: never pure `#FFFFFF` / `#000000`)

Every hardcoded pure white/black in `src/` was found and replaced. Full list of what was using it:

| File | Was | Now | What it is |
|---|---|---|---|
| `src/constants/theme.ts` | `Colors.light.text: '#000000'` | `Palette.brownBlack` (`#2D1306`) | v1 light text token |
| `src/constants/theme.ts` | `Colors.light.background: '#ffffff'` | `Palette.cream` (`#FFFAF6`) | v1 light bg token |
| `src/constants/theme.ts` | `Colors.dark.text: '#ffffff'` | `Palette.brownBlack` | v1 dark text token (now = light) |
| `src/constants/theme.ts` | `Colors.dark.background: '#000000'` | `Palette.cream` | v1 dark bg token (now = light) |
| `src/app/login.tsx` | `<ActivityIndicator color="#ffffff" />` | `Palette.nearWhite` (`#FFFEFE`) | spinner on the submit button |
| `src/app/login.tsx` | `buttonText.color: '#ffffff'` | `Palette.nearWhite` | submit button label |
| `src/app/signup.tsx` | `<ActivityIndicator color="#ffffff" />` | `Palette.nearWhite` | spinner on the submit button |
| `src/app/signup.tsx` | `buttonText.color: '#ffffff'` | `Palette.nearWhite` | submit button label |

`Colors.backgroundElement` / `backgroundSelected` (v1) were also repointed (`#F0F0F3`/`#E0E1E6` →
`Palette.nearWhite`/`Palette.tanGray`) as part of the same repoint, though those weren't pure
white/black. Non-white/black accent literals left **as-is** for Epic C/D (explicitly out of scope
for this pass): `#e5484d` (error/delete red — `settings.tsx`, `index.tsx` record button,
`delete-audio-button.tsx`, `history/*`, `recording-status.ts`), `#30a46c` (status "done" green,
`recording-status.ts`), `#f5a623` (favorite star, `favorite-star.tsx`), and the Expo-template
splash blues in `animated-icon.tsx` (`#208AEF`, `#3C9FFE`/`#0274DF`). The link blues
(`#3c87f7` in `themed-text.tsx` `linkPrimary` + `login`/`signup` button bg, and the
`#4B75DF` literal in the Record flow) were consolidated to one `Theme.colors.link` token
in Epic D Part 1 — see [Design system](#design-system)'s "Link colour" note.

### Epic C — Record-flow restyle (Parts 1–4 all done — Epic C is complete)

Epic C restyled the **Record flow**, in four parts, **all now done**:
1. **Part 1** — the mode-select screen restyle (pills, tagline, palette).
2. **Part 2** — the mode-select → question **shift animation**.
3. **Part 3** — the folded-in **`QuestionArea`** (pool / custom-input / confirmed-custom) + the
   interim record disc.
4. **Part 4** — the record disc's final placement (Part 3 already shipped its visual), and — the
   substantial half — the **post-recording behaviour change**: after upload the Record screen
   **stays put** and shows live processing status inline, with "See more details" → the recording's
   History detail once done, and inline "Regenerate report" on failure. Full behaviour in
   [Mode selection](#mode-selection)'s "Post-recording flow" bullet.

**Epic D (History redesign) is next** — search bar, calendar/list toggle, 3-dot per-row menu, the
new "Delete recording" action, restyled list/detail. See [Scope](#scope).

- **Part 1 (done):** the mode-select screen's visual restyle only — flat `#FFFAF6` background
  (already there via the Epic B `Colors` repoint), Noto Sans typography for the new static
  **"Unmute your potential."** (the `title` variant / 28px as of Part 2 — was a one-off 24px in
  Part 1) over **"Choose a mode."** (`body` variant) two-line intro, and the three mode options as
  a **single horizontal row of small pill-shaped buttons** (`flex: 1` each, `Theme.radius.pill`,
  `Theme.colors.card`
  fill, `Theme.colors.border` 1px border, a soft `Theme.colors.shadow` `#BEA398` @ 15% drop shadow
  with 0/0 offset — RN can't do the design's 5 spread / 50 blur so `shadowRadius: 25` + `elevation:
  3` stand in), in their **unselected state only** (`paddingVertical` `sm`/8 — deliberately low so the pill
  isn't over-round). The label font size is **derived from measurements in `ModeSelect`**: row
  width from `onLayout`, plus the longest label's actual rendered width from `onTextLayout` on a
  hidden absolutely-positioned measurer at `MODE_LABEL_MEASURE_FONT` (16). From those it picks the
  size that leaves `MODE_LABEL_SIDE_GAP` (16px) clear on each side of "Miscellaneous" within its
  pill — ~32px total — clamped `MODE_LABEL_MIN_FONT`–`MAX_FONT` (11–18), and applies **the same
  value to all three** labels, so nothing truncates and no pill's text looks smaller than its
  neighbours. `adjustsFontSizeToFit` was tried first and rejected for shrinking only the one
  overflowing label; a glyph-width-ratio estimate was tried next and replaced by the `onTextLayout`
  measurement for accuracy across fonts/screens. **Load-bearing width fix:** `heroSection` gained `alignSelf: 'stretch'` —
  `safeArea` centres its children, so before this `heroSection` hugged the tagline's width and the
  pill row couldn't get any wider no matter the padding (which is why the first gutter tweak looked
  like it did nothing). The doubled gutter was also removed — `heroSection` drops its
  `paddingHorizontal`, `safeArea`'s goes 24 → 16 — affects the whole Record tab. The old per-option descriptions were dropped; the old `"Brevado"` title + `"Logged
  in as {email}"` lines were removed (see [Mode selection](#mode-selection)'s "Greeting removed"
  bullet). `ModeSelect` no longer wraps `<Card>` — it renders bordered `Pressable` pills directly.
- **Part 2 (done):** the mode-select **shift animation** + the pill's **selected/filled state**
  (built now because the animation needs it). Implementation lives in `ModeSelectFlow` /
  `ModePill` in `src/app/(tabs)/index.tsx`:
  - **Filled state:** selected pill animates to `Theme.colors.accent` fill + `borderColor`, with
    `Theme.colors.onAccent` (`#FFFEFE`, never pure white) text. `accent` is still the Part 1
    **placeholder** `#56453D` brown — **flagged, exact value TBD** (Epic C/D or from a screenshot).
    Unselected pills keep the Part 1 white/`card` + `border` look. The fill is a Reanimated
    `interpolateColor` on a per-pill shared value.
  - **Choreography — the whole thing runs in exactly 1s**, and is *not* a symmetric time-reverse:
    the brown fill is first in **both** directions, and the pill shift only begins once the
    tagline fade has fully finished. Timeline (`T_*` consts at the top of the file):
    - *Forward (mode tapped):* fill `0–180` → **"Unmute your potential." / "Choose a mode." fade
      out** `180–430` → **pills shift up** `430–1000` (`Easing.out` cubic, so they clear the
      question zone early and settle slowly) → **question area fades/rises in** `720–1000`,
      overlapping the shift's tail.
    - *Reverse ("‹ Change mode"):* un-fill `0–180` → question area fades out `180–430` → pills
      shift back down `430–1000` → tagline fades back in `720–1000`.
  - **Nothing unmounts / remounts.** The intro floats *above* the pill row (`introWrap`, absolute,
    `bottom: '100%'`) so its opacity animating never moves the pills. The pill row is the only
    thing that moves: `modeFlowInner` gets an animated `translateY` (`shift` shared value) between
    a measured centred position and `MODE_PILLS_TOP_INSET`. The question area is absolutely
    positioned at its final resting spot and only fades/rises. Three shared values
    (`introOpacity` / `shift` / `questionOpacity`) are scheduled with `withDelay` in one
    `useEffect` on `isSelected`; the pill fill lives in `ModePill` and fires on its own.
  - **Measurement:** `ModeSelectFlow` measures the stage height, pill-row height and (floating)
    intro height via `onLayout`; until all three are in, `modeFlowInner` is held at `opacity: 0`
    (a frame or two) rather than risk a first-paint jump.
  - **Flow change:** tapping a mode no longer jumps to a separate screen — it sets `selectedMode`
    (a *sub-state* of `flowScreen === 'mode-select'`, not a new `flowScreen`). Part 2 had a
    placeholder box with a "Continue" button here; **Part 3 replaced it** with the real
    `QuestionArea` and its own "Start recording" button (miscellaneous now skips straight to
    `'record'` in `startModeSelection`). Cap check runs once, on the first tap only.
  - **"‹ Change mode" is a header back link** — because the picked sub-state reads as a detail
    view, the back affordance replaces `AppHeader` with a `HeaderBackLink` in the header row
    (never an inline body link), exactly as History's detail screen and Settings do. It's
    `FadeIn`/`FadeOut`. Shown (`showChangeModeHeader` in `index.tsx`) while
    `flowScreen === 'mode-select' && selectedMode`, **and** on the pre-recording record screen
    (`flowScreen === 'record' && !recordedUri && !recorderState.isRecording`) — so the header
    stays a "Change mode" link continuously from picking a mode through to tapping record, then
    reverts to `AppHeader` once recording starts or a take is captured (v4 Epic I tidy-up; the
    inline `BackLink` that used to sit at the bottom of the record area is gone).
  - **Not in Part 2:** real question content (→ Part 3, done), the record button restyle and the
    "stay on Record showing processing status" behaviour change (→ Part 4).
  - **Known rough edges:** interrupting the 1s transition mid-flight (tap "‹ Change mode" while the
    pills are still sliding) still reverses but with a brief hold before the pills move back — the
    `withDelay` schedule isn't interruption-aware. `withTiming` doesn't auto-respect the OS "Reduce
    Motion" setting (only layout/entering animations do) — add a `useReducedMotion()` short-circuit
    if that matters.
- **Part 3 (done):** the real question content, restyled, folded into `ModeSelectFlow`'s slot
  (replacing Part 2's placeholder box). `QuestionSelect` and the separate `flowScreen ===
  'question'` are **gone** — `FlowScreen` is now just `'mode-select' | 'record'`. New component
  `QuestionArea` (`src/app/(tabs)/index.tsx`), rendered inside the animated slot, with three
  display states:
  - **`pool`** — the AI-picked question as centred text (`styles.questionQuote`: **`regular`
    weight, 20px** — "just a bit larger than 'Choose a mode.'" (`body`/16), which the rest of the
    screen is scaled around), curly quote marks, with an **"Ask my own question instead"** link
    below it and the interim **record disc** (below).
  - **`input`** — a bordered box (`styles.customInputBox`: `Theme.colors.card` fill,
    `Theme.colors.border`, **30px corners** — *not* a raw RN `TextInput` border; placeholder text
    `#56453D` at 50% opacity, `#56453D80`) with a `SymbolView` `arrow.up.circle.fill` submit
    button; the link becomes **"‹ Use prompt instead"**, **left-aligned** (`styles.backLink`,
    `alignSelf: 'flex-start'` — the only left-aligned thing in the otherwise-centred column),
    abandons any custom text back to the pool pick. Validation unchanged: non-empty after trim.
  - **`custom`** — the confirmed typed text in the same `questionQuote` style with a `pencil`
    `SymbolView` beside it (re-opens `input`, pre-filled); left-aligned **"‹ Use prompt instead"**
    still abandons it.
  - **Interim record disc** (`styles.recordStart` / `recordOuter` / `recordInner` / `recordHint`,
    in `pool` + `custom`): a **62px red disc** (`Theme.colors.recordRed`, `#C53030`) centred on a
    **76px off-white disc** (`Theme.colors.card`, `#FFFEFE`, 1px `Theme.colors.cardBorder`
    `#56453D` border) — the design's 200/245 ratio (~1.22), scaled to sit with the 20px question —
    with **"Tap to start recording"** below it (`regular`, **14px** = same size as the links, per
    the design, `#2D1306`). Tapping advances to `flowScreen === 'record'`. **Epic C Part 4 makes
    this the real record button** and folds recording into this screen — for now the actual
    recording still happens on the separate `'record'` screen.
  - **Vertical layout:** `ModeSelectFlow`'s `questionSlot` is `top: questionTop, bottom: 0`,
    wrapping a `ScrollView` (`contentContainerStyle` `flexGrow: 1`). Question + link sit near the
    **top** (just under the pills); the record disc + hint are pushed **down** into the lower part
    of the slot by flex spacers (`questionGapTop` / `questionGapBottom`, ratio 1 : 1.3 so the disc
    lands a touch above centre of that gap). Scrolls if a long question makes it all overflow.
    (`modeFlowInner`'s `zIndex: 1` matters — the slot overlaps where the centred/unselected pills
    sit.)
  - State swaps are a plain `FadeIn` per block + a light `LinearTransition` on the `QuestionArea`
    root for the height change — deliberately far simpler than Part 2's choreography.
  - **`poolQuestion` / `customQuestion` are separate parent state** now (were one conflated
    `selectedQuestion`). The recording uses `customQuestion ?? poolQuestion?.text`. `<QuestionArea
    key={selectedMode}>` remounts on a mode switch so its local `editing`/`draft` reset cleanly.
  - **Miscellaneous skips all of this** — `startModeSelection('miscellaneous')` sets
    `flowScreen = 'record'` immediately (no pill animation, no question slot), matching the
    pre-Part-2 "straight to record" behaviour.
  - **Link colour = `#4B75DF`.** The user picked this blue for interactive text specifically;
    it is **the one deliberate exception** to the warm palette (a warm-palette link would be
    `#56453D`, identical to body text — invisible as a link). As of **Epic D Part 1** this is
    a real token — `Palette.link` / **`Theme.colors.link`** — and the *single* place the
    colour is defined anywhere in the app (see the "Link colour consolidation" note below).
    `styles.questionLink` (the three QuestionArea links + the Record screen's "See more
    details" / "Regenerate report" / "Try again") reads `Theme.colors.link`.
  - **Naming unified:** `"Storytelling"` everywhere user-facing. `MODE_LABELS` moved to
    `src/lib/modes.ts` (`Record<RecordingMode, string>`), plus a `formatMode(string)` helper the
    History screens use (`recording.mode` is typed `string` there). `mode: 'story'` in the
    DB/schema is unchanged — display-string only.
- **Part 4 (next, final part of Epic C):** the record-button restyle and the post-upload
  "stay on Record" behaviour change. After Part 4, Epic C's visual restyle of the Record flow is
  complete.
- Still open, for the human's on-device review: the tagline over the flat instruction line;
  whether "Choose a mode." still earns its place; and the scaled-down question-area sizes
  (`questionQuote` 20 / `recordHint` 14 / disc 62·76 / input `borderRadius: 30`) and the
  vertical placement of the question block against the design screenshots.

### Link colour consolidation (Epic D Part 1)

Before Epic D there were **two conflicting blues** for the same job: `#3c87f7` (the
`linkPrimary` `ThemedText` type in `themed-text.tsx`, also the `login`/`signup` submit-button
background and signup's "check your email" notice) and `#4B75DF` (the `styles.questionLink`
literal in the Record flow). Epic D Part 1 collapsed both into **one token,
`Theme.colors.link` (`= Palette.link = '#4B75DF'`)**, defined in exactly one place
(`src/constants/theme.ts`). What changed:

- **`themed-text.tsx`:** the `linkPrimary` `type` is **gone** — folded into `link`, whose
  style now carries `color: Theme.colors.link`. All 9 `<ThemedText type="linkPrimary">`
  call-sites (`login`, `signup`, `settings` back link, `index.tsx` "Open Settings",
  `history/index.tsx` + `history/[id].tsx` Retry / Regenerate / Back links) became
  `type="link"`. `link` previously had no colour (inherited `theme.text`) and was unused, so
  nothing regressed.
- **`index.tsx` `styles.questionLink`:** `color: '#4B75DF'` → `Theme.colors.link`.
- **`login.tsx` / `signup.tsx`:** submit-button `backgroundColor` and signup's `notice`
  colour → `Theme.colors.link` (a very slight hue shift from `#3c87f7`, accepted as the cost
  of one blue).
- **Not touched:** the Expo-template splash blues in `animated-icon.tsx` (`#3C9FFE` /
  `#0274DF` / `#208AEF`) — those are the placeholder splash-logo gradient, not links, and
  are already separately flagged for a Brevado brand asset. They are the only raw hex blue
  left in `src/` outside the token definition.

### Still flagged for Epic C/D

- **`recordRed` mismatch:** the record button on the `'record'` screen (`index.tsx`) still uses
  `#e5484d`, not `Theme.colors.recordRed` (`#C53030`). The **Part 3 interim record disc** in
  `QuestionArea` *does* use `Theme.colors.recordRed` — reconcile the `'record'` screen's when it's
  rebuilt in Part 4.
- **Status badge colours** (`recording-status.ts`) still hardcode red/green — no warm-palette
  tokens for error/success yet. Same for the inline **error text** on the History screens and in
  `RecordingActionsMenu` (`#e5484d` literal). ("Delete recording" in the menu *does* use the
  warm `Theme.colors.recordRed` token.)
- **The one link blue** (`Theme.colors.link`, `#4B75DF`) is a deliberate warm-palette
  exception, not a mismatch to fix — see "Link colour consolidation" above. The auth
  submit-button now reuses it too.
- ~~**`favorite-star.tsx`** uses `#f5a623`, not `Theme.colors.favoriteGold` (`#F3BF16`).~~
  Fixed in Epic D Part 3 — the active star now uses `Theme.colors.favoriteGold`; inactive stays
  the muted `theme.textSecondary` outline. (`delete-audio-button.tsx` / `download-audio-button.tsx`
  were **deleted** in Epic D Part 4 — those actions are now items in `RecordingActionsMenu`.)
- **Splash screen** (`animated-icon.tsx` + `app.json` splash `#208AEF`) is still the Expo-template
  blue + Expo logo — needs a Brevado brand asset + cream bg.
- **Nav bar ❌ items** above (stroke, drop shadow, iOS active pill) — need a custom tab bar.
- **Noto Sans on-device check:** `@expo-google-fonts/noto-sans` (`^0.4.2`) is now correctly
  installed (the human re-ran `npx expo install @expo-google-fonts/noto-sans` locally after the
  SDK 54→57 recovery), `npx tsc --noEmit` is clean, and the four weight subpath imports in
  `_layout.tsx` resolve — but the actual rendering (and the nav approximations) still haven't been
  seen on the physical test iPhone.

## Recording

- Recording/playback uses **`expo-audio`**, not `expo-av` (deprecated, and the library it's easy to
  reach for out of habit — see Conventions below).
- The recording screen lives at `src/app/(tabs)/index.tsx` (the Home tab) — it replaces the
  template's placeholder content rather than living at a separate route, since recording is the
  core home-screen action per the project plan. As of Phase 4 Step 2, it's one of a few local
  "screens" this same file renders (behind mode selection — see [Mode
  selection](#mode-selection)), reached only after picking Miscellaneous (Interview/Story currently
  dead-end at a placeholder instead). `RecordingPlayback`, the upload/keep/discard UI shown after
  stopping, is a private component in the same file, but its play/pause + progress bar controls now
  live in `AudioPlaybackControls` (`src/components/audio-playback-controls.tsx`), extracted in
  Phase 3 Step 1 once the History detail screen needed the exact same controls for a recording's
  already-uploaded audio — see [History](#history).
- Flow: `useAudioRecorder(RecordingPresets.HIGH_QUALITY)` + `useAudioRecorderState` drive
  record/stop and the elapsed-time counter; on stop, `recorder.uri` (the local file URI) is kept
  in state and handed to a `useAudioPlayer`-backed playback view, which now also carries the
  Keep/Discard decision point that Upload (below) hooks into. Discarding clears that state, which
  unmounts the playback view and releases its player.
- Mic permission is requested lazily on the first record tap
  (`AudioModule.requestRecordingPermissionsAsync()`), not on screen load; a denied/blocked state
  shows an in-UI message instead of failing silently, with a link to the Settings app if the OS
  says it can't be asked again (`response.canAskAgain`).
- iOS permission copy (`NSMicrophoneUsageDescription`) is set via the `expo-audio` config plugin's
  `microphonePermission` option in `app.json` (`expo.plugins`), not a manually-added
  `ios.infoPlist` entry — the plugin writes it into `Info.plist` for you. **Note:** like all config
  plugins, this only takes effect on a native prebuild (EAS Build / dev client); running through
  Expo Go, the mic permission prompt and its copy come from the Expo Go app itself, not this
  project — worth knowing if the permission text looks generic while testing.

## Upload

- Upload logic lives in `src/lib/recordings.ts` (`uploadRecording`, `buildAudioPath`,
  `RecordingUploadError`) — separated from the recording screen so Step 6's history list and
  Phase 2's processing pipeline have one place to read/reuse this instead of duplicating it. The
  screen only owns UI state; it never talks to Storage or the DB directly.
- Trigger: the "Keep & upload" button on the Step 4 playback screen (`RecordingPlayback` in
  `src/app/(tabs)/index.tsx`) — upload never happens on every stop, only once the user has
  reviewed playback and explicitly kept the take. "Discard & re-record" bypasses upload entirely.
- Storage path: `{user_id}/{timestamp}.{ext}` in the `recordings-audio` bucket (`buildAudioPath`)
  — storage RLS (`0002_storage_bucket.sql`) only checks that the first path segment matches
  `auth.uid()`, so a timestamp is sufficient as the filename; it doesn't need to match the
  `recordings.id` the DB later generates.
- **Order of operations: upload to Storage first, then insert the `recordings` row with the
  resulting `audio_path`** — not insert-then-update. A `recordings` row is only ever created once
  its audio is durably stored, so an interrupted/failed upload can never leave a stray `pending`
  row with no audio behind it (this is what Step 5 required — no orphaned rows on upload
  failure). The tradeoff: if the upload succeeds but the insert itself then fails, the file is
  orphaned in Storage with no DB row pointing at it. That's accepted as the lesser problem — an
  untracked file to clean up later beats a broken row visible to the user — and Step 6's history
  list won't surface it since it only lists real rows.
- Failure/retry: `RecordingUploadError` carries which stage failed (`'upload'` vs `'insert'`) so
  the error message can say whether the audio itself is already safe. The screen keeps the
  generated `audio_path` in a ref across retries (`upsert: true` on the Storage call) so retrying
  overwrites the same object instead of accumulating duplicates; since the DB row is only
  inserted after a successful upload, retrying can't create duplicate rows either.
- Mode/question are hardcoded (`mode: 'miscellaneous'`, `question: null`) until Phase 4 adds real
  mode selection — this is the only combination the `recordings.mode` check constraint allows
  without that UI.

## Recording cap

Phase 3 Step 3 — enforces `MAX_RECORDINGS_PER_USER` (30, counting rows where
`audio_deleted = false`; see [Database](#database) and docs/PROJECT_PLAN.md Section 3's "Audio
retention" subsection). Checked **before** a recording can start, not after upload — a user should
never be able to record + hit upload and only then learn they're blocked.

- **Where the check lives, precisely: `handleSelectMode()` in `src/app/(tabs)/index.tsx`, the
  first thing it does when the user taps Interview, Story, or Miscellaneous on the mode-selection
  screen.** This is a relocation, done in Phase 4 Step 2 as planned — it originally lived in
  `handleStartRecording()` (the old bare record button, Phase 3 Step 3) before that button was
  replaced by mode selection as the real entry point into recording — see [Mode
  selection](#mode-selection) for the full detail on that screen. The `getActiveRecordingCount`
  call, the `MAX_RECORDINGS_PER_USER` comparison, and the block-with-message behavior all moved
  together, unchanged in logic — only the trigger point changed. There is exactly one place this
  is enforced on the frontend now; `handleStartRecording()` (still in the same file, now only
  reachable after the cap check has already passed) no longer does any cap check of its own.
- **Frontend check:** `getActiveRecordingCount(userId)` (`src/lib/recordings.ts`) — a direct
  Supabase count query (`select('id', { count: 'exact', head: true })`), not a backend endpoint.
  Chosen over adding e.g. `GET /recordings/cap-status` to the FastAPI backend because RLS ("Users
  can view their own recordings", `0001_initial_schema.sql`) already scopes the query correctly to
  the calling user — a backend round-trip would only add latency here, not correctness or any
  shared logic worth centralizing (there's no non-trivial cap *logic*, just a count and a
  comparison). `MAX_RECORDINGS_PER_USER` is mirrored as its own constant in `src/lib/recordings.ts`
  rather than fetched from the backend's copy (`backend/app/config.py`) — same accepted duplication
  as `RECORDINGS_BUCKET` already being defined separately in both projects (see
  [Backend](#backend)).
  - On a cap hit, `handleSelectMode` sets local state that swaps the mode options out for a
    `CapBlockedCard` (same file) — a clear "You've reached your 30 recording limit. Delete some
    audio from History to record more." message plus a "Go to History" button
    (`router.navigate('/history')`). No mode's recording UI is ever reached in this state.
  - If the count query itself fails (network blip), the check **fails open** — proceeding into the
    chosen mode is allowed rather than blocking someone over a check that couldn't complete. The
    Postgres trigger below is what makes that safe to do.
  - The blocked state resets on every screen focus (`useFocusEffect`), so navigating back from
    History (e.g. after a future manual delete frees a slot) shows the normal mode options again;
    the next tap re-checks for real rather than trusting the stale cleared state.
  - Under the cap, this is invisible: the count query runs once, inline, at tap time, and mode
    selection behaves exactly as before — no separate loading UI was added for it, since it's a
    single indexed count query and resolves well within the time the user spends granting mic
    permission anyway (for Miscellaneous) or reading the placeholder (for Interview/Story).
- **Backend/DB safety net:** a Postgres trigger, `recordings_enforce_cap` (function
  `enforce_recording_cap()`, `supabase/migrations/0004_recording_cap_enforcement.sql`), fires
  `before insert on recordings` and raises (blocking the insert) if the inserting user already has
  `>= 30` rows with `audio_deleted = false`. This — not a backend endpoint — is where the
  belt-and-suspenders check lives, because row creation still happens entirely on the frontend,
  direct against Supabase (`uploadRecording` in `src/lib/recordings.ts`; see [Upload](#upload)) —
  there's no backend code in the insert path to put a check in. The trigger is independent of the
  frontend check above by design: it holds even if the frontend check is buggy, skipped, or bypassed
  by some other client hitting the table directly with a valid session. At exactly 30, a 31st insert
  attempt gets a clear Postgres error (`check_violation`, `errcode 23514`) rather than silently
  succeeding — surfaces to the frontend as an `insert`-stage `RecordingUploadError` (see
  [Upload](#upload)'s "Failure/retry" bullet) if it's ever actually hit in practice (it shouldn't
  be, given the frontend check above runs first).
  - The cap number is hardcoded in the migration SQL itself, since Postgres can't read
    `MAX_RECORDINGS_PER_USER` from either `backend/app/config.py` (Python) or
    `src/lib/recordings.ts` (a separate frontend project). That's a third copy of the same number —
    if it ever changes, update all three: this migration, `backend/app/config.py`, and
    `src/lib/recordings.ts`.
  - This migration hasn't been applied via a Supabase CLI (this repo has `supabase/migrations/`
    files but no linked CLI project) — like `0001`–`0003` before it, run its SQL manually in the
    Supabase dashboard's SQL editor against the live project.
- **Freeing a slot:** as of Phase 3 Step 5, the bin icon in History (list and detail — see
  [Audio delete](#audio-delete)) is the real, built mechanism — deleting a recording's audio sets
  `audio_deleted = true`, which drops it out of `getActiveRecordingCount`'s count immediately.
  Before Step 5 the only way to drop below the cap was deleting `recordings` rows directly in the
  Supabase dashboard's table editor; that workaround is no longer needed.
- **How this was tested:** `MAX_RECORDINGS_PER_USER` was temporarily lowered to `2` in all three
  places (`backend/app/config.py`, `src/lib/recordings.ts`, and the migration's `max_recordings`)
  to make hitting the cap practical by hand, confirmed both that recording is blocked with the
  clear message at the cap and that recording still works normally below it, then the constant was
  set back to `30` in all three places before calling this step done.

## Mode selection

Phase 4 Step 2 — replaces the old bare record button with a real entry point into the recording
flow: three options, Interview / Story / Miscellaneous, on the Home tab. As of Phase 4 Step 3,
Interview/Story now lead to a real question-selection screen instead of a placeholder — see
[Question selection](#question-selection) for that logic; this section covers the screen-switching
shell around it.

- **Lives in the same file, `src/app/(tabs)/index.tsx` — not a new route.** The Home tab renders
  via local component state. As of Epic C Part 3, `FlowScreen` is just **`'mode-select' |
  'record'`** — the old separate `'question'` screen is gone, folded into `ModeSelectFlow`.
  - `'mode-select'` (default): handled by `ModeSelectFlow`, which has **two animated sub-states**
    (not separate `FlowScreen` values):
    - *Nothing picked:* a centred group — static tagline **"Unmute your potential."** (`title`
      variant / 28px) over **"Choose a mode."** (`body` variant), then the horizontal pill row.
    - *Mode picked (`selectedMode` set — interview/story only):* a **1-second choreographed
      transition** — brown fill → tagline fades out → pill row slides to the **top** → the
      **`QuestionArea`** fades in below. "‹ Change mode" appears **in the header** (top-left, next
      to the profile icon) and reverses it. Full timeline + the fact that it's *not* a symmetric
      reverse are in [Design system](#design-system)'s Epic C subsection.
    - The pills are **one row of `flex: 1` pill buttons** (white fill / tan border / soft `#BEA398`
      @ 15% shadow / low `paddingVertical` so they aren't over-round). All three labels share one
      measured font size (row width via `onLayout` + longest label's width via `onTextLayout` on a
      hidden measurer → largest size leaving ~16px each side of "Miscellaneous", clamped 11–18px).
      The middle pill reads **"Storytelling"**; `mode` stays `'story'` internally.
    - **Width fix (Part 1):** `heroSection` needs `alignSelf: 'stretch'` — `safeArea` centres its
      children, so without it `heroSection` hugged its widest child and the pill row could never
      exceed that width. The gutter was also de-doubled (`heroSection` lost its `paddingHorizontal`,
      `safeArea`'s went 24 → 16) — affects the whole Record tab.
    - **`QuestionArea`** (Epic C Part 3, replacing the old `QuestionSelect` + `flowScreen ===
      'question'`) — the pool-pick / custom-input / confirmed-custom question UI, with an interim
      "Start recording" button that advances to `'record'`. Full description (the three states,
      the accent-coloured link, the naming unification) is in
      [Design system](#design-system)'s Epic C Part 3 bullet and
      [Question selection](#question-selection).
  - `'record'`: shown after selecting **Miscellaneous** (straight there, no question step — see
    below), or after "Start recording" from `QuestionArea`. The record/playback/upload UI. Renders
    a banner above the record button — "{Interview|Storytelling} question" plus
    `customQuestion ?? poolQuestion?.text` — whenever there's a question.
- **Post-recording flow (v2 Epic C Part 4 — the behaviour half; the record-button restyle was
  Part 3's disc):** after "Keep & upload" succeeds the Record screen **stays put** (the old
  `router.navigate('/history')` is gone). `RecordingPlayback`'s `'done'` state renders
  **`ProcessingStatus`**, which polls this one recording and shows it move **pending → processing →
  done/failed** live:
  - *pending/processing:* a status badge (History's `getStatusPresentation` colours, restyled to a
    v2 pill) + a spinner.
  - *done:* the badge + a **"See more details ›"** link → `router.push('/history/[id]')` for
    **this** recording (not the History tab in general).
  - *failed:* the badge + **"Regenerate report"** inline — the same `regenerateReport()` endpoint/
    optimistic-`processing` flow History uses (Phase 3 Step 2), just without leaving the screen.
  - If `POST /recordings/{id}/process` itself fails, `ProcessingStatus` shows "Couldn't start
    processing" + a retry (`kickProcessing`) rather than the status silently sticking at "Pending".
  - **Polling reuse:** `ProcessingStatus` *replicates* (does not extract a shared hook — to keep
    the History files literally untouched) the History **detail screen's** single-recording poll
    (Phase 3 Step 2), which is itself Step 7's list-polling shape applied to one row: 1.5s
    interval, `TERMINAL_STATUSES` stop, `requestSeqRef` out-of-order guard, `useFocusEffect`-gated,
    silent in-place updates. The only divergence is `fetchRecordingById(id)` instead of
    `fetchRecordings()` — the Record screen only ever tracks the single just-uploaded recording.
  - **Reset:** the `'done'` state has **one** button — **"Record another"** (`resetRecordingState`,
    keeps the same mode/question, fresh take). The **"‹ Change mode"** link that used to sit
    beside it was **removed** (it doesn't make sense to switch mode after a take is already
    recorded/uploaded). And a **reset-on-return**: a `useFocusEffect` on the Record screen flags
    itself on *blur while `uploadState === 'done'`*, and on the next *focus* runs
    `handleBackToModeSelect()` — so leaving after a finished recording (tap "See more details",
    switch tabs) and coming back lands on a clean mode-select, no stale status; a fresh pick
    that way is how you change mode after finishing. Leaving *mid-take* (recorded-not-uploaded)
    is still preserved. `startModeSelection` also calls `resetRecordingState()` up front.
- **Interview/Story reach recording for real** — `selectedMode` plus `poolQuestion`
  (a `DailyQuestion` from `GET /questions/daily`) / `customQuestion` (component state in
  `index.tsx`) carry through to `'record'` and into `handleKeepAndUpload`'s `uploadRecording()`
  call as `mode` + `question` (`customQuestion ?? poolQuestion?.text ?? null`) + `questionId`
  (`poolQuestion.id`, only for a pool pick) — see [Question selection](#question-selection) and
  [Upload](#upload) for the insert. "Discard & re-record" / "Record another" reuse the same
  question; a fresh pick needs "‹ Change mode" (available before recording, or by leaving the
  Record tab and returning after a finished take — see the Reset bullet above).
- **Cap check** — runs once in `handleSelectMode` on the **first** mode tap. Switching mode
  afterwards skips the re-check (recording count can't have changed). See
  [Recording cap](#recording-cap).
- **Advancing past mode-select:** `handleSelectMode` → `startModeSelection(mode)`. For
  **miscellaneous** that sets `flowScreen = 'record'` immediately (no animation, no question
  step). For **interview/story** it sets `selectedMode` (driving the shift animation) and fires
  `loadQuestion(mode)` — which as of v4 Epic H Step 2 calls `fetchDailyQuestion(mode)`
  (`GET /questions/daily`) rather than the deleted client-side `pickQuestionForMode`;
  `QuestionArea`'s own "Start recording" button is what later sets `flowScreen = 'record'`.
- **Re-practice entry (v4 Epic I):** a **third** way into `flowScreen = 'record'`, bypassing
  mode-select entirely. Route params from History's "Re-practice this question" menu item are
  consumed into `rePractice` state by `enterRePractice` (which runs the same cap check), fixing
  the mode + question read-only. See [Re-practice mode](#re-practice-mode).
- **Greeting removed (v2 Epic C Part 1):** the Phase 1 `'mode-select'` header showed a static
  `"Brevado"` title plus a `"Logged in as {email}"` line (the last bit of per-user text left on
  this tab — it was already flagged for Epic B to reconcile). Both are gone. There was never any
  real greeting-*personalization* logic (no name derivation, no first-time/returning branch) — just
  those two lines — and they're replaced by the genuinely static **"Unmute your potential." /
  "Choose a mode."** pair, identical for every user every time. The email now lives only on the
  [Settings screen](#settings-screen). The `"Brevado"` title and email line were rendered above the
  whole flow, so `'record'` also loses them — it has its own context header (the question banner).
- **Verification status:** frontend type-checks clean (`npx tsc --noEmit`). Not yet exercised in
  Expo Go on the physical test iPhone — same caveat as several Phase 3 steps (see [Phase 3
  assessment](#phase-3-assessment)) — including re-confirming the cap check still blocks/unblocks
  correctly at its current location, and the Epic C Part 1 restyle (tagline/subtitle copy, pill
  shape, cream background, Noto Sans) against the design screenshots. Suggested way to re-verify the cap: the same
  temporarily-lower-`MAX_RECORDINGS_PER_USER`-to-2 trick used to verify Phase 3 Step 3 (see that
  section's "How this was tested" bullet). See [Daily questions](#daily-questions) for the v4
  Epic H Step 2 test plan (today's assigned question reaches the DB with a matching
  `question_id`; the same question shows for a second account/session).

## Question selection

Interview/Storytelling show a question before recording; Miscellaneous has none (inserts
`mode: 'miscellaneous', question: null`). As of **v4 Epic H Step 2** the pool question comes
from the **global daily-question endpoint** — the old client-side pick
(`pickQuestionForMode` / `src/lib/question-selection.ts`) and the static pool
(`src/lib/questions.ts`) are **deleted**. The *UI* is `QuestionArea` (v2 Epic C Part 3) — see
[Design system](#design-system).

**Mode naming (v2 Epic C Part 3):** every user-facing label is **"Storytelling"** (not
"Story"), matching the design and the mode-select pill. `MODE_LABELS` lives in `src/lib/modes.ts`;
`formatMode(string)` there is what the History list/detail use. The internal `mode: 'story'`
value is unchanged — display strings only.

- **Pool question:** `loadQuestion(mode)` in `src/app/(tabs)/index.tsx` calls
  **`fetchDailyQuestion(mode)`** (`src/lib/api.ts` → `GET /questions/daily?mode=…`, bearer-token
  auth). It returns `{ id, mode, text }`; `index.tsx` stores it in `poolQuestion`
  (type `DailyQuestion`, from `api.ts`). Same for every user that day — assignment,
  no-repeat, and pool top-up all live server-side (see [Daily questions](#daily-questions)).
  Loading / error+"Try again" states are `QuestionArea`'s pool-state UI, pointed at this fetch
  (a `502`, or a slow cold-start on Render's free tier, shows the retry).
- **Custom question — unchanged.** "Ask my own question instead" → a bordered `Theme`-token
  input box with an icon submit → confirmed-custom (quoted text + pencil to re-edit). Validation
  is trim-then-check-non-empty (`submitDraft` in `QuestionArea`), no length limit or content
  filtering. `poolQuestion` / `customQuestion` are separate parent state.
- **Reaching the database:** `handleKeepAndUpload` passes to `uploadRecording()`
  (`src/lib/recordings.ts`):
  - `mode: selectedMode` (or `'miscellaneous'`).
  - `question: customQuestion ?? poolQuestion?.text ?? null` — the effective question text
    (`null` for miscellaneous).
  - `questionId`: **`poolQuestion.id` only when the question came from the pool** — i.e. not
    custom-typed and not miscellaneous. `uploadRecording` inserts it as `recordings.question_id`
    (the `questions` FK). So: pool recording → `question` + `question_id` both set; custom
    recording → `question` only, `question_id` NULL; miscellaneous → both NULL. `re_practice_of`
    stays NULL for a normal recording — it's set only on a **re-practice** upload (v4 Epic I,
    see [Re-practice mode](#re-practice-mode)).
- **Verification (Epic H Step 2):** `npx tsc --noEmit` + `eslint` clean. On-device test plan in
  [Daily questions](#daily-questions).

## History

- The list lives at `src/app/(tabs)/history/index.tsx` — this **replaces the scaffold's
  placeholder "Explore" tab** rather than adding a third tab (`app-tabs.tsx` and
  `app-tabs.web.tsx` were updated accordingly: `NativeTabs.Trigger`/`TabTrigger` name and route
  both renamed `explore` → `history`). The tab still reuses the scaffold's `explore.png` icon —
  there's no dedicated history icon asset yet; swap it whenever one exists. As of Phase 3 Step 1,
  `history.tsx` became this directory (plus `[id].tsx` and `_layout.tsx` — see the detail-screen
  bullet below) so a tapped row can push a nested route; `NativeTabs.Trigger name="history"` /
  `TabTrigger href="/history"` still resolve to this directory's `index.tsx` exactly as before,
  so nothing about the tab itself changed.
- Query logic is `fetchRecordings()` in `src/lib/recordings.ts`, alongside the upload logic —
  selects `id, mode, question, title, re_practice_of, status, created_at, favorite, audio_deleted,
  audio_path`
  plus (for the Streaks tab, which rides along on this same query) `impact_score`, `clarity_score`,
  `structure_score` (v3 Epic G Part 2) and `metrics`, `grammar_issue_count` (v3 Epic G Part 3),
  for the current user ordered by `created_at desc`. `question` was added in the Phase 4 Step 5
  exit-checkpoint review (see [Phase 4 exit checkpoint](#phase-4-exit-checkpoint)); `title` in
  v2 Epic D Part 3 (the restyled card's heading); `re_practice_of` in v4 Epic J Part 1 (the List
  view groups a question's re-practice attempts into one card via `buildChains` — see
  [Re-practice chains](#re-practice-chains)). The **History** screens still only read the
  first set — the score/metrics columns are there purely so Streaks doesn't need a second query.
  The detail screen (below) widens to the full row with its own separate query,
  `fetchRecordingById()`, rather than this one growing a `select('*')`.
- **Screen layout / card drop shadow (Epic D Part 4 tweak):** the horizontal gutter is on the
  `FlatList`'s `contentContainerStyle` (and on `headerRow` / `centerFill` / `errorCard`
  individually), **not** on the `safeArea` container — a `FlatList`/`ScrollView` clips its
  content to its own frame, so a padded container would slice the `<Card>` drop shadows off at
  the list's left/right edges. Full-bleed list + padded contentContainer lets the shadow blur
  into the gutter. `listContent` also carries generous `paddingTop` / `gap` / `paddingBottom`
  (all `Spacing.three`+) for the same reason vertically. The vertical scroll indicator is
  hidden (`showsVerticalScrollIndicator={false}`). The detail screen's `ScrollView` got the
  identical treatment.
- **Search + view toggle (Epic D Part 5, done):** between the header and the list sit two
  new controls, both defined inline in `history/index.tsx` (`SearchBar` / `ViewToggle`
  local components; the Part 5 `CalendarPlaceholder` was replaced by `MonthCalendar` in
  Part 6):
  - **Search bar** — a pill-shaped `Theme.colors.card` field (`Theme.colors.border` 1px
    outline, `Theme.radius.pill`, `magnifyingglass` leading icon, an `xmark.circle.fill`
    clear button once non-empty). It drives a **purely client-side** filter — `search` state
    → trimmed/lowercased `query` → a `useMemo`'d `filteredRecordings` that keeps rows where
    `matchesSearch()` finds `query` as a **case-insensitive substring** of either the
    `title` (or the literal **`'Untitled recording'`** — `UNTITLED_LABEL`, the same constant
    the card's NULL-title fallback renders, so searching "untitled" surfaces those rows) or
    the `question`/prompt text (a NULL question simply never matches — the "No prompt" card
    fallback is *not* searchable). **No new backend query** — a deliberate decision (the
    list is capped at 30 rows/user; `fetchRecordings()` is unchanged). No fuzzy matching, no
    ranking. The FlatList renders `filteredRecordings`; polling / focus-refetch / all the
    per-row action state are untouched and still operate on the full `recordings` list.
  - **Calendar/List toggle** — a minimalist **underline-style** tab pair (`ViewToggle`:
    two `Pressable`s, the active one carries a 2px `Theme.colors.textPrimary` bottom border
    sitting on the row's hairline `Theme.colors.border` divider; active label is `smallBold`
    + `text`, inactive `small` + `textSecondary`). Not a segmented control / button pair.
    `view` state defaults to **`'list'`**.
    - **`'list'`** — the existing restyled cards (Part 3) + 3-dot menu (Part 4), now showing
      `filteredRecordings`. A search that matches nothing shows a distinct **"No recordings
      match …"** centred message — separate from the Phase 1 **"No recordings yet"** empty
      state (which still only shows when the user genuinely has zero recordings; the search
      bar + toggle are hidden entirely in that case, and during the initial load).
    - **`'calendar'`** — the real month grid as of Part 6 (`MonthCalendar`); see the
      "Calendar view (Epic D Part 6)" bullet below.
  - **Auto-switch:** `handleSearchChange` — typing a **non-empty** term flips `view` to
    `'list'` (if it was `'calendar'`) so the filtered results are visible, **and** clears any
    active `dayFilter` (search and day filter are mutually exclusive — see Part 6). Clearing
    the search does **not** switch back or restore a day filter (that would feel like the UI
    fighting the user — they stay on whatever view they last chose).

- **Calendar view (Epic D Part 6, done):** `MonthCalendar`, a local component in
  `history/index.tsx`, plus `dayKey()` / `formatDayLabel()` helpers and a `WEEKDAY_LABELS`
  const. No card surface — the grid sits directly on the flat cream background.
  - **Grid:** a standard 7-column week layout. `new Date(year, month, 1).getDay()` gives the
    leading-blank count, `new Date(year, month + 1, 0).getDate()` the day count; cells are
    padded with trailing `null`s to a whole number of weeks. Weekday header row is
    `S M T W T F S`. Each in-month day is a `Pressable` (`width: '14.2857%'`) with a 34×34
    rounded inner circle for the number and a fixed-height dot slot below it. **Today** gets a
    hairline `Theme.colors.border` ring; the **selected** day (`selectedKey === dayFilter`)
    gets a `Theme.colors.accent` fill with `Theme.colors.onAccent` text.
  - **Month nav:** `calendar` state (`{ year, month }`, `month` 0-11, defaults to the current
    month). `changeMonth(delta)` rolls over via `new Date(year, month + delta, 1)`. The
    **next** chevron is disabled (and dimmed to `Theme.colors.border`) once `calendar` is at
    or past the current month — there can be no future recordings.
  - **Per-day dots:** `recordingsByDay`, a `useMemo`'d `Map<dayKey, count>` built from the
    **full** already-loaded `recordings` list (not `filteredRecordings` — dots always reflect
    every recording), grouping by `dayKey(new Date(row.created_at))` = the **local** `YYYY-MM-DD`
    (local date parts on purpose, so an 11pm recording lands on the day the user made it).
    **No new backend query** — same data source as List and search.
  - **Day tap (`handleSelectDay(key, count)`):**
    - `count === 0` → set `emptyDayNotice = key` (a subtle "No recordings on {date}." line
      under the grid) and return. No navigation, no crash.
    - `key === dayFilter` (tapping the already-selected day) → clear the filter (`setDayFilter(null)`).
    - otherwise → `setDayFilter(key)`, `setSearch('')` (clear any search — mutually exclusive),
      `setView('list')`. This **switches to List view pre-filtered to that date** rather than
      rendering an inline list — deliberately, so Part 3's card styling and Part 4's 3-dot menu
      are reused as-is instead of building a second list rendering.
  - **`dayFilter` in `filteredRecordings`:** when set, `filteredRecordings` also filters to
    rows whose `dayKey(created_at)` matches. Search and day filter are applied independently in
    the `useMemo` (robust even though the UI keeps them mutually exclusive). Polling /
    focus-refetch / per-row action state are untouched and still operate on the full list.
  - **Getting back to "everything":** a **"Showing {date}" chip** (pill, `Theme.colors.card` +
    `border`, an `xmark.circle.fill`) renders above the filtered List; tapping it clears
    `dayFilter`. If a day filter ends up matching nothing (e.g. the day's last recording was
    just deleted), the List shows a "No recordings on {date}." centred message with the chip
    still present as the way out.
  - **Search interaction (the decision):** tapping a day **clears** any active search term,
    rather than AND-combining the two filters. "Show me everything from this day" is a clear,
    singular intent that a leftover search term would confusingly narrow. The reverse also
    holds — typing a search clears any active day filter. The two are never active at once.
  - **View-switch:** switching Calendar↔List via the toggle (`handleChangeView`) keeps
    `dayFilter` (so returning to Calendar still highlights the selected day, and returning to
    List still shows it filtered) but clears `emptyDayNotice`.
- **List card restyle (v2 Epic D Part 3, done):** each row is a `<Card>` (so the fill is
  `Theme.colors.card`, plus the shared inset border, `Theme.radius.card`, and card shadow — the
  card border is left as `<Card>`'s own `cardBorder`, not overridden to `Theme.colors.border`,
  to stay consistent with every other card in the app). Interior layout, top to bottom:
  - **Heading row:** `recording.title` in a bumped-up `smallBold` (Noto Sans bold, 17px), up to
    2 lines, with the `FavoriteStar` sharing the line (right-aligned). A **NULL title** renders
    as a muted (`textSecondary`) **"Untitled recording"** — see [Recording titles](#recording-titles)'s
    "List display (Part 3)" for why that over a truncated-question fallback.
  - **Prompt line:** `recording.question` as one truncated `textSecondary` line, or the literal
    **"No prompt"** when it's null (miscellaneous, or an interview/story lookup edge case) —
    never blank space, matching the design screenshot's "Day Recap / no prompt" example.
  - **Meta row:** a small colour-coded **mode pill** (`modePillColors()` maps
    `interview`/`story`/`miscellaneous` → bg `Theme.colors.modeInterview`/`modeStory`/
    `modeMiscellaneous` = pale purple/pink/blue, and label colour the matching saturated
    `Theme.colors.modeInterviewText` `#3E0877` / `modeStoryText` `#7F084C` /
    `modeMiscellaneousText` `#093C6B`; `Theme.radius.pill`; label from `formatMode()` so it
    reads **"Storytelling"**, not "Story") on the left, with the **date/time**
    (`formatRecordedAt`, `textSecondary`) **right-aligned opposite it**. **No status badge** —
    it was dropped from the list card in this pass; only the detail screen still shows one
    (`getStatusPresentation`).
  - **Heading-line actions (as of Epic D Part 4):** the title has `flex: 1` so the
    `FavoriteStar` (active tint `Theme.colors.favoriteGold`) and the **`RecordingActionsMenu`**
    vertical-3-dot button sit as a fixed cluster pinned to the card's right edge regardless of
    title length. The old separate "audio actions row" (`DownloadAudioButton` /
    `DeleteAudioButton`) is **gone** — those two components were deleted and their actions moved
    into the menu. See the "3-dot actions menu" bullet below.
  - Error text for a menu action that failed (`downloadAudioError` / `deleteAudioError` /
    `deleteRecordingError` / `regenerateError`) renders as a small red line at the bottom of
    the card. Same per-row keyed-by-id in-flight/error state as before, now with
    `deletingRecordingIds` / `deleteRecordingErrors` added.
- **What it shows** (layout restyled in Epic D Part 3 — see the "List card restyle" bullet just
  above for the current arrangement): the recording title, the question/prompt line (or "No
  prompt"), a colour-coded mode pill, and the date/time — no status badge (dropped from the list
  card in Part 3), no transcript/feedback text inline (the Phase 3 Step 1 detail screen, below,
  is where that lives, showing the question in full rather than truncated). Mode read
  `miscellaneous` for every row through Phase 3 since Phase
  4's mode selection didn't exist yet; as of Phase 4 Steps 2-4 it genuinely varies
  (`interview`/`story`/`miscellaneous`), and `status` moves `pending` -> `processing` ->
  `done`/`failed` as the real backend pipeline runs.
- **Status badge — detail screen only as of Epic D Part 3.** It used to render on each list row
  too (Step 7: `failed` red / `done` green / neutral `pending`·`processing`, raw hex via
  `getStatusPresentation`); Part 3 removed it from the list card at the design's request. The
  detail screen still shows it unchanged. A `failed` list row is still recoverable — its inline
  "Regenerate report" action keys off `recording.status`, not a visible badge.
- **Question preview per row (Phase 4 Step 5 exit-checkpoint review, done; restyled in Epic D
  Part 3):** `RecordingListItem` renders `recording.question` as a single truncated line
  (`numberOfLines={1}`, `textSecondary`) as the card's secondary line under the title — a plain
  `ThemedText`, not a new component. As of Part 3 it is **always rendered**: a null question
  (miscellaneous, or an interview/story lookup edge case) shows the literal **"No prompt"**
  rather than being omitted, so the card never has a blank gap there. This needed
  `fetchRecordings()`'s `select()` widened to include `question` (see above) — it wasn't in the
  list's original four columns since every recording had `question: null` when that query was
  first written, pre-Phase-4.
- **3-dot actions menu (v2 Epic D Part 4, done):** `RecordingActionsMenu`
  (`src/components/recording-actions-menu.tsx`) — one shared component on both the list card
  (heading line, right of the favorite star) and the detail screen (header row). Presentation is
  a small **popover card that hovers over the row** — a transparent-backdrop `Modal` with an
  absolutely-positioned `<Card>` (same shared fill / inset border / drop shadow as every other
  card) placed from the trigger's `measureInWindow` coords: right edge aligned to the trigger,
  opening downward (flips above if near the screen bottom). Deliberately **not** a full-width
  bottom sheet and **not** `ActionSheetIOS` (the system sheet can't take `Theme` tokens). The
  trigger is **three vertical dots** — the `sf-symbols-typescript` set bundled with this Expo SDK
  has no `ellipsis.vertical`, so it's the horizontal `ellipsis` glyph rotated 90° inside a fixed
  22×22 box (so it lines up with the 20px favorite star beside it). The trigger is a nested
  `Pressable`, so tapping it doesn't fire the row's navigate-to-detail `onPress` (RN responder
  system). Items, in order, each shown conditionally:
  - **Re-practice this question** (v4 Epic I) — `canRePractice` = interview/story **and** has a
    question (`canRePracticeRecording()`); never on Miscellaneous. Navigates to the Record screen
    in a read-only re-practice state; the new recording's `re_practice_of` is set on upload. See
    [Re-practice mode](#re-practice-mode). No confirmation, not destructive.
  - **Download audio** — `canDownload` = `!audio_deleted && audio_path` set. Calls the existing
    `shareRecordingAudio()` (see [Audio download](#audio-download)).
  - **Delete audio** — `canDeleteAudio` = `!audio_deleted`. The existing Phase 3 Step 5
    `deleteRecordingAudio()` endpoint, **unchanged** (row kept, `audio_path`/`audio_deleted`
    cleared, still **no confirmation** — see [Audio delete](#audio-delete)).
  - **Delete recording** — always shown, rendered in `Theme.colors.recordRed`. NEW — the whole
    row + its audio, via the new `deleteRecording()` endpoint. **This one is gated behind an
    `Alert.alert` confirmation** (the only menu action that is). See
    [Delete recording](#delete-recording).
  - **Regenerate report** — `canRegenerate` = `status === 'failed'`. The existing
    `regenerateReport()` (see [Background processing](#background-processing)); the list has no
    room for a dedicated button so the menu is its only entry point here. (The detail screen
    *also* keeps its prominent `ReportSection` "Regenerate report" button — the menu item there
    is redundant but kept for list/detail menu parity.)
  The menu's `busy` prop (any of that row's actions in flight) swaps the ellipsis for a spinner
  and blocks re-opening. Per-row keyed in-flight/error state is unchanged in shape from Phase 3;
  Part 4 adds `deletingRecordingIds` / `deleteRecordingErrors`. On a successful "Delete
  recording" the row is filtered out of local list state (not optimistic — only after the
  backend confirms); on the detail screen a successful delete does `router.back()`.
- **Favorite toggle (Phase 3 Step 4, done):** each row also renders a star icon
  (`FavoriteStar`, `src/components/favorite-star.tsx` — shared with the detail screen below,
  filled `star.fill` vs. outline `star` via `expo-symbols`, same SF Symbols pattern already used by
  `Collapsible`) on the card's heading line, opposite the title (moved there from beside the
  status badge in the Epic D Part 3 restyle; active tint is now `Theme.colors.favoriteGold`).
  Tapping it calls `setFavorite()` (`src/lib/recordings.ts`)
  — a **direct Supabase update, not a backend endpoint**: same reasoning as the recording-cap check
  in [Recording cap](#recording-cap) — RLS already scopes the update to the calling user, there's no
  Gemini/Storage call involved (unlike `/process`/`/regenerate`, which exist as backend endpoints
  specifically to hold the Gemini API key), so a backend round-trip would only add latency. The
  toggle is optimistic: local state flips immediately on tap (`handleToggleFavorite` in
  `HistoryScreen`, per-row in-flight tracked in `favoritingIds`) and reverts only if the update
  itself fails — no waiting on a refetch/poll tick to see the new state. **Purely a personal
  marker** — favoriting a recording has no effect on the cap, retention, or delete behavior (Step
  5); favorite and delete are fully independent, by design (see [Database](#database)).
- **Delete audio / Download audio** — as of Epic D Part 4 these are **menu items**, not
  standalone row icons (the `DeleteAudioButton` / `DownloadAudioButton` components were
  deleted). Behaviour is unchanged: Delete audio calls the Phase 3 Step 5 backend endpoint
  (see [Audio delete](#audio-delete)), no confirmation, not optimistic; Download audio calls
  `shareRecordingAudio()` (see [Audio download](#audio-download)). Both menu items are simply
  absent when `audio_deleted` is `true` (Download also absent if `audio_path` is somehow
  falsy). See the "3-dot actions menu" bullet above.
- Refresh: the list refetches on every focus (`useFocusEffect`, not a mount-only effect) so
  landing here from a fresh upload — or tabbing back after a second recording — always shows
  current data, since tab screens stay mounted in the background rather than remounting on
  switch. Pull-to-refresh (`RefreshControl`) covers the same case manually.
- **Status polling (Step 7, done):** while this tab is focused, a 1.5s interval refetches the list
  as long as any row is still `pending`/`processing` (`TERMINAL_STATUSES` = `done`/`failed`) —
  stops firing entirely once every row has reached a terminal state, and resumes automatically if
  a new non-terminal row shows up (e.g. a fresh upload). This is list-level, not literally
  per-row — `fetchRecordings()` is one query for the whole list, not one request per row, so
  there's no separate "stop polling this one row" mechanism to build; a finished row riding along
  in an in-flight tick's response is free (same one query either way), which is why the query
  itself isn't scoped down to just non-terminal rows — not worth the complexity at this app's
  scale (max 30 rows/user). Guards against out-of-order responses: each `load()` call gets a
  monotonically increasing id (`requestSeqRef`), and a response is only applied if it's still the
  most recently *issued* request when it resolves — otherwise it's discarded as stale. This fixes
  the flashing-stale-status bug flagged in Step 3's review (a slower, older request resolving after
  a faster, newer one used to briefly overwrite fresh state). Polling only runs while the tab is
  focused (kept from Step 2 — no reason to poll a screen the user isn't looking at). A flat 1.5s
  interval was kept rather than backoff (e.g. faster right after upload, slower the longer a row
  stays non-terminal): the pipeline normally finishes in well under a minute, so a flat interval
  costs at most a few dozen cheap Supabase queries per recording — backoff would be complexity
  without a real payoff at this scale. Worth revisiting only if a `pending`/`processing` row is
  ever seen sitting non-terminal for an unusually long time (more likely a sign of a stuck backend
  process than something polling interval tuning would fix).
- Loading (first fetch only, not on subsequent focus refetches — those update the list silently
  once data arrives so switching tabs doesn't re-blank it), empty, and fetch-error (with a Retry
  action, and without clearing any previously-loaded list) states are all handled explicitly.
- Upload → History handoff: **removed in v2 Epic C Part 4.** The Record tab used to
  `router.navigate('/history')` right after a successful upload; now it **stays on the Record
  screen** and shows live processing status inline (`ProcessingStatus` component), with a "See
  more details" link to *this* recording's detail screen once done. See
  [Mode selection](#mode-selection)'s "Post-recording flow" bullet for the full behaviour.
- **Detail screen (Phase 3 Step 1, done; visually restyled in v2 Epic D Part 7):** tapping a row
  pushes `src/app/(tabs)/history/[id].tsx` (`router.push({ pathname: '/history/[id]', params: { id
  } })` from `RecordingListItem`), a dynamic Expo Router route sitting alongside `index.tsx` in the
  same `history/` directory — `history/_layout.tsx` wraps both in a headerless `Stack` (matching
  every other screen's no-native-header convention) rather than letting the default nested-stack
  header appear only here. It fetches the full row with `fetchRecordingById()`
  (`src/lib/recordings.ts`; relies on the existing `recordings` select RLS policy to make a bad id
  or another user's id come back as `null` instead of a 403 the frontend has to special-case).
  Loading and not-found/error states (bad id, RLS-blocked id, or a genuine fetch failure) are all
  handled explicitly, the last two with a Retry action.
  - **Layout, top to bottom, as of Part 7's restyle** (all `Theme` tokens, no pure white/black,
    Noto Sans throughout — the same design system as the rest of v2):
    1. **Header row:** the **editable `title`** (Part 2 — see below) as a large bold heading
       (`styles.titleText`, 24px `Theme.typography.fontFamily.bold`, up to 3 lines, muted
       "Untitled recording" for a `NULL` title), `flex: 1` so it shares the row with a fixed
       right-hand cluster: the `FavoriteStar` and the Part 4 `RecordingActionsMenu` (3-dot menu)
       — the same heading-row pattern as the List card (Part 3/4), at a larger scale.
    2. **Meta row:** the colour-coded mode pill (`modePillColors()`, now shared with the List card
       via `src/lib/modes.ts` — see the "List card restyle" bullet below) plus the status badge
       (`getStatusPresentation`) on the left, the date/time (`formatRecordedAt`) right-aligned
       opposite them.
    3. **Question, always shown** (Part 7 change — see the bullet below): the full `question`
       text, or the literal **"No prompt"** for a null one (miscellaneous, or an interview/story
       lookup edge case) — never omitted, mirroring the List card's Part 3 "No prompt" pattern
       rather than the old conditional-render.
    4. **Audio section**, in a `<Card>`: see the "Audio playback restyle" bullet below for
       `pending`/`failed` rows too — playback exists independently of pipeline `status` since
       audio uploads before processing ever starts.
    5. **`ReportSection`** — `failed`/`pending`/`processing` notices, or (once `done`) **Scores →
       Feedback → Transcript**, in that order (a quick glance first, then the coaching prose, then
       the raw transcript last as reference) — see the "Scores badges" and "Failed state" bullets
       below. The leading section was Metrics stat blocks through Epic D; **v3 Epic F Step 1
       replaced it with the three score badges** (the raw filler/WPM/repetition numbers no longer
       appear on this screen at all).
  - **Title editing (v2 Epic D Part 2, done):** `TitleSection` — the title text + a pencil,
    tapping which opens a pre-filled input box (confirm saves via `updateRecordingTitle`, a direct
    Supabase update; "Cancel" reverts). Handles a `NULL` title (starts empty, shows a muted
    "Untitled recording"). Full detail — interaction, the endpoint-vs-direct call, the
    not-optimistic save — is in [Recording titles](#recording-titles)'s "Editing (Part 2)"
    subsection, including the **Part 7 bug fix** (a `title_edited_by_user` flag that stops a later
    pipeline run from overwriting a hand-set title).
  - **Question display (Phase 4 Step 5 exit-checkpoint review, done; changed to always-shown in
    Part 7):** `fetchRecordingById()` selects `question` (since Phase 3 Step 1), and a "Question"
    label + the full text renders right under the meta row, above audio playback. Through Epic D
    Part 6 this only rendered `if (recording.question)`, i.e. omitted entirely for miscellaneous;
    **Part 7 changed it to always render**, showing the literal "No prompt" for a null question —
    matching the List card's established Part 3 pattern (a mode's "no question" state is a visible,
    consistent piece of UI, not an absence) and closing the one inconsistency between the two
    screens' treatment of a null question.
  - **Audio playback restyle (v2 Epic D Part 7, done):** `AudioSection`'s "ready" branch now
    renders inside the same `<Card>` as its deleted/missing/error branches (previously only those
    three used a card; the real player rendered bare) — a **pill-shaped Play/Pause button**
    (`Theme.colors.accent` fill, `play.fill`/`pause.fill` `SymbolView` + label in
    `Theme.colors.onAccent`), a token-coloured progress bar (`Theme.colors.border` track,
    `Theme.colors.accent` fill), and elapsed/duration text (`"0:00 / 4:16"`, `formatDuration`).
    This restyle lives in the shared `AudioPlaybackControls` component
    (`src/components/audio-playback-controls.tsx`), so the **Home tab's post-recording preview**
    (`RecordingPlayback` in `index.tsx`) picks up the identical look for free — one component, one
    restyle, both call sites. The `audio_deleted` / no-`audio_path` / load-error notices (Phase 3's
    existing conditionals) are unchanged in behaviour, just restyled as plain text inside the same
    Card rather than a separate nested one.
  - **Scores badges (v3 Epic F Step 1, done — replaces the Epic D "Metrics restyle"):**
    `ScoresRow` renders the three v3 scores — **Impact / Clarity / Structure**, that order — as
    compact badges in one `<Card>` (the exact visual treatment the Epic D Part 7 `MetricsRow` had:
    hairline dividers, a bold value on top, a muted label under). Each value is a plain
    `${score}%`, an em dash for an individual `NULL` score, no trend arrows (a single recording has
    no history). If **all three** scores are `NULL` (a pre-v3 recording, or every score missed
    generation) it shows one "Scores aren't available for this recording." line instead of a card
    of dashes. **The old `MetricsRow` / `formatMetrics` and the raw filler-rate / WPM / repetition
    display are deleted from this screen** — those numbers still compute and store in
    `recordings.metrics`, they just don't render here any more; they resurface only in Streaks →
    Clarity's detail screen (Epic G). `fetchRecordingById()` stopped selecting `metrics` and now
    selects the four score columns instead.
  - **`status === 'failed'`** shows a clear failed notice (heading in `Theme.colors.recordRed`)
    instead of a scores/feedback/transcript section — there isn't one, since a transcription
    failure marks the row failed with nothing else attempted (see [AI processing
    endpoint](#ai-processing-endpoint)) — plus, as of Phase 3 Step 2, a **"Regenerate report"**
    button right alongside it (`ReportSection` in `history/[id].tsx`; restyled in Part 7 as a
    filled `Theme.colors.recordRed` pill with `Theme.colors.onAccent` text, matching the menu's own
    destructive-action colour). `pending`/`processing` (a row can be tapped into straight from
    History before the pipeline finishes) shows a plain "still processing" notice instead, rather
    than rendering `null` transcript/feedback as if that were the real, finished content.
  - **"Regenerate report" (Phase 3 Step 2, done):** the failed-state button above calls
    `regenerateReport()` (`src/lib/api.ts`) against the new `POST /recordings/{id}/regenerate`
    endpoint (see [AI processing endpoint](#ai-processing-endpoint)'s "Regenerate endpoint" bullet
    and [Background processing](#background-processing)'s "Regenerate report" bullet for the
    backend side), with its own in-flight spinner and inline error text scoped to the button
    (`regenerating`/`regenerateError` state in `RecordingDetailScreen`) — a failure here doesn't
    disturb the rest of the screen. On success, the screen optimistically flips its local
    `recording.status` to `processing` (matching what `process_recording()` sets as its own first
    step — see [Background processing](#background-processing)) so the existing pending/processing
    UI above takes over immediately with no separate "regenerating" display to build. The same
    action is also available per-row directly from the History **list** — see the list's status
    bullet below — so it's reachable whether the user is looking at a row in the list or has
    already tapped into its detail view.
  - **This screen's own polling (Phase 3 Step 2):** the History list's Step 7 polling (below) is
    scoped to the list's own component state and only runs while the list tab itself is focused —
    it does nothing for a screen further up the navigation stack, so it would **not** have picked
    up this recording moving `processing` -> `done`/`failed` if the user stayed on the detail
    screen after tapping "Regenerate report" rather than backing out to History. This screen
    therefore has its own equivalent, small polling effect (same shape: a flat 1.5s interval, gated
    on this screen being focused via `useFocusEffect`, an out-of-order-response guard via a shared
    `requestSeqRef`, stopping once `recording.status` is terminal per `TERMINAL_STATUSES` — now
    exported from `src/lib/recording-status.ts` so both screens use the same definition — and
    updating `recording` in place with no loading-spinner flicker). If the user instead backs out
    to the list after regenerating, the list's own Step 7 polling picks the row up correctly with
    no changes needed there — its `stillInFlight` check only cares whether *any* row is
    non-terminal, regardless of what put a row into that state.
  - **Favorite toggle (Phase 3 Step 4, done):** the same `FavoriteStar` component sits next to
    the status badge in this screen's header row, wired to its own `handleToggleFavorite` —
    identical optimistic-then-persist pattern as the list (flip `recording.favorite` locally,
    call `setFavorite()`, revert on failure) so the star responds instantly here too. Since the
    list refetches on every focus and this screen refetches fresh on mount (`fetchRecordingById`
    already selects `favorite`), toggling in either place is reflected in the other without any
    extra plumbing — a favorite set from the list shows correctly here on push, and one set here
    shows correctly in the list on navigating back.
  - **Audio playback reuses the exact `expo-audio` pattern from the Phase 1 record-and-preview
    flow**, now extracted into a shared `AudioPlaybackControls` component
    (`src/components/audio-playback-controls.tsx`; see [Recording](#recording)) so this screen and
    the Home tab's post-recording preview don't duplicate the play/pause/progress-bar logic.
    Playback here is driven by a signed Storage URL (`getRecordingAudioUrl()`, 1-hour expiry,
    `src/lib/recordings.ts` — the `recordings-audio` bucket is private, so this is how the client
    gets a fetchable URI at all) rather than a local file, but `useAudioPlayer(uri)` doesn't care
    which kind of URI it's given, so no extra branching was needed in the shared component itself.
  - **`audio_deleted` is checked and shows a clear "audio deleted" message in place of playback
    controls** — built in Step 1 before anything set that flag `true`; the menu's "Delete audio"
    action (see [Audio delete](#audio-delete)) is what sets it, with no revisiting of this
    conditional needed. A missing `audio_path` on an otherwise-real row (shouldn't happen, given
    upload-then-insert — see [Upload](#upload)) is handled the same defensive way rather than
    crashing.
  - **3-dot actions menu (v2 Epic D Part 4, done):** the same `RecordingActionsMenu` as the
    list card, in this screen's header row after the `FavoriteStar`. Carries **Re-practice this
    question** (v4 Epic I — interview/story with a question only), **Download audio**,
    **Delete audio**, **Delete recording**, and (when failed) **Regenerate report** — same
    conditional visibility, same underlying calls (`rePracticeNavParams()` + `router.navigate`,
    `shareRecordingAudio()`,
    `deleteRecordingAudio()`, the new `deleteRecording()`, `regenerateReport()`). `AudioSection`
    is now **playback only** — the old inline "Download audio" / "Delete audio" rows below the
    player are gone (as are the `DownloadAudioButton` / `DeleteAudioButton` components). Menu-
    action errors render as a small red block just under the meta row. On a successful "Delete
    recording", `router.back()` returns to the list. **Part 7 kept this menu as-is** — the design
    screenshots used for the Part 7 restyle show separate inline "Download"/"Delete" text links on
    this screen (matching Section 3's original spec), but that was a pre-Part-4 layout; Part 4's
    consolidation into one menu (for parity with the List card) was deliberately not reverted, and
    Part 7 only restyled everything *around* it. See [History](#history)'s "3-dot actions menu"
    bullet and [Delete recording](#delete-recording).

## Audio delete

Phase 3 Step 5 — the real mechanism that frees a slot under `MAX_RECORDINGS_PER_USER` (see
[Recording cap](#recording-cap)); before this step, the only way to drop below the cap was
deleting rows by hand in the Supabase dashboard. **No confirmation dialog** — an explicit product
decision: delete is immediate on tap, from either the list or the detail screen, even for a
favorited recording. Favorite (Step 4) and delete are fully independent — favoriting has no effect
on this at all.

- **Endpoint, not a direct-Supabase call:** `DELETE /recordings/{recording_id}/audio`
  (`delete_audio` in `backend/app/routers/recordings.py`), same bearer-token auth and ownership
  check as `/process`/`/regenerate` (via the same `_fetch_authorized_recording` helper, now also
  selecting `audio_path`/`audio_deleted` so this endpoint doesn't need a second round-trip). This
  is a deliberate departure from the Step 3/4 pattern (`getActiveRecordingCount`, `setFavorite` —
  direct Supabase calls from the frontend): those have no Storage component and RLS already scopes
  them correctly, so a backend round-trip only adds latency. Deleting audio is different — it's a
  Storage delete *and* a DB update that both need to happen, and a partial failure between two
  independent client-side calls (Storage succeeds, DB update fails, or vice versa) would leave the
  row and the actual file disagreeing with no clean way to detect or recover from that from the
  client alone. Storage RLS also has **no delete policy** on the `recordings-audio` bucket
  (`supabase/migrations/0002_storage_bucket.sql` — this was anticipated when that migration was
  written) — client-side delete would need a new RLS policy opening that up, for a case that's
  more cleanly handled server-side anyway. Routing it through the backend means one place owns the
  ordering below and returns a single clear success/failure to retry against.
- **The operation, storage-first:** delete the Storage object at `audio_path` (service-role
  client, bypassing the missing RLS policy above), *then* update the row —
  `audio_deleted = true` and `audio_path` cleared to `null` (not kept for a historical record: no
  code has a reason to read a known-deleted path, and keeping it risks something later trying to
  use it for playback without checking `audio_deleted` first). This ordering mirrors
  `uploadRecording`'s "Storage first, then the DB write" principle (see [Upload](#upload)) run in
  reverse: if the DB write fails after a successful Storage delete, the row still has its
  (now-stale) `audio_path`, so a retry can find it, re-attempt the (idempotent) Storage delete, and
  complete the DB write — self-healing. Clearing `audio_path` first instead would risk losing the
  only reference to a file that then fails to delete, orphaning it with no way to retry. Row,
  transcript, feedback, and metrics are all left untouched — only `audio_path`/`audio_deleted`
  change.
- **Already-deleted is a no-op success, not an error:** if the row is already `audio_deleted`, the
  endpoint returns success immediately without touching Storage again — covers a double-tap, or
  deleting the same recording from the list and the detail screen in quick succession. This relies
  on deleting an already-missing Storage object itself being a no-op rather than an error (standard
  idempotent-delete semantics), which is what makes it safe for two near-simultaneous requests to
  both reach the Storage call before either has updated the row.
- **Frontend:** `deleteRecordingAudio()` (`src/lib/api.ts`, a `DELETE` against `/audio` via the
  shared `authorizedRecordingRequest` helper) is called from the **"Delete audio" item in the
  `RecordingActionsMenu`** (v2 Epic D Part 4) on both the History list and the detail screen —
  previously a standalone bin icon in each. Both call sites are
  **deliberately not optimistic**, unlike the favorite toggle: local state only flips to
  `audio_deleted: true` once the backend confirms the delete actually completed, rather than
  flipping immediately and risking a brief "audio deleted" flash for audio that's still there (or
  the reverse on a failed revert). A failure shows an inline per-row/per-screen error instead,
  telling the user to try again — the same in-flight/error-state shape (keyed by id in the list, a
  couple of `useState`s in the detail screen) already used for regenerate and favorite.
- **Verification status:** backend compiles, the full existing pytest suite still passes, and the
  frontend type-checks clean — but this step hasn't yet been exercised against the running Expo
  app + live Supabase project (delete from list, confirm detail screen updates; delete from
  detail, confirm list updates; confirm the Storage object is actually gone in the dashboard;
  confirm transcript/feedback/metrics survive; confirm `getActiveRecordingCount` drops). That
  manual pass is still needed before calling this step fully done — see
  [Recording cap](#recording-cap)'s "How this was tested" bullet for the equivalent Step 3 pass to
  follow the same shape of.

## Delete recording

v2 Epic D Part 4 — the **new**, stronger sibling of [Audio delete](#audio-delete). "Delete
audio" keeps the row (and its transcript / feedback / metrics), clearing only the audio file;
"Delete recording" removes **the whole `recordings` row and its audio file together**,
irreversibly. It's the third item in the `RecordingActionsMenu` (see [History](#history)'s
"3-dot actions menu" bullet), rendered in `Theme.colors.recordRed`, on both the list card and
the detail screen.

- **Endpoint:** `DELETE /recordings/{recording_id}` (`delete_recording` in
  `backend/app/routers/recordings.py`), bearer-token auth, ownership-checked. A backend
  endpoint for the **same reason as `/audio`**: a Storage delete + a DB write both have to
  happen and must not disagree, and the `recordings-audio` bucket has no client-side delete RLS
  policy. The row delete uses the **service-role client, which bypasses RLS**, so **no
  `recordings` DELETE RLS policy was added** — 0001's "add one deliberately if a delete feature
  shows up" note is satisfied by keeping deletion server-side. **No new migration** — nothing
  about the schema changed.
- **The operation:** fetch + ownership-check the row; if it still has audio (`audio_deleted`
  false and `audio_path` set) remove the Storage object first (502 on Storage failure, so the
  row survives for a retry — same storage-first ordering as `/audio`); then
  `client.table("recordings").delete().eq("id", …)`.
- **Recording-cap interaction — none needed, and this is the answer to "does deleting the row
  handle the cap itself?": yes, entirely.** Both the frontend pre-check
  (`getActiveRecordingCount`, `src/lib/recordings.ts`) and the Postgres backstop trigger
  (`enforce_recording_cap()`, `0004_recording_cap_enforcement.sql`) count `recordings` rows
  where `audio_deleted = false`. A row that no longer exists simply isn't in that count — so
  deleting a recording frees a cap slot for free, exactly the way clearing `audio_deleted`
  does, with no decrement or bookkeeping anywhere. (Contrast: if the cap were ever stored as a
  counter column, this would need an explicit decrement — it isn't, so it doesn't.)
- **Idempotent (the double-tap case, same spirit as `/audio`'s early-return):** once the row is
  gone, a repeat call returns `{"deleted": true}` rather than a 403/404 — the endpoint does its
  own row fetch (not via the shared `_fetch_authorized_recording` helper, which 403s an absent
  row) and treats "row not found" / a malformed id as already-done success. A row that exists
  but belongs to **someone else** still returns 403. In practice the UI also prevents a
  double-fire (the menu's `busy` prop disables the trigger while a delete is in flight, and on
  success the row is removed from the list / the detail screen navigates away).
- **Confirmation dialog — YES for this action, deliberately, even though "Delete audio" has
  none.** This was a considered UX/safety tradeoff: "Delete audio" is a smaller, softer loss
  (the report — the actually-valuable output — stays; the audio was already exportable), so its
  no-confirmation immediacy (an explicit Phase 3 Step 5 product decision) still holds.
  "Delete recording" permanently destroys the transcript, feedback, metrics **and** the row —
  there's no undo and nothing left afterward — and it's a menu item, which is exactly the kind
  of thing a stray tap hits. So `RecordingActionsMenu` fires an `Alert.alert("Delete
  recording?", …, [Cancel, {Delete, destructive}])` and only calls through on confirm. The
  confirmation lives **in the menu component**, so both the list and the detail screen get it
  automatically and identically.
- **Frontend:** `deleteRecording()` (`src/lib/api.ts`) — a `DELETE /recordings/{id}` via the
  shared `authorizedRecordingRequest` helper (Part 4 refactored `postRecordingAction` /
  `deleteRecordingAudio` / this to all go through one helper). Not optimistic (matches
  `deleteRecordingAudio`): the list row is filtered out of state / the detail screen calls
  `router.back()` only **after** the backend confirms. Per-row keyed in-flight/error state on
  the list (`deletingRecordingIds` / `deleteRecordingErrors`), a pair of `useState`s on the
  detail screen (`deletingRecording` / `deleteRecordingError`). A failed delete shows an inline
  red error and leaves everything in place.
- **Verification status:** backend `pytest` suite still passes (42 tests — no new router tests
  added, consistent with `/audio` and `/regenerate` having none either), `npx tsc --noEmit` and
  `expo lint` both clean. **Not yet exercised on the physical test iPhone** — the manual pass
  should: open the menu from a list row and confirm all 4 items appear (Regenerate only on a
  `failed` row); run Download / Delete audio / Regenerate from their new menu location and
  confirm unchanged behaviour; run "Delete recording" on a throwaway recording and confirm the
  **entire row** disappears from History (not just its audio), the Storage object is gone from
  the Supabase dashboard, and the active-recording count drops by one; repeat the menu check on
  the detail screen and confirm `router.back()` lands on the list with the row gone.

## Audio download

Phase 3 Step 6 — the last step of Phase 3. Per docs/PROJECT_PLAN.md's "manual Download button"
spec (Section 2, and Section 3's "save/download buttons"): exports a recording's audio file to the
user's device via `expo-file-system` + the native share sheet (`expo-sharing`), **not** a raw
blob/data-URI download — that pattern is unreliable on iOS, the only platform this app runs on via
Expo Go (see [Conventions](#conventions)). Pairs naturally with [Audio delete](#audio-delete) as an
"export before delete" flow (as of v2 Epic D Part 4 both are items in the `RecordingActionsMenu`,
Download listed first), but the two are **fully independent actions with no forced ordering** —
nothing about download touches `audio_deleted`/`audio_path`, and nothing requires a download
before a delete.

- **No backend endpoint — unlike delete, this is a direct-Supabase-plus-on-device flow.** Playback
  already established the pattern this reuses: `getRecordingAudioUrl()` (`src/lib/recordings.ts`)
  gets a signed, time-limited Storage URL, which Storage RLS ("Users can read their own audio
  files", `0002_storage_bucket.sql`) already scopes correctly to the calling user. Delete needed
  the backend because it's a Storage delete *and* a DB update that must not disagree (see
  [Audio delete](#audio-delete)'s reasoning); download is a pure read plus an on-device
  file/share-sheet operation neither Supabase nor a backend round-trip has any part in, so there's
  nothing here for a backend endpoint to add beyond latency.
- **The flow, in `shareRecordingAudio(audioPath)` (`src/lib/recordings.ts`):** (1) confirm
  `Sharing.isAvailableAsync()` first, so an unavailable share sheet fails clearly rather than after
  an unnecessary download; (2) get a signed URL via the existing `getRecordingAudioUrl()`; (3)
  `File.downloadFileAsync()` (`expo-file-system`'s current, non-legacy API — same one
  `uploadRecording()` already uses for the reverse direction) it into a uniquely-named file
  (`Date.now()`-suffixed, so two downloads fired close together can't collide) under `Paths.cache`
  — not `Paths.document`, since the file only needs to survive long enough for the share sheet to
  read it, and `cache` is the directory the OS is allowed to reclaim under storage pressure; (4)
  `Sharing.shareAsync()` on that local file, opening the native share sheet (Files, AirDrop,
  Messages, etc.); (5) delete the temp cache file in a `finally`, regardless of whether anything was
  actually shared — no reason to accumulate temp copies of already-uploaded audio.
- **A cancelled share sheet is not an error, by construction, not by a special case in this app's
  code.** `expo-sharing`'s iOS module resolves `shareAsync()`'s promise identically whether the
  user completed a share or dismissed the sheet without picking anything (its
  `completionWithItemsHandler` calls `promise.resolve(nil)` in both the "completed" and the
  "dismissed without action" branches) — there's no distinct "user cancelled" rejection for this
  code to catch or suppress. Practically: a cancel just resolves `shareRecordingAudio()` normally,
  same as a completed share, so the calling screen's in-flight spinner clears with no error text,
  which is exactly the desired behavior. Only a genuine failure (no network fetching the signed URL,
  the URL rejecting the download, `isAvailableAsync()` returning `false`) throws and surfaces an
  inline error.
- **`audio_deleted` handling:** the "Download audio" menu item isn't shown at all whenever
  `audio_deleted` is `true` (or, defensively, `audio_path` is falsy) — `RecordingActionsMenu`'s
  `canDownload` prop is `!recording.audio_deleted && !!recording.audio_path`, computed the same
  way on the list and the detail screen. Same "don't offer a button that would just fail"
  judgment as before.
- **Frontend:** `shareRecordingAudio()` is called from the **"Download audio" item in the
  `RecordingActionsMenu`** (v2 Epic D Part 4) on both the list and the detail screen —
  previously a standalone download icon in each. Same per-row/per-screen
  in-flight-and-error-state shape already used for delete/regenerate/favorite
  (`downloadingAudioIds`/`downloadAudioErrors` in the list, a couple of `useState`s in the detail
  screen) — a failed download on one row doesn't disturb any other row or the rest of the screen.
- **Dependencies:** `expo-file-system` was already a dependency (used since Phase 1's upload flow
  for its current `File`/`Paths` API, not the deprecated legacy API); `expo-sharing` is new as of
  this step, installed via `npx expo install expo-sharing` so npm resolved the SDK-54-compatible
  version automatically (`~14.0.8`) rather than picking a version by hand.
- **Verification status:** frontend type-checks clean, but — same caveat as
  [Audio delete](#audio-delete)'s Step 5 — this hasn't yet been exercised on the physical test
  iPhone (download from the list and confirm the share sheet opens and a save/share actually
  completes; same from the detail screen; confirm the icon is genuinely absent, not just disabled,
  once a recording's audio has been deleted; cancel out of the share sheet once on purpose and
  confirm no error text appears). That manual pass is the one still needed before trusting this
  completely — see [Phase 3 assessment](#phase-3-assessment).

## Phase 3 assessment

Same spirit as the Phase 1/Phase 2 wrap-ups: does Phase 3's revised scope (history detail view,
regenerate, cap enforcement, favorite, manual delete, download — Sections 3/4/5/7 of
docs/PROJECT_PLAN.md, not the stale Section 6 description) work end-to-end, and what's still shaky
before starting Phase 4?

- **Built and internally consistent:** every Phase 3 feature above compiles/type-checks together,
  the backend's existing pytest suite passes, and each feature was designed to compose with the
  others without hidden coupling — favorite and delete are independent (Step 4), download and
  delete are independent (Step 6), regenerating a failed row is picked up by the same polling that
  already existed for a fresh upload (Step 2), and the cap check degrades safely (fails open) if its
  own query fails (Step 3). No feature in this phase reaches into another's state directly; each
  goes through the shared `recordings`-row shape and its own small, scoped in-flight/error state.
- **What's confirmed on a physical device already:** Step 3 (recording cap) — deliberately tested
  end to end with the cap temporarily lowered to 2, both blocked-at-cap and works-below-cap
  behavior confirmed, then restored to 30 (see [Recording cap](#recording-cap)'s "How this was
  tested" bullet). This is the one Phase 3 feature with a real on-device pass already behind it.
- **What's still shaky — not yet exercised on the physical test iPhone, only type-checked/unit-
  tested:** Step 1 (detail screen), Step 2 (regenerate, both entry points), Step 4 (favorite, both
  entry points), Step 5 (delete, both entry points, plus confirming the Storage object is actually
  gone and `getActiveRecordingCount` actually drops), and Step 6 (download, both entry points, plus
  the cancelled-share-sheet case specifically). None of these have known bugs — they follow patterns
  (optimistic vs. non-optimistic state, per-row in-flight tracking, shared components between list
  and detail) that are already proven elsewhere in the app — but "type-checks and passes unit tests"
  and "confirmed working in Expo Go against the live Supabase project" are different claims, and
  only the former is true for five of Phase 3's six steps right now. **Recommend one focused manual
  pass through History (list and detail, one recording) before starting Phase 4:** favorite it,
  download its audio (verify the share sheet, verify a cancel produces no error), delete its audio
  (verify the bin/download icons both disappear, verify the list and detail screens agree), and — on
  a separate recording — trigger a failure and confirm "Regenerate report" recovers it. That single
  pass would cover Steps 1, 2, 4, 5, and 6 together.
- **Nothing found that blocks starting Phase 4** — the shakiness above is "unverified," not
  "known-broken." Phase 4's one concrete carry-over item, the cap check needing to move from the
  Home tab's old record button to whatever screen becomes the new entry point into recording, is
  now done as of Phase 4 Step 2 — see [Recording cap](#recording-cap) and [Mode
  selection](#mode-selection).

## Question pool (v1)

**Removed in v4 Epic H Step 2.** Phase 4 Step 1 shipped a fixed pool of 25 interview + 25 story questions as static in-app data
(`src/lib/questions.ts`, `type Question = { id, mode, text }`, ids `interview-01`…`story-25`),
with `getQuestionsForMode` / `getQuestionById` helpers and the `QuestionMode` type. It was the
runtime pool for v1–v3.

**v4 Epic H removed it.** `0009_seed_question_pool.sql` copied those exact 50 prompts into the
`questions` DB table as the starting global pool (that migration is now the only place the text
lives), and **Epic H Step 2 deleted `src/lib/questions.ts`** — the Record flow reads
`GET /questions/daily` instead (see [Question selection](#question-selection) and
[Daily questions](#daily-questions)). `RecordingMode` in `src/lib/recordings.ts` is now a
self-contained literal union rather than `QuestionMode | 'miscellaneous'`.

## Phase 4 exit checkpoint

Phase 4 Step 5 — same spirit as the [Phase 3 assessment](#phase-3-assessment): does Phase 4's full
scope (hardcoded question pool, mode selection, real question-selection logic with exclusion,
custom topic input) hold together as one coherent user journey, and what's confirmed working versus
still unverified before calling v1 done? This step was a full-app read-through (`index.tsx`,
`history/index.tsx`, `history/[id].tsx`, `recordings.ts`, `question-selection.ts`,
`recording-status.ts`, and the backend's `processing.py`/`feedback.py`/`recordings.py` router, read
together as one user journey rather than file-by-file) plus a small number of fixes the review
surfaced, not new feature work — Phase 4's actual features (Steps 1-4) were already built and
documented in [Question pool (v1)](#question-pool-v1), [Mode selection](#mode-selection), and
[Question selection](#question-selection) before this step started.

- **Built and internally consistent, confirmed by reading the code, not assumed:** the full journey
  — mode select → question (pool or custom) → record → upload → `startProcessing()` → backend
  pipeline (transcribe → metrics → feedback, reading whatever real `mode`/`question` the row was
  inserted with) → History list/detail → favorite/delete/download/regenerate — has no broken link
  in it. Specifically checked, not assumed: `process_recording()` (`backend/app/services/
  processing.py`) re-reads `mode`/`question` fresh from the row rather than assuming
  `miscellaneous`/`null`, and passes them into `generate_feedback()` unchanged; `uploadRecording()`
  and `pickQuestionForMode()` (see [Question selection](#question-selection)) never needed to
  change for Step 4's custom-topic input, since both already treated `question` as an opaque
  string regardless of where it came from.
- **Gap found and fixed: History never displayed `question` anywhere.** `fetchRecordingById()` had
  selected `question` since Phase 3 Step 1, but neither the detail screen nor the list ever
  rendered it — harmless while every recording had `question: null` (pre-Phase-4), but a real gap
  once Phase 4 Steps 3-4 gave interview/story recordings a real chosen or custom-typed question:
  there was no way to see what prompt you'd answered anywhere in History, only the transcript/
  feedback that resulted from it. Fixed as part of this checkpoint, not deferred: the detail screen
  now shows the full question text (a "Question" label + text, right under mode, above audio
  playback) and the list shows a one-line truncated preview per row — see
  [History](#history)'s "Question display" and "Question preview per row" bullets for the exact
  implementation. This needed one small, low-risk query change (`fetchRecordings()`'s `select()`
  widened to include `question`, since the list's original four-column query predated Phase 4) —
  everything else about `uploadRecording()`/`pickQuestionForMode()` was already correct and needed
  no change, per the bullet above.
- **Two stale code comments fixed, no behavior change:** `backend/app/services/feedback.py`'s
  `MODE_CRITERIA` comment and a comment in `backend/tests/test_feedback.py` both still said
  "Phase 4 hasn't built mode selection yet" / "every recording today has question=null" — true when
  Step 5 of Phase 2 wrote them, stale now that Phase 4 Steps 2-4 exist. Reworded to describe what
  was true *then* (Phase 2 Step 5, pre-Phase-4) rather than asserting it as still true now. Caught
  by this step's full-file read-through — exactly the kind of "leftover state from an earlier step
  that no longer makes sense" this checkpoint was looking for; nothing else in that sweep turned up
  a similar staleness or naming mismatch.
- **What's confirmed via type-checking/code review, not yet on-device:** everything in this phase.
  `npx tsc --noEmit` is clean and the backend's full pytest suite (38 tests) passes, but — same
  caveat as every Phase 3 step carried into [Phase 3 assessment](#phase-3-assessment) — "type-checks
  and passes unit tests" and "confirmed working in Expo Go against the live Supabase project" are
  different claims. Phase 3's own on-device gap (Steps 1, 2, 4, 5, 6 unverified) is still
  outstanding too; it was never closed out by a manual pass, so this checkpoint's test script below
  covers both phases' backlog in one run rather than layering a second separate pass on top.
  Only Phase 3 Step 3 (recording cap) and Phase 1's core record/upload/auth loop have a confirmed
  on-device pass behind them so far (see [Phase 3 assessment](#phase-3-assessment) and
  [Upload](#upload)).
- **Nothing found that blocks calling v1 feature-complete.** The one gap this review surfaced
  (question display) is fixed above, not just flagged. Custom topic input's own edge case — does
  typing a custom question still exclude correctly on the next pick? — was already reasoned through
  and confirmed by reading `pickQuestionForMode` in [Question selection](#question-selection); this
  checkpoint's full-app read-through didn't find anything that contradicts that. What remains is
  purely the on-device verification pass below — no more code review or new features between here
  and v1.

**Full v1 end-to-end test script** (run in one pass; supersedes doing Phase 3's and Phase 4's
individual step-by-step spot checks separately — see the assessments above for what each spot check
would have covered on its own):

1. Fresh app open, sign in (or sign up if needed) — confirm you land on the Home tab, not stuck on
   a loading screen.
2. Go to History — with fewer than 30 active recordings, confirm the list loads normally (or shows
   the empty state on a brand-new account) with no cap-blocked message.
3. Back on Home, tap **Interview** — confirm a real pool question renders (not a placeholder), then
   record a short take, keep & upload it.
4. Watch it process: either stay on Home and navigate to History manually, or go straight there —
   confirm the new row appears `pending`/`processing` and moves to `done` within well under a
   minute with no manual refresh needed (Step 7 polling).
5. On that `done` row in the list: confirm mode reads `interview`, the pool question you were asked
   shows as a one-line preview, and the status badge is green "Done".
6. Tap into the detail screen: confirm date/time, mode, the **full** question text, audio playback
   (plays back correctly), transcript, metrics (filler-word %, wpm, repetition count), and feedback
   all render and look sane relative to what you actually said.
7. Tap the star to favorite it — confirm it fills immediately, then back out to the list and confirm
   it shows favorited there too without needing a refresh.
8. Back on Home, tap **Story**, and this time type a **custom** question/topic instead of using the
   suggested one (`"Use this instead"`) — confirm it advances straight to recording with your typed
   text, not the pool question. Record and upload.
9. Once that row is `done`, check its detail screen: confirm `question` shows your exact custom
   text, and transcript/feedback/metrics still generated normally (the pipeline doesn't care that
   the question was custom-typed).
10. Select **Story** again: confirm the suggested pool question is *not* the custom text you just
    typed in Step 8 (exclusion working across the custom-input path) — then back out via "‹ Change
    mode" without recording.
11. Pick **Miscellaneous**, record a short take, upload it — confirm its row shows mode
    `miscellaneous` with no question preview/text anywhere (list or detail), and that it still
    processes to `done` normally.
12. On any one `done` recording: tap the download icon (list or detail) — confirm the native share
    sheet opens; complete a save/share once and confirm no error. Then tap it again and cancel the
    share sheet on purpose — confirm no error text appears either time.
13. On that same recording, tap delete audio (list or detail) — confirm no confirmation prompt
    appears (expected — this is deliberate, not a bug), the bin/download icons both disappear
    immediately after, and checking the *other* screen (detail if you deleted from the list, or vice
    versa) shows the same "audio deleted" state. Confirm the Storage object is actually gone in the
    Supabase dashboard.
14. Confirm `getActiveRecordingCount` dropped: check History's total active-recording count
    informally (or re-run the temporarily-lower-the-cap trick from [Recording
    cap](#recording-cap)'s "How this was tested" bullet if you want a precise before/after).
15. Force a failure if you can (e.g. temporarily break `GEMINI_API_KEY` on the backend, or upload
    silence/no speech, or interrupt around the audio-download step), producing one `failed` row —
    confirm the red "Failed" badge, tap "Regenerate report" from **both** the list and the detail
    screen (on two different failed rows, or the same one twice), and confirm each recovers to
    `done` normally, with the row's `transcript`/`metrics`/`feedback` all correctly populated
    afterward.
16. Finally, spot-check Supabase's Table Editor directly against the `recordings` table: the
    interview row's `question` matches the pool text shown on screen, the story row's `question`
    matches your exact custom-typed text, and the miscellaneous row's `question` is `null` — this is
    the concrete proof (not just UI inference) that Phase 4 Steps 3-4 write the right value in every
    case.

## Backend

- Lives in [backend/](../backend/) — a sibling top-level directory in this same repo, alongside
  `src/`, `docs/`, `supabase/`. It's a **separate Python project** (own venv, own dependencies,
  own `.gitignore`) sharing git history with the Expo app rather than living in its own repo;
  don't mix backend code into `src/` or frontend code into `backend/`.
- Structure: a small package rather than a single file, since Phase 2 will grow this a lot —
  `backend/app/main.py` creates the FastAPI app (and now also configures root logging — see
  [AI processing endpoint](#ai-processing-endpoint)) and includes routers from
  `backend/app/routers/` (`health.py`, `recordings.py`, and — v4 Epic H — `questions.py`);
  `backend/app/config.py` holds a `pydantic-settings` `Settings` object reading from `.env`. `backend/app/supabase_client.py`
  builds the one shared service-role Supabase client, `backend/app/gemini_client.py` (Step 3)
  builds the one shared Gemini client the same way, `backend/app/auth.py` holds the bearer-token
  verification dependency, and `backend/app/services/` holds background-work logic —
  `processing.py` (the pipeline orchestration), `metrics.py` (Step 4, pure deterministic-metrics
  logic — see [Metrics](#metrics)), `feedback.py` (Step 5, mode-aware feedback-prompt building
  and the Gemini call that generates it — see [AI processing endpoint](#ai-processing-endpoint)),
  and — v4 Epic H — `daily_questions.py` (the lazy daily-question assignment logic + its
  synchronous Gemini batch-generation — see [Daily questions](#daily-questions)).
  `metrics.py` and `feedback.py` are both kept as their own modules rather than folded into
  `processing.py` for the same reason: neither has any Supabase/network call of its own beyond (for
  `feedback.py`) the single Gemini call, both are easy to unit-test in isolation, and
  `processing.py` is already growing across Steps 3–6 as pure orchestration — kept out of the
  router module too, since it isn't itself request/response handling. Add new endpoints as new
  router modules under `app/routers/` rather than growing `main.py` directly.
- Dependencies are pinned in `backend/requirements.txt` (plain pip, not `pyproject.toml` — this
  is a small service without a package to publish, so `pip install -r requirements.txt` is the
  simplest thing that works and matches Render's default Python build). Includes `supabase`
  (`supabase-py`, added in Step 2), `google-genai` (added in Step 3 — see
  [AI processing endpoint](#ai-processing-endpoint) for why this package specifically, not the
  older `google-generativeai`), `mutagen` (added in Step 4 — see [Metrics](#metrics) for why), and
  `tzdata` (added in v4 Epic H — the IANA tz database `zoneinfo` needs for the Eastern daily-question
  boundary; not guaranteed present on Windows/slim Linux).
  Test-only dependencies (`pytest`) live in a separate `backend/requirements-dev.txt`, not
  installed on Render, since the deployed service never runs tests — install both files locally
  (`pip install -r requirements.txt -r requirements-dev.txt`) to run `pytest` from `backend/`.
- Config: `backend/.env` (gitignored; see `backend/.env.example`) holds `PORT` (local dev only —
  Render injects its own `$PORT`) plus `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
  `GEMINI_API_KEY`. All three are now live as of Step 3 — read `.env.example` before filling them
  in, it says exactly where to get each value and warns that the service-role key and Gemini key
  are both secret (must never reach the Expo app or any client-side code). `render.yaml` declares
  all three as `sync: false` env vars, so a deployed service needs them pasted into Render's
  dashboard separately — they aren't synced from the repo. See
  [AI processing endpoint](#ai-processing-endpoint) for how they're used.
- Run locally: from `backend/`, `python -m venv .venv`, activate it, `pip install -r
  requirements.txt`, then `uvicorn app.main:app --reload`. Confirm it's alive by hitting
  `GET http://localhost:8000/health` → `{"status": "ok"}`. To test from Expo Go on a physical
  phone, run with `--host 0.0.0.0` instead (so it listens on your LAN interface, not just
  loopback) — see `EXPO_PUBLIC_API_URL` in the root `.env.example`.
- Deploy target: Render, as a free-tier Python web service, configured via the `render.yaml`
  Blueprint at `backend/render.yaml` (chosen over manual dashboard setup so the service config
  lives in version control and Render re-syncs it automatically on push, rather than dashboard
  clicks nobody remembers later). Live URL: `https://brevado-api.onrender.com` (exact subdomain
  depends on what's available when the service is first created — check the Render dashboard for
  the actual assigned URL). Confirm a deploy is alive the same way as local: hit that URL's
  `/health` and expect `{"status": "ok"}`. Free tier sleeps after inactivity, so the first hit
  after a while can take ~30s to wake up.
- **Endpoints (all in `app/routers/recordings.py`):** `POST /recordings/{id}/process` and
  `POST /recordings/{id}/regenerate` (both schedule `process_recording()` via `BackgroundTasks`;
  see [AI processing endpoint](#ai-processing-endpoint)), `DELETE /recordings/{id}/audio` (see
  [Audio delete](#audio-delete)), and `DELETE /recordings/{id}` (the whole row + audio; v2 Epic
  D Part 4, see [Delete recording](#delete-recording)). All four bearer-token-verified and
  ownership-checked; the two `/process`-family ones also gate on `status`. **v4 Epic H Step 1**
  adds `GET /questions/daily?mode=...` in a new `app/routers/questions.py` — bearer-token auth,
  no ownership check (not user-specific data); see [Daily questions](#daily-questions).
- **What `process_recording()` does:** the FastAPI app, `/health`, and the processing pipeline. Upload and
  row-creation still happen entirely on the frontend against Supabase directly
  (`src/lib/recordings.ts`); this backend is only involved from the moment a row already exists.
  **`process_recording()`'s transcript, metrics, and feedback steps are all real** (downloads the
  audio from Storage once, sends it to Gemini for a transcript, computes deterministic metrics
  from that transcript and the same audio bytes, then sends the transcript/metrics/mode/question
  to Gemini again for mode-aware feedback, storing each result as it succeeds — see
  [Metrics](#metrics)) — **no stub logic remains in the pipeline, and each Gemini-calling stage now
  retries once inline on failure before the recording is marked `failed`** — see
  [Background processing](#background-processing) for the retry policy itself.

## AI processing endpoint

- `POST /recordings/{recording_id}/process` (`backend/app/routers/recordings.py`) is what the Expo
  app calls right after its existing upload + row-creation flow (`src/lib/recordings.ts`)
  succeeds — see `startProcessing()` in `src/lib/api.ts`, called from the Home tab
  (`src/app/(tabs)/index.tsx`) right after `uploadRecording()` resolves. Upload and row creation
  are still entirely frontend-to-Supabase; this endpoint is only the trigger for what happens
  next.
- **Auth:** the Expo app sends the user's current Supabase access token as
  `Authorization: Bearer <token>` (via `supabase.auth.getSession()`). `app/auth.py`'s
  `get_current_user_id` FastAPI dependency verifies it by handing the token to Supabase's own
  `auth.get_user(token)` call — this validates the token against Supabase's Auth API directly,
  so the backend never needs to handle the project's JWT secret or verify signatures itself.
  Returns 401 if the header is missing/malformed or Supabase rejects the token.
- The endpoint fetches the recording row (service-role client, bypassing RLS), then checks
  `recording.user_id` against the verified caller and `status == 'pending'` before doing anything
  else. A recording that doesn't exist and one that exists but belongs to someone else return the
  **same** 403 response — a caller's token should never be able to tell those two cases apart. A
  recording that's already `processing`/`done`/`failed` gets 409 rather than being reprocessed.
- **Why the service-role key:** `app/supabase_client.py` builds one shared Supabase client from
  `SUPABASE_SERVICE_ROLE_KEY`, not the anon key — this backend process is trusted and needs to
  read/write *any* user's `recordings` row, which RLS (scoped to `auth.uid()`) would otherwise
  block. The bearer-token check above is what actually authorizes the request; the service-role
  client is what lets the now-authorized request act on that user's row. See `.env.example` (both
  root and `backend/`) for exactly where to paste the real key and why it must never reach the
  Expo app or any client-side code.
- On a valid, authorized, pending recording, the endpoint schedules a `BackgroundTasks` call to
  `process_recording()` (`backend/app/services/processing.py`) and returns `202 Accepted`
  immediately, without waiting for that work to finish.
- **`process_recording()`'s transcript, metrics, and feedback steps are all real as of Step 5, and
  each Gemini-calling stage retries once inline on failure as of Step 6 — no stub steps and no
  "fail on the first error" remain.** It flips the row `pending` -> `processing`, downloads the
  recording's audio from Storage once (`recordings.audio_path`, via the service-role client),
  sends it to Gemini (native audio input — one call, no separate transcription service) for a
  transcript, stores that transcript immediately, then computes deterministic metrics (see
  [Metrics](#metrics)) from that transcript and the same already-downloaded audio bytes and stores
  those too, then sends the transcript, metrics, mode, and question to Gemini a second time for
  mode-aware free-text feedback (`app/services/feedback.py` — interview -> directness/structure,
  story -> narrative arc/pacing, miscellaneous -> general clarity/conciseness, per
  docs/PROJECT_PLAN.md Section 3) **plus a short recording `title`** (v2 Epic D Part 1) **and the
  three v3 scores + `grammar_issue_count`** (v3 Epic F Step 1) — all from that same structured-JSON
  call (see [Recording titles](#recording-titles) and [Feedback generation](#feedback-generation)),
  and only then sets `status: done` with feedback, title, and the four score fields attached
  (`title` or any score may be `NULL` if generation returned nothing usable for it — that alone
  never fails the recording; `title` is *also* omitted from this write entirely — leaving a user's
  hand-set title untouched — when `title_edited_by_user` is `true`, v2 Epic D Part 7; the **four
  score columns are always written**, even on "Regenerate report", since nothing lets a user
  hand-edit a score).
  `status: done` now means the full pipeline actually ran, transcript through feedback.
  Each stage's result is written to the row as soon as it succeeds (transcript, then metrics), so
  a later stage failing can never lose or overwrite earlier, already-successful work — the same
  "don't discard good partial work" principle applies to a feedback failure as it already did to a
  transcription failure. If the transcription Gemini call fails, times out, or returns an
  empty/unusable transcript (`TranscriptionError`), or if the feedback Gemini call fails or
  returns empty/unusable text after transcript and metrics have already succeeded
  (`FeedbackGenerationError`), that stage is retried exactly once, immediately, within the same
  `process_recording()` call — see [Background processing](#background-processing) for the retry
  policy itself (`_run_with_one_retry` in `processing.py`) and why it retries only the failed
  stage rather than the whole pipeline. Only if the retry also fails does the recording get marked
  `failed` — a transcription failure marks it directly with nothing else attempted, and a feedback
  failure (after retry) still leaves the already-written transcript and metrics in place, only
  `status` reflecting the failure. Logging (requests sent, responses received, errors, and now
  which attempt a retry is on) goes through the standard `logging` module, configured in
  `app/main.py`, so it shows up in Render's log stream in production and stdout locally — check
  there when a recording ends up `failed`; the log lines are worded to distinguish a first-attempt
  failure ("retrying once immediately") from a final, both-attempts-exhausted failure ("giving up,
  marking failed").
- **Gemini client config:** `backend/app/gemini_client.py` builds one shared `google.genai.Client`
  from `GEMINI_API_KEY` (`app/config.py`), the same lazy-singleton pattern
  `app/supabase_client.py` uses for the Supabase client. Uses the **`google-genai`** SDK
  (Google's current unified Gen AI SDK) rather than the older, now-legacy
  `google-generativeai` package — see the comment at the top of `gemini_client.py` for the
  migration-guide link. Get a free key from Google AI Studio
  (https://aistudio.google.com/apikey, no credit card required) and paste it into
  `backend/.env`'s `GEMINI_API_KEY` — see `backend/.env.example` for the full instructions.
  **Model id is config-driven**, not hardcoded: `settings.gemini_model` (`app/config.py`,
  `GEMINI_MODEL` env var, defaults to `gemini-3.6-flash`) is what both
  `app/services/processing.py` (transcription) and `app/services/feedback.py` (feedback
  generation, Step 5) pass to `generate_content` — one model id for the whole pipeline, no reason
  for feedback generation (a single text-in/text-out call) to use a different model. This was
  deliberate, not just tidiness — during Step 3 testing
  (2026-08-25) `gemini-2.5-flash` (the model originally chosen for its confirmed native-audio +
  free-tier support) started 404ing with "no longer available to new users, use
  gemini-3.6-flash", so model ids clearly get retired/renamed over time. If it happens again,
  bump the default in `app/config.py` (or set `GEMINI_MODEL` in `.env`/Render) — a one-line
  config change, no code edit. If you're reading this later and wondering why the model choice
  doesn't match some older note that said `gemini-2.5-flash`: that's why.
- **Frontend polling (Step 7, done):** the History list (`src/app/(tabs)/history/index.tsx`)
  refetches on a 1.5s interval whenever any visible row is `pending`/`processing`, so status
  visibly moves to `done`/`failed` without a manual pull-to-refresh — see [History](#history) for
  the full behavior (out-of-order-response guard, per-row stop condition, focus-gating) and why a
  flat interval (rather than backoff) was kept. Still a plain interval, not SSE/WebSockets/
  real-time — the pipeline finishes in seconds to tens of seconds, this app has a handful of test
  users, and a push mechanism would add real infra for a savings that isn't needed at this scale.
  - The History **detail screen** (`history/[id].tsx`, Phase 3 Step 2) and — as of v2 Epic C Part
    4 — the **Record screen** (`ProcessingStatus` in `index.tsx`) each have the same-shaped poll
    for a *single* recording (`fetchRecordingById` instead of `fetchRecordings`). The Record
    screen's is a deliberate replication of the detail screen's, not a shared hook — see
    [Mode selection](#mode-selection)'s "Post-recording flow" bullet.
- **Regenerate endpoint (Phase 3 Step 2, done):** `POST /recordings/{recording_id}/regenerate`
  sits alongside `/process` in the same router, sharing its auth/ownership check but requiring
  `status == 'failed'` instead of `'pending'`, and scheduling the identical
  `process_recording()` background task — see
  [Background processing](#background-processing)'s "Regenerate report" bullet for the full
  detail (including why no extra state needs resetting first) and [History](#history) for where
  the frontend calls it from.
- `EXPO_PUBLIC_API_URL` (root `.env`/`.env.example`) is the backend's base URL as seen from the
  Expo app — a LAN IP for local dev against a physical phone (Expo Go can't reach your laptop's
  `localhost`), or the deployed Render URL. See the comments in `.env.example` for both cases and
  how to switch.

## Metrics

Phase 2 Step 4. Deterministic metrics, computed purely in code from the transcript (and, for
words-per-minute, the audio) — no Gemini call involved, per docs/PROJECT_PLAN.md Section 3
("Processing & feedback"). Logic lives in `backend/app/services/metrics.py`, kept separate from
`app/services/processing.py` since it has no Supabase/Gemini/network calls of its own and is easy
to unit-test in isolation (see `backend/tests/test_metrics.py`) — `processing.py` is already
growing across Steps 3–6, so this keeps that module from also owning pure text-analysis logic.

**Still computed and stored on every recording, unchanged.** As of **v3 Epic F Step 1** they are
no longer *displayed* on the recording detail screen (the three score badges replaced that — see
[History](#history)'s "Scores badges" bullet); `filler_word_rate` and `repetition_count` are now
also **Clarity grounding inputs** for the score prompt (see [Feedback
generation](#feedback-generation)), and the raw numbers resurface in the UI only in Streaks →
Clarity's detail screen (v3 Epic G).

- **Storage shape:** stored as-is into the `recordings.metrics` jsonb column:
  ```json
  {"filler_word_rate": 0.08, "words_per_minute": 142, "repetition_count": 3, "word_count": 210}
  ```
  `filler_word_rate` is a **fraction (0.0–1.0), not a percentage** — 0.08 means 8%. `word_count` is
  included alongside the two fields derived from it since the feedback prompt (see
  [Feedback generation](#feedback-generation)) and Phase 6 (v3)'s scoring both want it directly
  rather than re-deriving it from the transcript. This exact shape is what `app/services/feedback.py`
  reads as feedback-prompt grounding — changing key names or the rate/percentage convention later
  means updating both that prompt and Phase 6 scoring, not just this module.
- **Filler word list:** `FILLER_WORDS` at the top of `metrics.py` — a deliberately simple starter
  list (`um`, `uh`, `like`, `you know`, `sort of`, `kind of`, `i mean`, `basically`, `actually`,
  `literally`, etc.), matched via plain case-insensitive word-boundary regex, no context awareness.
  `like` and `so`-style words will also match legitimate non-filler uses ("I like pizza") — a known
  limitation of a starter list. Tune the list directly in `metrics.py` as real transcripts show
  what actually needs adjusting; it's the one place this logic lives.
- **Repetition:** `compute_repetition_count` counts immediate word/short-phrase repeats only (e.g.
  "the the", "I think I think") — checked longest-phrase-first (3/2/1 words) with the scan jumping
  past each match, so a repeat isn't double-counted at multiple phrase lengths. Deliberately not a
  general NLP repetition/disfluency detector — see the function's docstring for the exact algorithm.
- **Words-per-minute's duration:** read directly from the downloaded audio file's own metadata via
  `mutagen` (`get_audio_duration_seconds`, added to `backend/requirements.txt`), **not** from
  Gemini's transcription response — that response is plain text with no timing/duration metadata,
  and requesting timestamps would mean a second, more expensive Gemini call just to get one number.
  `process_recording` (`processing.py`) downloads the audio from Storage once and reuses those same
  bytes for both the Gemini call and this duration lookup — no second Storage round-trip.
- **Failure handling:** metrics computation is wrapped in its own try/except in `process_recording`,
  separate from the transcript-storing step before it. A metrics failure (most likely: audio
  duration can't be determined, so `words_per_minute` comes back `None`) never fails the recording
  or discards the transcript — it's logged and `metrics` is stored as whatever was computed (or
  `None` for a total failure), while processing continues on to feedback generation and `status`
  still ends up `done` on success. This was a deliberate choice, not the stricter alternative
  (failing the recording): the transcript is the expensive, valuable part (a real Gemini call
  against the user's actual speech), and metrics are a derived input to the feedback prompt (see
  [Feedback generation](#feedback-generation)) — losing them is a much smaller loss than
  re-requiring a full re-transcription over what's likely a narrow audio-parsing edge case. Note
  this is a metrics-*computation* failure specifically (caught in `process_recording`, not inside
  `compute_metrics` itself) — a *feedback*-generation failure afterward is handled differently,
  since by that point there's real work (transcript, and metrics if they succeeded) worth
  preserving; see [Feedback generation](#feedback-generation).
- **Tests:** `backend/tests/test_metrics.py` (pytest, `requirements-dev.txt`) covers filler-rate,
  repetition, word-count, and WPM/duration logic against hand-written sample transcripts and a
  synthetic WAV file (built with the stdlib `wave` module, no fixture files needed) — run with
  `pytest` from `backend/` after installing both requirements files.

## Feedback generation

Phase 2 Step 5 — the final, previously-stubbed piece of the pipeline; **no stub logic remains
anywhere in processing now.** Logic lives in `backend/app/services/feedback.py`, kept as its own
module for the same reason as `metrics.py` (see [Metrics](#metrics)): `build_feedback_prompt` is
pure string-building with no network call of its own, so it's easy to unit-test in isolation (see
`backend/tests/test_feedback.py`) independent of the actual Gemini call.

- **Prompt inputs:** the transcript, the computed metrics dict (or `None` — see [Metrics](#metrics)
  for when that happens), `mode`, and `question` (the recording's chosen question/topic, currently
  always `null` — see [Current phase](#current-phase) — but the prompt handles a real question too,
  for when Phase 4 adds mode selection). Metrics are turned into a natural-language grounding
  sentence (e.g. "spoke at approximately 142 words per minute") by `_format_metrics_grounding`
  rather than handed to Gemini as raw numbers or left for it to recount from the transcript itself,
  per docs/PROJECT_PLAN.md Section 3. `question` being `null` renders as "the speaker chose their
  own topic" rather than being silently omitted.
- **Mode-specific criteria:** `MODE_CRITERIA` in `feedback.py` — interview -> directness/structure,
  story -> narrative arc/pacing, miscellaneous -> general clarity/conciseness, per
  docs/PROJECT_PLAN.md Section 3. All three branches were built and tested at Phase 2 Step 5 even
  though every real recording at that time was `mode='miscellaneous'` (Phase 1's placeholder
  recording flow — Phase 4 hadn't built real mode selection yet), which is exactly why Phase 4
  didn't need this rebuilt when it landed.
- **Output:** free-text prose feedback (2-4 short paragraphs, no headers/bullets/numeric
  scores *in the prose* — the scores are separate response keys), **a short 2-4 word recording
  `title`** (v2 Epic D Part 1), and **the v3 scores** (Epic F Step 1): `impact_score`,
  `clarity_score`, `structure_score` (each `int` 0–100) and `grammar_issue_count` (`int` ≥ 0).
  All come back from the **same single Gemini call** — folded together, not extra requests, to
  avoid cost/latency. `generate_feedback` returns a `GeneratedFeedback` dataclass (`feedback: str`,
  `title: str | None`, and the four score fields each `int | None`). See
  [Recording titles](#recording-titles) for the title format and [v3 scope](#v3-scope) for the
  score design.
- **v3 score prompt design (Epic F Step 1):** three new `feedback.py` constants carry the
  guidance. `MODE_IMPACT_GUIDANCE` and `MODE_STRUCTURE_GUIDANCE` are **genuinely mode-specific**
  (interview / story / miscellaneous each get a different judgment — Impact: did the answer land
  as a response / story cohesion+engagement / substance+coherence; Structure: point-up-front
  organization / narrative shape / sensible ordering). `_CLARITY_GUIDANCE` is **not** mode-specific
  and is explicit that Clarity is **one holistic judgment, not a mechanical average** — it feeds
  the deterministic `filler_word_rate` / `repetition_count` (already in the metrics grounding
  sentence) plus the model's own grammar assessment (`grammar_issue_count`) in as *inputs* to that
  impression. `_SCORE_SCALE` pushes the model off clustering everything in the 70s-80s.
- **Response format (Epic D Part 1; extended Epic F Step 1):** the call passes
  `response_mime_type="application/json"` + an explicit `response_schema`
  (`_FEEDBACK_RESPONSE_SCHEMA` — now **six** keys: `feedback`, `title`, `impact_score`,
  `clarity_score`, `structure_score`, `grammar_issue_count`, all in `required`), so Gemini's
  structured-output mode constrains the reply to valid JSON that `json.loads` parses
  reliably — **not** a delimiter we'd `split()` on. A JSON-parse failure, a non-object response,
  or an empty `feedback` field all raise `FeedbackGenerationError` (`_run_with_one_retry` gets a
  shot at it). An empty/missing `title`, **or any missing / non-integer / out-of-range score**,
  does **not** raise — `generate_feedback` returns that field `None`, logs it, and the recording
  still completes. Score validation is `_coerce_score` (0–100 inclusive) / `_coerce_issue_count`
  (≥ 0), both lenient — same philosophy as the lenient-title handling.
- **Model:** reuses the same shared Gemini client and `settings.gemini_model` as transcription (see
  [AI processing endpoint](#ai-processing-endpoint)) — a single text-in/text-out call has no reason
  to use a different model from transcription.
- **Failure handling:** `FeedbackGenerationError` (mirroring `TranscriptionError` in
  `processing.py`) is raised for a failed Gemini call, an unparseable/non-JSON response, or an
  empty/unusable `feedback` field. Critically,
  `process_recording` stores the transcript and metrics to the row *before* attempting feedback
  generation, so a `FeedbackGenerationError` never loses or overwrites that already-successful
  work — only `status` moves to `failed`. Same "don't discard good partial work" principle as a
  transcription failure, applied one stage later. As of Step 6, a `FeedbackGenerationError` gets
  one immediate inline retry of just the feedback call (reusing the transcript/metrics already in
  hand, no re-transcription) before the recording is marked `failed` — see
  [Background processing](#background-processing). A bad **title** is deliberately *not* in this
  bucket — see [Recording titles](#recording-titles).
- **Tests:** `backend/tests/test_feedback.py` (pytest, 50 in the suite as of Epic F Step 1) checks
  `build_feedback_prompt` / `_format_metrics_grounding` / `_coerce_score` / `_coerce_issue_count`
  directly — the right mode-specific criteria, `null` vs. real question, transcript verbatim,
  metrics grounding, that the prompt asks for the `{feedback, title}` keys + the three score keys +
  `grammar_issue_count`, that Impact/Structure guidance is genuinely mode-specific and Clarity
  guidance is "one holistic judgment / NOT a mechanical average", that `_FEEDBACK_RESPONSE_SCHEMA`
  requires all six keys, and that score coercion rejects out-of-range / non-integer / negative
  values. Does **not** call the live Gemini API; run with `pytest` from `backend/`.

## Recording titles

v2 Epic D — a short, human-readable label per recording ("Challenging Coworker",
"Unplanned Trip", "Day Recap" — matching the tone of the design screenshots). **Part 1**
(backend/data): auto-generation + storage. **Part 2** (done): the recording is now
**user-editable** on the History detail screen. **Part 3** (done): the title is the bold
heading of each restyled History **list** card (see "List display (Part 3)" below and
[History](#history)'s "List card restyle" bullet). **Part 7** (done): fixed a bug where a
pipeline run silently overwrote a hand-edited title (see "Not overwriting a hand-edited title
(Part 7)" below) — the History **detail-screen** visual restyle also landed in Part 7,
described in [History](#history)'s "Detail screen" bullet rather than repeated here. Existing
recordings keep `title = null` — **no backfill**; they get a title if regenerated, if a user
sets one by hand (Part 2), or naturally on new recordings.

- **Schema:** `title` nullable `text` on `recordings`, migration
  `supabase/migrations/0005_recording_title.sql` (`alter table public.recordings add column
  title text;`) — a new numbered migration per the project convention, run manually in the
  Supabase SQL editor like `0001`–`0004`.
- **Generation — folded into the existing feedback call, no separate request.**
  `app/services/feedback.py`'s `build_feedback_prompt` now also asks for a `title`, and
  `generate_feedback` returns `GeneratedFeedback(feedback, title)` extracted from one
  structured-JSON Gemini response (`response_mime_type="application/json"` +
  `_FEEDBACK_RESPONSE_SCHEMA`). See [Feedback generation](#feedback-generation)'s "Response
  format" bullet for why JSON/schema over a delimiter.
- **Mode-specific approach:** the title prompt guidance keys off **whether there's a
  `question`**, not the mode name — `if question:` "you may draw on the prompt and how the
  speaker responded for context, don't just restate it"; `else:` "there is no prompt, derive
  the title entirely from the transcript content". Miscellaneous always hits the `else`
  branch (it has no question); an interview/story recording with a null question (a lookup
  edge case) correctly falls through to transcript-only too. The prompt also asks for
  title-case, 2-4 words, no trailing punctuation, "like a note/journal-entry title, not a
  sentence".
- **Lenient failure (same philosophy as Phase 2 Step 4's metrics handling):** if the JSON
  parses and `feedback` is fine but `title` is empty/missing, `generate_feedback` returns
  `title=None`, logs a `warning` ("no usable title was returned … recording is NOT failed
  over this"), and `process_recording` writes the row `done` with `title` = SQL `NULL`. A bad
  title never raises `FeedbackGenerationError` and never fails or retries the recording — only
  a bad *feedback* field does. `generate_feedback` also whitespace-collapses / strips trailing
  `.` from the title and logs (but keeps) a title over 120 chars (a model ignoring "2-4
  words"; Part 2's editing UI is the fix for a junk title).
- **Storage:** `process_recording` (`app/services/processing.py`) writes `title:
  generated.title` alongside `feedback` and `status: 'done'` in the same final update — no
  separate write, no new pipeline stage. A regenerate refreshes it too (can move `NULL` ↔ a
  real value) — see [Background processing](#background-processing). **A pipeline run used to
  overwrite a hand-set title** — fixed in Part 7, see "Not overwriting a hand-edited title
  (Part 7)" below.

### Editing (Part 2)

- **Where:** the History **detail** screen (`src/app/(tabs)/history/[id].tsx`). `TitleSection`
  renders at the top of the header row as the screen's large bold heading (Part 7's restyle —
  see [History](#history)'s "Detail screen" bullet for the full layout this sits in; the
  interaction described below is unchanged from Part 2). The History **list** shows `title`
  too as of Part 3 (see "List display (Part 3)" below).
- **Interaction:** mirrors the custom-question pencil-edit in `QuestionArea` (Epic C Part 3 —
  that pattern lives inline there, not as a shared component, so this *mirrors* it rather than
  importing). Display = the title text + a `pencil` `SymbolView`; tap it → a bordered input
  box (`Theme` tokens, `arrow.up.circle.fill` submit icon) pre-filled with the current title;
  confirm saves, **"Cancel"** reverts. `TitleSection` owns the in-progress `draft` / local
  validation error / open state; the parent owns the persisted `recording.title` and the
  async save.
- **NULL titles:** editing works identically — the field just starts empty (display shows a
  muted **"Untitled recording"** placeholder), so a user can title an old or
  generation-failed recording for the first time.
- **Validation:** identical to custom questions — non-empty after `trim()`, nothing else (no
  length cap, no content filtering).
- **Persistence — direct Supabase update, not a backend endpoint.** `updateRecordingTitle(id,
  title)` in `src/lib/recordings.ts` does `supabase.from('recordings').update({ title,
  title_edited_by_user: true })` — the same call and the same reasoning as `setFavorite`
  (Phase 3 Step 4): RLS ("Users can update their own recordings", `0001`) already scopes it to
  the caller, and a title is a plain label with no Gemini/Storage work and no logic attached
  elsewhere. Contrast the audio **delete** endpoint, which is a backend route *because* it's a
  Storage delete + DB update that must not disagree (and Storage had no delete RLS policy) —
  none of that applies to a text field. A backend round-trip would only add latency. The
  `title_edited_by_user: true` write (Part 7) is new — see "Not overwriting a hand-edited
  title (Part 7)" below for what it's for.
- **Save is NOT optimistic** (matching `handleDeleteAudio`, not the favorite toggle):
  `recording.title` only changes after the write lands. The editor stays open with a spinner
  during the save and shows an inline error + stays open on failure, so a failed save never
  leaves a wrong title on screen. `updateRecordingTitle` selects `title` in
  `fetchRecordingById` now, and the list refetches on focus, so backing out reflects the new
  title everywhere (as of Part 3 the list renders it too).

### List display (Part 3)

- **Where:** the History **list** card (`RecordingListItem`, `src/app/(tabs)/history/index.tsx`)
  — Part 3 also restyled the whole card; see [History](#history)'s "List card restyle" bullet
  for the full layout. `fetchRecordings()` now selects `title` (added to `RecordingRow`), and it
  renders as the card's **bold heading** (a `smallBold`/Noto-Sans-bold `ThemedText` bumped to
  17px, up to 2 lines) with the favorite star on the same line.
- **NULL-title fallback = a muted "Untitled recording"** (rendered `textSecondary`), *not* a
  truncated version of the question. Two reasons: (1) consistency — Part 2's detail-screen
  `TitleSection` already established exactly this string + treatment for a NULL title, and (2)
  the question already has its own dedicated secondary line right below the heading, so folding
  a truncated copy of it into the heading would just duplicate that text while burying the
  "this recording has no real title yet" signal. A NULL title is a legacy row (pre-Part-1) or a
  generation miss — both rare, and both fixable by the user via the Part 2 detail-screen editor.
- The question/"No prompt" secondary line, the mode pill, date and star are described in
  [History](#history)'s "List card restyle" bullet.

### Not overwriting a hand-edited title (Part 7)

**The bug (flagged in the Part 6 wrap-up):** `process_recording()` always wrote
`title: generated.title` into its final `status: 'done'` update, on *every* run — including a
"Regenerate report" run triggered after a user had already retitled the recording by hand via
the Part 2 editor. Regenerating a report (e.g. to get a better transcript/feedback, or to
recover a `failed` row) silently threw away the user's own title and replaced it with a fresh
AI-generated one, with no warning and no way to tell it had happened short of noticing the
title had changed.

**The fix:**

- **Schema:** a new boolean column, `title_edited_by_user`, `not null default false` — migration
  `supabase/migrations/0006_title_edited_by_user.sql`
  (`alter table public.recordings add column title_edited_by_user boolean not null default
  false;`). Defaulting `false` means every existing row and every freshly-inserted row starts
  out exactly as before — still eligible for an AI-generated title — so this is purely additive,
  no backfill needed and no behavior change for a recording that's never been hand-retitled.
- **Setting it — the one and only place a title is ever hand-set:** `updateRecordingTitle()`
  (`src/lib/recordings.ts`, the Part 2 editor's save call) now writes `title_edited_by_user:
  true` in the same update as `title` itself — see the "Editing (Part 2)" section's
  "Persistence" bullet above.
- **Reading it — where the check now lives in the pipeline:** `process_recording()`
  (`backend/app/services/processing.py`) selects `title_edited_by_user` alongside `mode`/
  `question` in its very first row-read (right after flipping `status` to `processing`), so it's
  in hand for the rest of the run without a second round-trip. At the end of the run, building
  the final `status: 'done'` update, the code now branches: if the flag is `true`, `title` is
  **left out of the update payload entirely** (a plain Python `dict` built conditionally,
  not written and then overwritten) — Supabase never touches that column, so whatever the user
  set stays exactly as they set it. If the flag is `false` (the default — never edited, or a
  recording generated fresh), `title: generated.title` is written exactly as before, unchanged
  behavior. **Feedback, transcript, and metrics are completely unaffected by this flag** — only
  the `title` write is conditional; a regenerate on a hand-titled recording still fully refreshes
  everything else.
- **Applies to every pipeline entry point uniformly** — there's only one place `status: 'done'`
  is ever written (`process_recording`'s final update), and both `/process` (initial generation)
  and `/regenerate` schedule that exact same function (see [Background
  processing](#background-processing)), so this fix covers both without any endpoint-specific
  code.

## Epic D wrap-up

**Epic D is now fully complete — all 7 parts.** Same spirit as the [Phase 3
assessment](#phase-3-assessment) and [Phase 4 exit checkpoint](#phase-4-exit-checkpoint): does the
full History experience hold together as one coherent, **fully restyled** feature top to bottom,
and what's still shaky before Epic E? This replaces the Part 6 wrap-up above (which covered Parts
1–6 with the detail screen still deferred and the title-overwrite bug still open) now that Part 7
has closed out both.

**All 7 parts, and where each lives:**
1. **Title generation** (Part 1) — `backend/app/services/feedback.py` returns
   `GeneratedFeedback(feedback, title)` from one structured-JSON Gemini call; `process_recording`
   stores `title` alongside `status: 'done'`. Migration `0005_recording_title.sql`. Lenient on a
   missing title (row still `done`, `title` = `NULL`).
2. **Title editing** (Part 2) — `TitleSection`; pencil → pre-filled input → `updateRecordingTitle()`
   direct-Supabase update, not optimistic, handles `NULL`. Restyled as the detail screen's large
   bold heading in Part 7 (interaction unchanged).
3. **List card restyle** (Part 3) — each row a `<Card>`: title heading (muted "Untitled
   recording" fallback), question/"No prompt" line, colour-coded mode pill, right-aligned
   date, favorite star. `modePillColors()` moved to `src/lib/modes.ts` in Part 7 so the detail
   screen could share it instead of duplicating it.
4. **3-dot menu** (Part 4) — shared `RecordingActionsMenu` on list + detail: Download audio,
   Delete audio, Delete recording (new backend `DELETE /recordings/{id}`, `Alert.alert`-gated),
   Regenerate report (failed only). `DownloadAudioButton` / `DeleteAudioButton` deleted. Kept
   as-is by Part 7 — see [History](#history)'s detail-screen "3-dot actions menu" bullet for why
   the design's inline text-link mockup for this screen wasn't reverted to.
5. **Search + toggle** (Part 5) — client-side substring filter over `title` + `question`;
   minimalist underline Calendar/List tabs.
6. **Calendar** (Part 6) — `MonthCalendar`: 7-column month grid, capped next-month nav,
   client-side per-day dots from `created_at` local date, tap-a-day → List filtered to that
   date, "Showing {date}" chip to reset, search and day filter mutually exclusive.
7. **Detail-screen restyle** (Part 7, new) — the last deferred piece: the header (large bold
   editable title + star + 3-dot menu), a mode-pill/status-badge/date meta row, an
   always-shown Question/"No prompt" block, a `<Card>`-wrapped pill-shaped audio player
   (restyled `AudioPlaybackControls`, shared with the Home tab), compact 3-stat metric blocks,
   and bold Metrics/Feedback/Transcript section headers with `Theme.typography.body` copy. Full
   layout in [History](#history)'s "Detail screen" bullet. **Also fixed in Part 7:** the
   title-overwrite bug — see [Recording titles](#recording-titles)'s "Not overwriting a
   hand-edited title (Part 7)" subsection for the `title_edited_by_user` column and where the
   check now lives in `process_recording()`.

**Built and internally consistent, confirmed by reading the code:** every part composes through
the same `RecordingRow`/`RecordingDetail` shapes and the same two queries (`fetchRecordings()`,
`fetchRecordingById()`). The detail screen's restyle touched no data-fetching logic at all — it's
a pure presentation change over the exact same `recording` object Parts 1–4/6 already populate;
the one *behavioral* change in Part 7 (the title-overwrite fix) lives entirely in the backend
pipeline and one frontend write, independent of any rendering. Polling, focus-refetch, and every
per-row action (favorite / regenerate / delete audio / delete recording / download) are untouched.
`npx tsc --noEmit`, `eslint`, and the backend's full pytest suite (42 tests) are all clean.

**What's verified vs. not:** type-check + lint + pytest only — **no on-device pass yet across any
part of Epic D**, same standing caveat as every Phase 3/4 step (see [Phase 3
assessment](#phase-3-assessment)). The test plan below is the single pass meant to close that gap
for the whole History surface, restyle included, in one run.

**Shaky / worth knowing before Epic E:**
- **The title-overwrite bug is fixed by code, not yet confirmed on-device** — the logic reads
  correctly (see the fix's own writeup) and the backend pytest suite still passes, but no live
  Gemini regenerate has actually been run against a hand-titled recording yet. The test plan
  below covers exactly that as its first non-trivial check.
- **`formatRecordedAt` vs. `dayKey` both use local time** — consistent with each other, so a
  card's displayed date always matches the calendar cell it's filed under. But a user who
  travels across timezones between recording and viewing could see a recording shift days.
  Accepted — matches how a phone's own calendar/photos behave.
- **The restyled `AudioPlaybackControls` now also changes the Home tab's post-recording
  preview** (`RecordingPlayback` in `index.tsx`), since Part 7 restyled the shared component
  rather than forking a detail-screen-only variant. This is intentional (one player, one look,
  consistent with the rest of v2) but means Part 7's on-device check should glance at the Home
  tab's playback too, not just History's.
- **`getStatusPresentation` (`recording-status.ts`) still hardcodes red/green hex** rather than
  `Theme` tokens — unchanged by Part 7 (only the failed-state heading and Regenerate button were
  moved onto `Theme.colors.recordRed`; the shared status-badge colors were left as they were,
  consistent with the "flagged for Epic C/D" note in [Design system](#design-system)).
- **`MonthCalendar` re-derives the grid every render** (no `useMemo` on `cells`) — trivial at
  28–31 cells, not worth memoising.
- **Month nav has no lower bound** — you can page back indefinitely into empty months. Harmless
  (grid just shows no dots); a "jump to today" affordance could be nice later but isn't needed.

**Nothing found that blocks starting Epic E.**

**History end-to-end test plan** (one pass, supersedes per-part spot checks and the Part 6 wrap-up's
test plan):
1. Open History with several recordings — confirm the restyled list: title headings, "Untitled
   recording" on any NULL-title row, question / "No prompt" line, colour-coded mode pills,
   dates, stars.
2. Tap a `done` recording → detail screen. Confirm the restyled layout: large bold title with
   star + 3-dot menu on the header row, mode pill + status badge + date meta row, the Question
   block (or "No prompt"), a pill-shaped Play/Pause button with a working progress bar and
   "0:00 / …" time display, the three compact metric stat blocks, and bold Feedback/Transcript
   headers with normal body-weight text underneath.
3. **Title-overwrite fix:** on that same recording, edit the title via the pencil (change it to
   something distinctive, confirm). Force it into a `failed` state if it isn't already one (e.g.
   temporarily break `GEMINI_API_KEY`, or use an already-`failed` row instead), then trigger
   **Regenerate report** (from the 3-dot menu or the prominent button) and let it complete.
   Confirm the title you set is **still exactly what you typed** — not replaced by a fresh
   AI-generated one — while transcript/feedback/metrics do refresh normally.
4. Open a `failed` recording's detail view — confirm the restyled failed notice (red heading,
   description, filled red "Regenerate report" pill) still works and recovers the row to `done`.
5. Open a **Miscellaneous** recording's detail view — confirm the Question block reads "No
   prompt" rather than being blank or absent.
6. Edit a title, "Cancel" instead of confirming — confirm no change persists, on this screen or
   back in the list.
7. On the list, open the 3-dot menu on a row: confirm Download / Delete audio / Delete recording
   appear (Regenerate only on a `failed` row). Run Download (share sheet opens), Delete audio
   (no confirm, menu items update). On a throwaway row run Delete recording → confirm the
   `Alert.alert`, confirm, and the **whole row** disappears. Repeat the menu check from the
   detail screen and confirm `router.back()` lands on the list with the row gone.
8. Type in the search bar — confirm the list filters live on title + prompt substring; confirm
   "No recordings match …" for a non-matching term; clear it.
9. Switch to **Calendar** — confirm the current month renders with a dot on each day you
   actually recorded something, today ringed.
10. Tap a day **with** a recording — confirm it switches to List, shows a "Showing {date}" chip,
    and lists only that day's recording(s). Tap the chip → back to the full list.
11. Switch back to Calendar, tap a day with **nothing** — confirm no crash, just a subtle "No
    recordings on …" line.
12. Navigate to a previous month (‹) — confirm it renders correctly (dots if you have old
    recordings, an empty grid otherwise). Confirm the next-month (›) chevron is disabled/dimmed
    once you're back on the current month.
13. Type a search term, then switch to Calendar and tap a day — confirm the search term is
    **cleared** (not AND-combined) and you see everything from that day.
14. On the Home tab, record and preview a take before uploading — confirm the (also-restyled)
    playback pill button + progress bar look and work the same way there.

## Background processing

- No task queue, broker, or worker process — background work (transcription + feedback
  generation) runs via FastAPI's built-in `BackgroundTasks`, in the same process as the web
  service that serves everything else. Chosen because Render has no free tier for a background
  worker (minimum ~$7/month), and this project stays at $0/month at its current scale (builder +
  a few test accounts).
- Trigger point: `POST /recordings/{id}/process` (see
  [AI processing endpoint](#ai-processing-endpoint)), called by the Expo app once its own
  upload + row-creation already succeeded — the row therefore already exists by the time this
  fires. The endpoint schedules a `BackgroundTasks` call to do the Gemini transcription + feedback
  work in that same request/response cycle, no separate dispatch step. As of Step 5, that call
  target, `process_recording()`, is real end to end — transcription, metrics, and feedback
  generation — see that section.
- **Retry (Phase 2 Step 6, done):** each of the two Gemini-calling stages —
  transcription and feedback generation — gets one immediate inline retry if it raises
  `TranscriptionError`/`FeedbackGenerationError`, via `_run_with_one_retry()` in
  `app/services/processing.py`. Both attempts happen synchronously inside the same
  `BackgroundTasks` call that's already running — there's no separate re-triggered request and no
  intermediate `failed` write, so a caller polling `status` never sees `failed` unless *both*
  attempts of a stage failed. If the retry also fails, the recording is left `failed` with no
  report, and (Phase 3 Step 2, done) the manual "Regenerate report" action covers retrying again
  later, without limit — see the "Regenerate report" bullet further down for exactly how that
  plugs in.
  - **Stage-level, not whole-pipeline retry:** a feedback-generation failure retries only the
    feedback call — reusing the transcript/metrics already computed and written to the row on the
    first pass — rather than re-downloading audio and re-running a second, wasted transcription
    Gemini call over speech that was already transcribed correctly. A transcription failure
    retries the download+transcribe pair together (re-downloading audio is a cheap Storage
    round-trip, not the expensive Gemini call this policy is trying to avoid wasting). This was a
    deliberate choice between the two options considered: whole-pipeline retry (simpler, but
    wastes a successful transcription on a feedback-only failure) vs. stage-level retry (the
    approach taken) — stage-level wasn't meaningfully more complex *because* the pipeline was
    already structured, since Steps 4–5, to store each stage's result to the row as soon as it
    succeeds; that same structure is what lets a feedback retry just reuse in-memory
    transcript/metrics instead of needing to re-fetch them.
  - **Metrics computation is not part of this retry policy** — it isn't a Gemini call, and its own
    failure handling (log + store `None`, never fail the recording) predates Step 6 and is
    unchanged; see [Metrics](#metrics)'s "Failure handling" bullet.
  - **Logging** distinguishes a first-attempt failure ("`... failed on first attempt (...) —
    retrying once immediately`") from a both-attempts-exhausted failure ("`... failed again on
    retry (...) — giving up, marking failed`", followed by `process_recording`'s own "`giving up
    after retry, marking failed to ...`" line right before the `status: failed` write) — before
    Step 6 these were indistinguishable in the logs, since every failure was a first-and-only
    attempt.
  - **Tests:** `backend/tests/test_processing.py` unit-tests `_run_with_one_retry` in isolation
    (succeeds first try / recovers on retry / gives up after both attempts fail / doesn't retry an
    unrelated exception) with fake flaky callables — no live Gemini/Supabase calls, same spirit as
    `test_metrics.py`/`test_feedback.py`.
- **"Regenerate report" (Phase 3 Step 2, done):** docs/PROJECT_PLAN.md Section 3 describes a
  manual "Regenerate report" option for a `failed` recording, retryable without limit — this now
  exists end to end, backend and frontend, and **closes out Section 3's "Retry behavior" in full**
  together with Phase 2 Step 6's automatic retry above: Step 6 handles transient failures
  automatically with zero user action (one inline retry per stage, immediately, within the same
  pipeline run), and this step covers anything still `failed` after that, with no retry-count
  limit on how many times a user can trigger it manually.
  - **Endpoint:** `POST /recordings/{recording_id}/regenerate`
    (`regenerate_report` in `app/routers/recordings.py`) — same bearer-token auth and
    ownership check as `/process` (factored into a shared `_fetch_authorized_recording` helper so
    both endpoints give a caller an identical 403 for a nonexistent vs. someone-else's recording;
    see [AI processing endpoint](#ai-processing-endpoint)'s "Auth" bullet), but the mirror image on
    the status check: valid only from `status == 'failed'` (409 otherwise, e.g. calling it on a
    `pending`/`processing`/`done` recording), where `/process` is valid only from `pending`. On
    success it schedules the exact same `process_recording()` background task as `/process` and
    returns `202` immediately the same way — no separate "regenerate" pipeline function.
  - **No extra reset needed before retrying:** confirmed by reading `process_recording()` itself,
    not assumed — it already starts every run by flipping `status` straight to `processing` (not
    `pending`; there's no intermediate `pending` state on a regenerate, unlike a fresh upload) as
    its very first write, then overwrites `transcript` unconditionally the moment transcription
    succeeds, `metrics` unconditionally right after, and `feedback` + the four v3 score columns
    (`impact_score` / `clarity_score` / `structure_score` / `grammar_issue_count` — all
    unconditional, v3 Epic F Step 1) + `title` (only when `title_edited_by_user` is `false` —
    v2 Epic D Part 7, see [Recording titles](#recording-titles)'s "Not overwriting a hand-edited
    title" subsection) alongside the final `status: done` write — so a regenerate refreshes the
    scores and (unless hand-edited) the title too, each able to move from `NULL` to a real value or
    vice versa. There's no separate
    failure-reason column or other failure-related state
    on the `recordings` row (see `supabase/migrations/0001_initial_schema.sql`) to clear first. The
    one nuance: if a regenerate run itself fails again at the feedback stage, whatever `transcript`/
    `metrics` that run just (re)computed stay on the row — same "don't discard good partial work"
    principle as the original run, just re-applied on a second pass.
  - **Frontend:** `regenerateReport()` (`src/lib/api.ts` — every `recordings` backend call in
    that module now goes through one private `authorizedRecordingRequest` helper, refactored in
    v2 Epic D Part 4) is called from both the History **list** (the `RecordingActionsMenu`'s
    "Regenerate report" item, failed rows only) and the **detail screen**
    (`ReportSection`'s failed-state button, *and* the menu) — see [History](#history)'s "3-dot actions menu" bullet
    under both the list and the detail screen for exactly how each is wired, including why the
    detail screen needed its own small polling effect that the list's Step 7 polling doesn't
    already cover.
- The same pattern (no cron) applies to v4's question-pool top-up: it fires from a
  `BackgroundTasks` call triggered by mode selection running low on unused questions, not a
  scheduled job. See plan Section 5's "Question pool" subsection.

## Dependency installation convention

**Every new npm / Expo package install is run by the human, locally, via `npx expo install
<package>` — never by Claude Code, and never via `npm audit fix`.** This is a hard rule, learned
the expensive way from the SDK 54→57 incident.

- **Claude Code must not run install commands in its own sandbox.** It has no real network access
  to the npm registry, so an install there either fails outright or — worse — silently resolves a
  version that doesn't match the pinned Expo SDK. Expo / React Native / the `react-native-*` and
  `expo-*` packages are tightly version-coupled to the SDK; a mismatched resolve can typecheck and
  still break at runtime in Expo Go, often not obviously.
- **NEVER `npm audit fix --force`** (and avoid plain `npm audit fix`). It ignores `package.json`'s
  pinned version ranges and will bump `expo` / `react-native` / their peers across a **major SDK
  boundary** to "resolve" an advisory, with no warning. That is exactly what caused the **SDK 54→57
  incident**: an `audit fix --force` jumped the project multiple SDK versions ahead of what the
  test iPhone's installed Expo Go app supports, breaking the app; recovery meant pinning every
  package back to SDK 54 by hand and having the human re-run `npx expo install
  @expo-google-fonts/noto-sans` locally.
- **`npx expo install --fix` / `npx expo upgrade` are also off-limits** without being asked —
  already in [Conventions](#conventions) below, same reasoning, restated here because it's the same
  failure mode.
- **When a future step needs a new dependency: stop and hand the exact install command back to the
  human** (e.g. "run `npx expo install expo-haptics` locally, then tell me to continue"). Don't run
  it, don't work around it, don't add a bare `package.json` entry and hope — wait for the human to
  install it and confirm before continuing that step.

## Conventions

- Use `expo-audio` for recording/playback — **not** `expo-av` (deprecated).
- Development runs via the **Expo Go** app on a physical iPhone, not a standalone/dev-client
  build. No Apple Developer Program membership yet — don't introduce anything that requires one
  (e.g. custom native modules outside the Expo Go sandbox, EAS device builds).
- **Expo SDK version is pinned deliberately** (currently SDK 54, per `package.json`) to match
  what the installed Expo Go app on the test iPhone supports — never run `expo install --fix`,
  `npx expo upgrade`, or otherwise change Expo/React Native/related package versions without
  being asked first, even to fix a peer-dependency warning.
- The backend (FastAPI on Render, background work via `BackgroundTasks`) is a **separate Python
  project** living in [backend/](../backend/), a sibling directory to `src/` in this same repo —
  not part of this Expo/TypeScript project, and don't mix backend code into `src/`. See
  [Backend](#backend) above for how to run/deploy it.
- Routing: **Expo Router**, file-based under `src/app/` (chosen over React Navigation — smaller
  boilerplate and better fit for this app's shallow, mostly-linear screen flow: home → record →
  processing → history/detail. See `src/app/` for routes, `src/components/` for shared UI,
  `src/lib/` for the Supabase client / future API calls, `src/types/` for shared TS types).
- Supabase URL/anon key are read from `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
  and the backend's base URL from `EXPO_PUBLIC_API_URL`, all in `.env` (gitignored; see
  `.env.example`) — never hardcode them. See [AI processing endpoint](#ai-processing-endpoint) for
  what `EXPO_PUBLIC_API_URL` needs to be set to locally vs. deployed.
- Full project plan, phases, and data-flow detail: [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md).
