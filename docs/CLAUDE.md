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

**Phase 1 — Foundation.** Auth, basic recording UI, upload to storage, minimal history list (no
AI yet). We're working phase-by-phase (see plan Section 6); don't reach ahead into later phases
without being asked.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React Native + TypeScript (Expo), run via Expo Go | Mobile-first UI: recording (expo-audio), playback, history, dashboard. Free, no Mac needed to develop (EAS Build compiles in the cloud if ever needed) |
| Auth | Supabase Auth | Account creation/login |
| Database | Supabase Postgres | Users, recordings, transcripts, feedback, questions |
| File storage | Supabase Storage | Audio files, subject to the 7-day retention policy |
| API | Python (FastAPI) on Render | Handles uploads, enqueues background jobs, serves data to the frontend |
| Task queue | Celery + Upstash Redis | Per-recording processing jobs, plus scheduled jobs (retention cleanup, v2 question generation) |
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
  `saved`/`audio_deleted` flags, `report_generated_at` (drives the 7-day retention window).
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
  just Home + Explore) and two ungrouped screens, `login.tsx` and `signup.tsx`. `src/app/_layout.tsx`
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

## Conventions

- Use `expo-audio` for recording/playback — **not** `expo-av` (deprecated).
- Development runs via the **Expo Go** app on a physical iPhone, not a standalone/dev-client
  build. No Apple Developer Program membership yet — don't introduce anything that requires one
  (e.g. custom native modules outside the Expo Go sandbox, EAS device builds).
- **Expo SDK version is pinned deliberately** (currently SDK 54, per `package.json`) to match
  what the installed Expo Go app on the test iPhone supports — never run `expo install --fix`,
  `npx expo upgrade`, or otherwise change Expo/React Native/related package versions without
  being asked first, even to fix a peer-dependency warning.
- The backend (FastAPI + Celery, on Render) is a **separate Python project**, not part of this
  Expo/TypeScript project — don't mix backend code into `src/`.
- Routing: **Expo Router**, file-based under `src/app/` (chosen over React Navigation — smaller
  boilerplate and better fit for this app's shallow, mostly-linear screen flow: home → record →
  processing → history/detail. See `src/app/` for routes, `src/components/` for shared UI,
  `src/lib/` for the Supabase client / future API calls, `src/types/` for shared TS types).
- Supabase URL/anon key are read from `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  in `.env` (gitignored; see `.env.example`) — never hardcode them.
- Full project plan, phases, and data-flow detail: [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md).
