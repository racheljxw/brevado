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

**Phase 2 — AI pipeline — complete, Step 7 (frontend status polling) was the closing step.**
Phase 1 (auth, recording UI, upload, minimal history) is complete. Step 1 (bare FastAPI skeleton),
Step 2 (the upload -> process -> poll plumbing), Step 3 (real Gemini transcription, replacing the
stub transcript), Step 4 (deterministic filler-word/WPM/repetition metrics, computed in code from
the transcript), Step 5 (real mode-aware Gemini feedback, replacing the stub feedback string),
Step 6 (the real one-inline-retry failure policy from docs/PROJECT_PLAN.md Section 3 — see
[Background processing](#background-processing)), and Step 7 (out-of-order-safe, per-row-aware
History polling, plus a visually distinct `failed` status — see [History](#history) and the
"Frontend polling" bullet under [AI processing endpoint](#ai-processing-endpoint)) all exist now — see
[AI processing endpoint](#ai-processing-endpoint), [Metrics](#metrics), and [Backend](#backend)
below for exactly what's real. **No stubs remain anywhere in the pipeline** — transcribe ->
metrics -> feedback are all real Gemini/code calls end to end, `status: done` means the full
pipeline actually ran (retrying once inline if either Gemini-calling stage fails), and the
frontend reflects that status accurately and promptly without flashing stale data.
**Phase 3 — History, retention & retry — in progress. Steps 1, 2, 3, and 4 are done.** Step 1
(full history detail view) — see [History](#history)'s "Detail screen" bullet for exactly what it
shows. **Step 2 (manual "Regenerate report") is now built, backend and frontend** — see
[Background processing](#background-processing)'s "Regenerate report" bullet and
[AI processing endpoint](#ai-processing-endpoint)'s "Regenerate endpoint" bullet for exactly what
exists. This closes out docs/PROJECT_PLAN.md Section 3's "Retry behavior" in full: the automatic
one-inline-retry-per-stage from Phase 2 Step 6 handles transient failures without any user action,
and this step's manual regenerate covers anything still `failed` after that, retryable without
limit. **Step 3 (per-user recording cap enforcement) is now built** — `MAX_RECORDINGS_PER_USER`
(30) is checked before a new recording can even start, and enforced again independently by a
Postgres trigger as a safety net — see [Recording cap](#recording-cap) for the full detail
(including exactly where the frontend check lives and the note-to-self about Phase 4 needing to
move it). **Step 4 (favorite toggle) is now built, list and detail** — a star icon on each History
list row and on the detail screen, both calling the same direct-Supabase `setFavorite()` — see
[History](#history)'s "Favorite toggle" bullets for exactly where and how, and note it's a
**purely cosmetic personal marker with no automated behavior attached** — no retention exemption,
no confirmation gate before Step 5 deletes a favorited recording's audio; favorite and delete are
fully independent. Note docs/PROJECT_PLAN.md Section 6's phase descriptions are stale (still
describe the old Celery/time-based retention plan) — Sections 3, 4, 5, and 7 reflect the current
zero-cost, cap-based, manual-delete architecture and are the ones to trust. We're working
phase-by-phase and step-by-step within a phase; don't reach ahead without being asked.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React Native + TypeScript (Expo), run via Expo Go | Mobile-first UI: recording (expo-audio), playback, history, dashboard. Free, no Mac needed to develop (EAS Build compiles in the cloud if ever needed) |
| Auth | Supabase Auth | Account creation/login |
| Database | Supabase Postgres | Users, recordings, transcripts, feedback, questions |
| File storage | Supabase Storage | Audio files, capped per user (`MAX_RECORDINGS_PER_USER`) and manually deleted rather than time-expired |
| API | Python (FastAPI) on Render | Handles uploads, serves data to the frontend, and runs background processing in-process via FastAPI's `BackgroundTasks` — no separate queue/broker/worker service |
| AI | Gemini API (Flash model, free tier) | Transcription (native audio input) + feedback generation; question generation in v2 |
| Hosting | Render (API only) | Frontend isn't web-hosted — it runs as an Expo project loaded through the Expo Go app; free-tier API subdomain, custom domain optional |

## Scope — don't let v2 creep into v1 work

**v1 (build now):** recording/playback/AI feedback pipeline, mode selection with a hardcoded
question pool, auth, history view, retry/regenerate logic, audio retention rules.

**v2 (deferred — do not build yet):** criteria-based scoring, progress-over-time charts, streak
calendar, re-practice/redo-question mode, dynamically growing AI-generated question pool,
additional modes beyond interview/story.

**Out of scope for now:** email notifications, Apple Developer Program / App Store / TestFlight
distribution, multi-tenant scaling concerns (rate limiting, abuse prevention, paid AI tier), push
notifications (deletion warning is in-app badge only).

## Database

Supabase Postgres, no ORM — query via the `supabase-js` client (`src/lib/supabase.ts`) using
`.from(...)`, not raw SQL from the app. Schema lives as versioned SQL in
`supabase/migrations/` (`0001_initial_schema.sql`, `0002_storage_bucket.sql`, …) — that's the
source of truth; don't assume a table shape without checking there first, and add new schema
changes as a new numbered migration file rather than editing an applied one.

- `recordings` — one row per practice session: mode, question/topic, `audio_path`, `status`
  (`pending`/`processing`/`done`/`failed`), `transcript`, `feedback`, `metrics` (jsonb, Phase 2
  Step 4 — see [Metrics](#metrics) for the exact shape stored),
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
  [Recording cap](#recording-cap) for where and how. Deletion is manual only (bin icon per history
  row — not yet built, Phase 3 Step 5), and only ever clears `audio_path`/sets
  `audio_deleted = true`; it never removes the row.
- `questions` — stub only (`id`, `mode`, `prompt_text`, `created_at`), reserved shape for the
  Phase 4 hardcoded pool and Phase 5 dynamic pool / re-practice. Not queried anywhere yet.

RLS is **on** for both tables and scoped to `user_id = auth.uid()` on `recordings` (select/insert/
update only — no delete policy yet, add one deliberately if a "delete recording" feature shows
up). `questions` is open-read (no user-specific data); writes to it go through the service-role
key only, bypassing RLS. Storage (`recordings-audio` bucket, private) mirrors this: objects must
live under a `{user_id}/...` path prefix, enforced by storage RLS policies in
`0002_storage_bucket.sql`.

## Auth

- The auth context/provider lives at `src/lib/auth-context.tsx` (`AuthProvider` + `useAuth()`).
  It wraps the whole app from `src/app/_layout.tsx`, holds `session`/`user`/`loading` state via
  Supabase's `onAuthStateChange`, and exposes `signUp` / `signIn` / `signOut` — these already
  convert raw Supabase `AuthError`s into a plain `error: string | null` for screens to show
  directly, so screens should never touch `error.message` from a raw Supabase call themselves.
- Routes are split into two Expo Router groups off `src/app/`: `(tabs)/` (the real app, currently
  Home + History) and two ungrouped screens, `login.tsx` and `signup.tsx`. `src/app/_layout.tsx`
  reads `useAuth()` and renders one group or the other via `Stack.Protected` — signed-in users only
  ever see `(tabs)`, signed-out users only ever see login/signup, and a loading screen covers the
  initial session check on boot. **Future screens that only make sense when logged in belong under
  `(tabs)/`** (or a new sibling group gated the same way) — don't add ad hoc auth checks inside
  individual screens, the routing layer already handles it.
- Basic client-side validation (non-empty, email shape, min password length) lives in
  `src/lib/auth-validation.ts`, shared by both screens.
- Email confirmation is **on by default** for new hosted Supabase projects — an account created
  via `signUp` gets no session back until the confirmation link is clicked, which `auth-context`
  surfaces as `needsEmailConfirmation` (the signup screen shows a "check your email" notice in
  that case rather than silently doing nothing). To turn it off for solo/local testing: Supabase
  dashboard → **Authentication → Sign In / Providers → Email**, toggle off **Confirm email**. This
  wasn't verified against this project's actual dashboard state — check it directly and flip it
  per your own testing needs; flip it back on before any real users sign up.

## Recording

- Recording/playback uses **`expo-audio`**, not `expo-av` (deprecated, and the library it's easy to
  reach for out of habit — see Conventions below).
- The recording screen lives at `src/app/(tabs)/index.tsx` (the Home tab) — it replaces the
  template's placeholder content rather than living at a separate route, since recording is the
  core home-screen action per the project plan. `RecordingPlayback`, the upload/keep/discard UI
  shown after stopping, is a private component in the same file, but its play/pause + progress bar
  controls now live in `AudioPlaybackControls` (`src/components/audio-playback-controls.tsx`),
  extracted in Phase 3 Step 1 once the History detail screen needed the exact same controls for a
  recording's already-uploaded audio — see [History](#history).
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

- **Where the check currently lives, precisely: `handleStartRecording()` in
  `src/app/(tabs)/index.tsx` (the Home tab's record button), the first thing it does before
  requesting mic permission or calling `recorder.record()`.** This is the "natural checkpoint"
  only because Phase 4 hasn't built mode selection yet — **when Phase 4 replaces this button with
  a mode-selection screen as the real entry point into recording, this check (the
  `getActiveRecordingCount` call, the `MAX_RECORDINGS_PER_USER` comparison, and the
  block-with-message behavior) needs to move to that screen's entry point.** Don't let this get
  forgotten when Phase 4 starts — it's easy to build the new screen and only notice the cap check
  never made the jump once someone actually hits 30 recordings again.
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
  - On a cap hit, `handleStartRecording` sets local state that swaps the entire record button out
    for a `CapBlockedCard` (same file) — a clear "You've reached your 30 recording limit. Delete
    some audio from History to record more." message plus a "Go to History" button
    (`router.navigate('/history')`). The recording UI (mic permission prompt, `recorder.record()`)
    is never reached in this state.
  - If the count query itself fails (network blip), the check **fails open** — recording is
    allowed to proceed rather than blocking someone over a check that couldn't complete. The
    Postgres trigger below is what makes that safe to do.
  - The blocked state resets on every screen focus (`useFocusEffect`), so navigating back from
    History (e.g. after a future manual delete frees a slot) shows the normal record button again;
    the next tap re-checks for real rather than trusting the stale cleared state.
  - Under the cap, this is invisible: the count query runs once, inline, at tap time, and the
    button behaves exactly as before — no separate loading UI was added for it, since it's a single
    indexed count query and resolves well within the time the user spends granting mic permission
    anyway.
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
- **No way to free a slot yet:** manual delete (Phase 3 Step 5, the bin icon in History) isn't
  built. Until it is, the only way to drop below the cap for testing is deleting `recordings` rows
  directly in the Supabase dashboard's table editor (or lowering `audio_deleted`-false row count
  some other manual way) — expected and fine for exercising this step in isolation, not a bug.
- **How this was tested:** `MAX_RECORDINGS_PER_USER` was temporarily lowered to `2` in all three
  places (`backend/app/config.py`, `src/lib/recordings.ts`, and the migration's `max_recordings`)
  to make hitting the cap practical by hand, confirmed both that recording is blocked with the
  clear message at the cap and that recording still works normally below it, then the constant was
  set back to `30` in all three places before calling this step done.

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
  selects `id, mode, status, created_at` for the current user ordered by `created_at desc`. It's
  intentionally still just those four columns for the list — the detail screen (below) widens to
  the full row with its own separate query, `fetchRecordingById()`, rather than this one growing a
  `select('*')` the list itself doesn't need.
- **What it shows right now, deliberately sparse**: date/time, mode, and status per row in a flat
  list — no transcript/feedback text inline (the Phase 3 Step 1 detail screen, below, is where that
  lives). Mode still always reads `miscellaneous` since Phase 4's mode selection doesn't exist yet
  — that part is still expected, not a bug — but `status` now genuinely moves `pending` ->
  `processing` -> `done`/`failed` as the real backend pipeline runs, not a placeholder value.
- **Status is visually distinct per state (Step 7):** `RecordingListItem`'s status badge colors
  `failed` red and `done` green (raw hex, not theme tokens, matching the same red already used for
  the record/error accents elsewhere in the app; same in light and dark mode) so a failed recording
  doesn't read as just another line of text next to `pending`/`processing`. `pending`/`processing`
  stay a neutral badge (`processing` additionally reads "Processing…" rather than the bare status
  word).
- **"Regenerate report" per row (Phase 3 Step 2, done):** a `failed` row also renders an inline
  "Regenerate report" text action directly in `RecordingListItem` — the plan's spec calls for a
  3-dot menu, but a plain inline action was judged to read just as clearly at this app's scale
  without a new menu component, so that's what's built. It's nested inside the row's outer
  `Pressable` (which navigates to the detail view on tap elsewhere in the row); React Native's
  touch responder system gives the inner `Pressable` exclusive claim on its own taps, so pressing
  it doesn't also navigate. Calls the same `regenerateReport()` (`src/lib/api.ts`) as the detail
  screen's button — see that screen's own "Regenerate report" bullet above and
  [Background processing](#background-processing)'s bullet for the backend side — with per-row
  in-flight/error state (`regeneratingIds`/`regenerateErrors`, keyed by recording id, in
  `HistoryScreen`) so regenerating one failed row doesn't affect any other. On success, the row is
  optimistically flipped to `processing` in local state, which the existing Step 7 polling below
  already picks up on its very next tick — nothing about that polling needed to change to support
  this.
- **Favorite toggle (Phase 3 Step 4, done):** each row also renders a star icon
  (`FavoriteStar`, `src/components/favorite-star.tsx` — shared with the detail screen below,
  filled `star.fill` vs. outline `star` via `expo-symbols`, same SF Symbols pattern already used by
  `Collapsible`) next to the status badge. Tapping it calls `setFavorite()` (`src/lib/recordings.ts`)
  — a **direct Supabase update, not a backend endpoint**: same reasoning as the recording-cap check
  in [Recording cap](#recording-cap) — RLS already scopes the update to the calling user, there's no
  Gemini/Storage call involved (unlike `/process`/`/regenerate`, which exist as backend endpoints
  specifically to hold the Gemini API key), so a backend round-trip would only add latency. The
  toggle is optimistic: local state flips immediately on tap (`handleToggleFavorite` in
  `HistoryScreen`, per-row in-flight tracked in `favoritingIds`) and reverts only if the update
  itself fails — no waiting on a refetch/poll tick to see the new state. **Purely a personal
  marker** — favoriting a recording has no effect on the cap, retention, or delete behavior (Step
  5); favorite and delete are fully independent, by design (see [Database](#database)).
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
- Upload → History handoff: on a successful upload, the Home tab (`src/app/(tabs)/index.tsx`)
  calls `router.navigate('/history')` right after setting its own "done" state, so the user lands
  on the updated list immediately instead of stopping at a static confirmation. The Home tab's own
  "done" confirmation state is intentionally left in place (not reset) underneath — tabbing back
  to Home still shows "Uploaded" + the recording id + "Record another", rather than silently
  resetting a screen the user didn't touch.
- **Detail screen (Phase 3 Step 1, done):** tapping a row pushes `src/app/(tabs)/history/[id].tsx`
  (`router.push({ pathname: '/history/[id]', params: { id } })` from `RecordingListItem`), a
  dynamic Expo Router route sitting alongside `index.tsx` in the same `history/` directory —
  `history/_layout.tsx` wraps both in a headerless `Stack` (matching every other screen's
  no-native-header convention) rather than letting the default nested-stack header appear only
  here. It fetches the full row with a new `fetchRecordingById()` (`src/lib/recordings.ts`;
  relies on the existing `recordings` select RLS policy to make a bad id or another user's id come
  back as `null` instead of a 403 the frontend has to special-case) and shows date/time, mode, a
  status badge (`getStatusPresentation`, pulled out of the list into `src/lib/recording-status.ts`
  so both screens render status identically), audio playback, transcript, feedback, and metrics
  (filler-word rate shown as a rounded percentage, words-per-minute, and repetition count — plain
  text/numbers, no charts or scoring visuals, which is Phase 5). Loading and not-found/error states
  (bad id, RLS-blocked id, or a genuine fetch failure) are all handled explicitly, the last two with
  a Retry action.
  - **`status === 'failed'`** shows a clear failed notice instead of a transcript/feedback/metrics
    section — there isn't one, since a transcription failure marks the row failed with nothing else
    attempted (see [AI processing endpoint](#ai-processing-endpoint)) — plus, as of Phase 3 Step 2,
    a "Regenerate report" button right alongside it (`ReportSection` in `history/[id].tsx`).
    `pending`/`processing` (a row can be tapped into straight from History before the pipeline
    finishes) shows a plain "still processing" notice instead, rather than rendering `null`
    transcript/feedback as if that were the real, finished content.
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
    controls**, built now even though nothing sets that flag `true` yet (Phase 3 Step 5, manual
    delete, isn't built) — so this screen doesn't need revisiting once it is. A missing
    `audio_path` on an otherwise-real row (shouldn't happen, given upload-then-insert — see
    [Upload](#upload)) is handled the same defensive way rather than crashing.

## Backend

- Lives in [backend/](../backend/) — a sibling top-level directory in this same repo, alongside
  `src/`, `docs/`, `supabase/`. It's a **separate Python project** (own venv, own dependencies,
  own `.gitignore`) sharing git history with the Expo app rather than living in its own repo;
  don't mix backend code into `src/` or frontend code into `backend/`.
- Structure: a small package rather than a single file, since Phase 2 will grow this a lot —
  `backend/app/main.py` creates the FastAPI app (and now also configures root logging — see
  [AI processing endpoint](#ai-processing-endpoint)) and includes routers from
  `backend/app/routers/` (`health.py`, `recordings.py`); `backend/app/config.py` holds a
  `pydantic-settings` `Settings` object reading from `.env`. `backend/app/supabase_client.py`
  builds the one shared service-role Supabase client, `backend/app/gemini_client.py` (Step 3)
  builds the one shared Gemini client the same way, `backend/app/auth.py` holds the bearer-token
  verification dependency, and `backend/app/services/` holds background-work logic —
  `processing.py` (the pipeline orchestration), `metrics.py` (Step 4, pure deterministic-metrics
  logic — see [Metrics](#metrics)), and `feedback.py` (Step 5, mode-aware feedback-prompt building
  and the Gemini call that generates it — see [AI processing endpoint](#ai-processing-endpoint)).
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
  older `google-generativeai`), and `mutagen` (added in Step 4 — see [Metrics](#metrics) for why).
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
- **What exists after Step 6:** the FastAPI app, `/health`, and `POST /recordings/{id}/process`
  (bearer-token verification, ownership/status checks, and a `BackgroundTasks`-scheduled
  `process_recording()`) — see [AI processing endpoint](#ai-processing-endpoint). Upload and
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
  docs/PROJECT_PLAN.md Section 3), and only then sets `status: done` with that real feedback
  attached. `status: done` now means the full pipeline actually ran, transcript through feedback.
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
- **Frontend polling (Step 7, done):** the History screen (`src/app/(tabs)/history.tsx`) refetches
  on a 1.5s interval whenever any visible row is `pending`/`processing`, so status visibly moves to
  `done`/`failed` without a manual pull-to-refresh — see [History](#history) for the full behavior
  (out-of-order-response guard, per-row stop condition, focus-gating) and why a flat interval
  (rather than backoff) was kept. Still a plain interval, not SSE/WebSockets/real-time — that
  tradeoff was reconsidered for this step and kept: the pipeline finishes in seconds to tens of
  seconds, this app has a handful of test users, and a push mechanism would add real infra
  (a persistent connection, or a DB trigger/webhook to invalidate on) for a savings that isn't
  needed at this scale.
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

- **Storage shape:** stored as-is into the `recordings.metrics` jsonb column:
  ```json
  {"filler_word_rate": 0.08, "words_per_minute": 142, "repetition_count": 3, "word_count": 210}
  ```
  `filler_word_rate` is a **fraction (0.0–1.0), not a percentage** — 0.08 means 8%. `word_count` is
  included alongside the two fields derived from it since the feedback prompt (see
  [Feedback generation](#feedback-generation)) and Phase 5's scoring both want it directly rather
  than re-deriving it from the transcript. This exact shape is what `app/services/feedback.py`
  reads as feedback-prompt grounding — changing key names or the rate/percentage convention later
  means updating both that prompt and Phase 5 scoring, not just this module.
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
  docs/PROJECT_PLAN.md Section 3. All three branches are built and tested now even though every
  real recording today is `mode='miscellaneous'` (Phase 1's placeholder recording flow — Phase 4
  hasn't built real mode selection yet), so Phase 4 doesn't need this rebuilt.
- **Output:** free-text prose feedback only (2-4 short paragraphs, no headers/bullets/numeric
  scores) — structured, criteria-based scoring is explicitly Phase 5 of the project plan (a
  different "Phase 5" than this Step 5; see docs/PROJECT_PLAN.md's phase list), not this step.
- **Model:** reuses the same shared Gemini client and `settings.gemini_model` as transcription (see
  [AI processing endpoint](#ai-processing-endpoint)) — a single text-in/text-out call has no reason
  to use a different model from transcription.
- **Failure handling:** `FeedbackGenerationError` (mirroring `TranscriptionError` in
  `processing.py`) is raised for a failed Gemini call or an empty/unusable response. Critically,
  `process_recording` stores the transcript and metrics to the row *before* attempting feedback
  generation, so a `FeedbackGenerationError` never loses or overwrites that already-successful
  work — only `status` moves to `failed`. Same "don't discard good partial work" principle as a
  transcription failure, applied one stage later. As of Step 6, a `FeedbackGenerationError` gets
  one immediate inline retry of just the feedback call (reusing the transcript/metrics already in
  hand, no re-transcription) before the recording is marked `failed` — see
  [Background processing](#background-processing).
- **Tests:** `backend/tests/test_feedback.py` (pytest) checks `build_feedback_prompt` and
  `_format_metrics_grounding` directly — that the built prompt string contains the right
  mode-specific criteria, handles a `null` question vs. a real one, includes the transcript
  verbatim, and reflects the metrics grounding correctly (including `None` metrics and a `None`
  `words_per_minute`) — for all three modes. Does **not** call the live Gemini API; run with
  `pytest` from `backend/` alongside the metrics tests.

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
    succeeds, `metrics` unconditionally right after, and `feedback` only alongside the final
    `status: done` write. There's no separate failure-reason column or other failure-related state
    on the `recordings` row (see `supabase/migrations/0001_initial_schema.sql`) to clear first. The
    one nuance: if a regenerate run itself fails again at the feedback stage, whatever `transcript`/
    `metrics` that run just (re)computed stay on the row — same "don't discard good partial work"
    principle as the original run, just re-applied on a second pass.
  - **Frontend:** `regenerateReport()` (`src/lib/api.ts`, sharing a private `postRecordingAction`
    helper with `startProcessing()` — same request shape, different path) is called from both the
    History **list** (`RecordingListItem`, per failed row) and the **detail screen**
    (`ReportSection`'s failed-state button) — see [History](#history)'s "Regenerate report" bullets
    under both the list and the detail screen for exactly how each is wired, including why the
    detail screen needed its own small polling effect that the list's Step 7 polling doesn't
    already cover.
- The same pattern (no cron) applies to the v2 question-pool top-up: it fires from a
  `BackgroundTasks` call triggered by mode selection running low on unused questions, not a
  scheduled job. See plan Section 5's "Question pool" subsection.

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
