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

**Phase 2 — AI pipeline, Step 1 (FastAPI skeleton) done.** Phase 1 (auth, recording UI, upload,
minimal history) is complete. Phase 2 continues with Gemini transcription + feedback generation,
deterministic metrics, and a processing status indicator, run via FastAPI's `BackgroundTasks` (see
[Background processing](#background-processing)) — no queue/broker/worker setup needed. Only
Step 1 of Phase 2 (the bare FastAPI skeleton, deployed and reachable) exists so far; see
[Backend](#backend) below for exactly what does and doesn't exist yet. We're working
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
  (`pending`/`processing`/`done`/`failed`), `transcript`, `feedback`, `metrics` (jsonb, Phase 2),
  `favorite`/`audio_deleted` flags. `favorite` is a personal star marker (renamed from `saved`,
  which used to mean "exempt from the old 7-day auto-delete") — it's no longer tied to any
  deletion behavior. `report_generated_at` has been removed — it only existed to compute the old
  7-day window. Retention is now a per-user cap, `MAX_RECORDINGS_PER_USER = 30` (counting rows
  where `audio_deleted = false`), defined in `backend/app/config.py` — the constant exists but
  enforcement logic (checked on new-recording start) isn't wired up yet, a later step. Deletion is
  manual only (bin icon per history row), and only ever clears `audio_path`/sets
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
  core home-screen action per the project plan. `RecordingPlayback`, the play/pause + progress UI
  shown after stopping, is a private component in the same file; split it out only if another
  screen needs it.
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

## History

- Lives at `src/app/(tabs)/history.tsx` — this **replaces the scaffold's placeholder "Explore"
  tab** rather than adding a third tab (`app-tabs.tsx` and `app-tabs.web.tsx` were updated
  accordingly: `NativeTabs.Trigger`/`TabTrigger` name and route both renamed `explore` →
  `history`). The tab still reuses the scaffold's `explore.png` icon — there's no dedicated
  history icon asset yet; swap it whenever one exists.
- Query logic is `fetchRecordings()` in `src/lib/recordings.ts`, alongside the upload logic —
  selects `id, mode, status, created_at` for the current user ordered by `created_at desc`. It
  only selects those four columns; widen it (or use `select('*')`) once Phase 3's detail view
  needs `transcript`/`feedback`/`metrics` too.
- **What it shows right now, deliberately sparse**: date/time, mode, and status per row in a flat
  list — no transcript/feedback (Phase 2 doesn't generate any yet), and rows aren't tappable
  (Phase 3 adds the detail view). Every row currently reads `miscellaneous` / `pending` because
  that's all Upload can produce before Phase 2's processing pipeline and Phase 4's mode selection
  exist — this is expected, not a bug, until those phases land.
- Refresh: the list refetches on every focus (`useFocusEffect`, not a mount-only effect) so
  landing here from a fresh upload — or tabbing back after a second recording — always shows
  current data, since tab screens stay mounted in the background rather than remounting on
  switch. Pull-to-refresh (`RefreshControl`) covers the same case manually. Both call the same
  `fetchRecordings()` — no real-time subscription yet; that's more naturally Phase 2's job, once
  there's a `status` that actually changes after the row is created.
- Loading (first fetch only, not on subsequent focus refetches — those update the list silently
  once data arrives so switching tabs doesn't re-blank it), empty, and fetch-error (with a Retry
  action, and without clearing any previously-loaded list) states are all handled explicitly.
- Upload → History handoff: on a successful upload, the Home tab (`src/app/(tabs)/index.tsx`)
  calls `router.navigate('/history')` right after setting its own "done" state, so the user lands
  on the updated list immediately instead of stopping at a static confirmation. The Home tab's own
  "done" confirmation state is intentionally left in place (not reset) underneath — tabbing back
  to Home still shows "Uploaded" + the recording id + "Record another", rather than silently
  resetting a screen the user didn't touch.

## Backend

- Lives in [backend/](../backend/) — a sibling top-level directory in this same repo, alongside
  `src/`, `docs/`, `supabase/`. It's a **separate Python project** (own venv, own dependencies,
  own `.gitignore`) sharing git history with the Expo app rather than living in its own repo;
  don't mix backend code into `src/` or frontend code into `backend/`.
- Structure: a small package rather than a single file, since Phase 2 will grow this a lot —
  `backend/app/main.py` creates the FastAPI app and includes routers from `backend/app/routers/`
  (currently just `health.py`); `backend/app/config.py` holds a `pydantic-settings` `Settings`
  object reading from `.env`. Add new endpoints as new router modules under `app/routers/`
  rather than growing `main.py` directly.
- Dependencies are pinned in `backend/requirements.txt` (plain pip, not `pyproject.toml` — this
  is a small service without a package to publish, so `pip install -r requirements.txt` is the
  simplest thing that works and matches Render's default Python build).
- Config: `backend/.env` (gitignored; see `backend/.env.example`) holds `PORT` (local dev only —
  Render injects its own `$PORT`) plus `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` placeholders.
  Those two are **unused as of Step 1** — reserved for whenever the processing pipeline needs to
  read/write `recordings` rows and Storage objects directly, bypassing RLS.
- Run locally: from `backend/`, `python -m venv .venv`, activate it, `pip install -r
  requirements.txt`, then `uvicorn app.main:app --reload`. Confirm it's alive by hitting
  `GET http://localhost:8000/health` → `{"status": "ok"}`.
- Deploy target: Render, as a free-tier Python web service, configured via the `render.yaml`
  Blueprint at `backend/render.yaml` (chosen over manual dashboard setup so the service config
  lives in version control and Render re-syncs it automatically on push, rather than dashboard
  clicks nobody remembers later). Live URL: `https://brevado-api.onrender.com` (exact subdomain
  depends on what's available when the service is first created — check the Render dashboard for
  the actual assigned URL). Confirm a deploy is alive the same way as local: hit that URL's
  `/health` and expect `{"status": "ok"}`. Free tier sleeps after inactivity, so the first hit
  after a while can take ~30s to wake up.
- **What exists after Step 1, and what doesn't yet:** just the FastAPI app and the `/health`
  endpoint, deployed and reachable. No Gemini calls, no upload/processing endpoints, nothing that
  talks to Supabase — the backend "does nothing" at this point by design. Those land in Step 2
  onward within Phase 2, using `BackgroundTasks` (see [Background processing](#background-processing))
  rather than any separate queue/worker; don't be surprised the API has no real endpoints yet.

## Background processing

- No task queue, broker, or worker process — background work (transcription + feedback
  generation) runs via FastAPI's built-in `BackgroundTasks`, in the same process as the web
  service that serves everything else. Chosen because Render has no free tier for a background
  worker (minimum ~$7/month), and this project stays at $0/month at its current scale (builder +
  a few test accounts).
- Trigger point: the upload endpoint (Phase 2, not yet built) creates/updates the `recordings` row
  first, then schedules a `BackgroundTasks` call to do the Gemini transcription + feedback work —
  same request/response cycle, no separate dispatch step.
- Retry: one inline retry on failure (plain try/except around the Gemini call), not a queue retry
  policy. If the retry also fails, the recording is left with no report; the existing
  "Regenerate report" 3-dot-menu flow (Phase 3) covers retrying again later.
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
- Supabase URL/anon key are read from `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  in `.env` (gitignored; see `.env.example`) — never hardcode them.
- Full project plan, phases, and data-flow detail: [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md).
