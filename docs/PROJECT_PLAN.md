# Brevado Project Plan
## 1. Overview
Brevado is a mobile-first app for practicing concise, intentional public speaking. Each day, the user picks a mode (interview, story, or miscellaneous), records a voice memo answering a prompt (or a self-chosen topic), and receives AI-generated feedback shortly after — focused on structure, conciseness, and filler-word usage. Past sessions are stored with their feedback, forming a searchable practice history.

Goal of the app: make it effortless to build a daily practice habit and see, over time, whether speaking is actually getting more concise and intentional — not just generate one-off feedback.

Platform: React Native app (via Expo), iPhone-first, run through the free Expo Go app rather than a standalone App Store build. This uses real native microphone and file APIs (avoiding a documented iOS reliability issue with recording/downloads in standalone home-screen web apps) while staying fully free — the $99/year Apple Developer Program is only needed if this later graduates to its own installed app icon via TestFlight, which can be revisited once the habit proves out.

## 2. Scope
### In scope for v1
- Recording, playback, and AI feedback pipeline
- Mode selection with a hardcoded question pool
- Auth, history view, retry/regenerate logic, audio retention rules

### In scope for v2
- Criteria-based scoring and progress tracking
- Streak calendar
- Re-practice / redo-question mode
- Dynamically growing, AI-generated question pool
- Additional modes beyond interview/story

### Explicitly out of scope (for now)
- Email notifications
- Apple Developer Program enrollment / App Store or TestFlight distribution (staying on free Expo Go for now)
- Multi-tenant scaling concerns (rate limiting, abuse prevention, paid AI tier) — acceptable to defer since real usage is limited to the builder plus a few test accounts for the foreseeable future
- Push notifications (deletion warning is in-app badge only)

## 3. Features
### v1
**Recording flow**
- From the home screen, select a mode: Interview, Story, or Miscellaneous.
- Interview/Story: choose an AI-curated question from the pool, or type in your own question/topic instead.
- Miscellaneous: free-topic recording, no prompt — labeled by date only.
- Record via native mic access (expo-audio), then upload — same reliability as any native voice memo app, no browser sandbox involved.

**Processing & feedback**
- Audio is transcribed and analyzed by Gemini (single API, handles both transcription and feedback — no separate transcription service needed).
- Feedback is mode-aware: interview answers are evaluated on directness/structure, stories on narrative arc and pacing, miscellaneous on general clarity and conciseness.
- Deterministic metrics (filler-word rate, words per minute, repetition) are computed in code and fed into the feedback prompt as grounding, rather than relying on the LLM to count.
- A visible processing status indicator (pending → processing → done) shows while a report is generating.

**Retry behavior**
- On failure, the pipeline auto-retries once immediately.
- If it fails again, the recording is kept with no report; a "Regenerate report" option appears in a 3-dot menu, retryable without limit.
- If a report has never successfully generated, the audio is never auto-deleted (see retention rules below) — there'd be nothing to retry against otherwise.

**History**
- All past sessions (recording, mode, question/topic, transcript, feedback) are viewable, sorted by date.

**Audio retention**
- Once a report successfully generates, the audio auto-deletes 7 days later; the transcript and feedback are kept permanently.
- An in-app badge warns of pending deletion starting 2 days out.
- A manual "Save" button keeps audio indefinitely.
- A manual "Download" button exports the audio file to the phone via native file APIs (expo-file-system + the share sheet) — reliable in a way that browser-based blob downloads are not on iOS.

**Auth**
- Standard account creation/login (Supabase Auth). Open signup, though real usage for now is the builder plus a few test accounts.

### v2
- Criteria-based evaluation: each report scores the recording against a few defined criteria (e.g., conciseness, structure, filler-word usage, clarity) plus an overall rating, not just free-text feedback.
- Progress-over-time view: charts of those scores/metrics across sessions.
- Streak calendar: a calendar view with a dot on each day you recorded; tapping a day shows that day's recording, transcript, feedback, and scores.
- Re-practice mode: revisit a previously answered question and record a new attempt; view both attempts and feedback side by side.
- Dynamic question pool: see Section 5 below — grows automatically and enables re-practice without a separate system.
- Additional modes beyond interview/story, as needed.

## 4. Tech Stack
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

## 5. How It Works
### Recording → feedback pipeline
1. User selects mode + question/topic (or free topic for miscellaneous) and records.
2. Audio uploads to Supabase Storage; a recording row is created (status: processing).
3. A Celery task sends the audio directly to Gemini, requesting a transcript.
4. Code computes deterministic metrics from the transcript (filler words, WPM, repetition).
5. A second Gemini call generates mode-specific feedback using the transcript, metrics, and the original question/topic as context.
6. The recording row updates to done with transcript, metrics, and feedback attached.
7. The frontend polls (or uses SSE) so feedback appears within a few seconds of upload, without a manual refresh.

Note: since mode is now selected up front (not detected from spoken keywords), the earlier "detect interview vs. story from the first word" logic is no longer needed — this simplifies the pipeline.

### Question pool (v1 → v2 design)
- v1: A small hardcoded pool (~20–30 prompts per mode). On session start, pick randomly from the pool, excluding only the immediately previous question (no back-to-back repeats; repeats otherwise fine). No AI cost, no scheduled jobs required.
- v2: Add an answered_questions table (user, question, recording, date). This single table does double duty:
  - Re-practice mode — browse previously answered questions and re-record against one, for free.
  - Growing pool — a weekly Celery Beat job checks how many unused questions remain per mode; if running low, it asks Gemini to generate a new batch, explicitly prompted with the existing pool to avoid near-duplicates. This keeps AI usage to a handful of calls per week rather than per recording.

### Audio retention job
A scheduled Celery task runs daily:
- Finds recordings with a successful report, past their 7-day mark, and not manually saved → deletes the audio file (keeps the DB row, transcript, and feedback).
- Flags recordings entering their 2-day warning window so the frontend can show the deletion badge.

## 6. Implementation Phases
Rather than a dated timeline, this is scoped as generic phases you can pick up in whatever time you have available:
- **Phase 1 — Foundation** Auth, basic recording UI, upload to storage, minimal history list (no AI yet). Test recording + playback on an actual iPhone via Expo Go early in this phase, since it's the foundation everything else builds on.
- **Phase 2 — AI pipeline** Wire up Celery + Redis, Gemini transcription + feedback generation, deterministic metrics, processing status indicator.
- **Phase 3 — History, retention & retry** Full history view (audio + transcript + feedback per session), retry/regenerate logic, 7-day deletion job, save/download buttons, deletion warning badge.
- **Phase 4 — v1 polish** Hardcoded question pool + mode selection flow, custom topic input, end-to-end testing on an actual iPhone via Expo Go.
- **Phase 5 — v2** Criteria-based scoring, progress charts, streak calendar, re-practice mode, dynamic question pool + weekly generation job.

## 7. Cost
At current scope (builder + a few test accounts), this is realistically $0/month:
| Service | Free tier | Fit |
|---|---|---|
| Expo / Expo Go | Free | ✅ no Apple Developer account needed; EAS Build free tier covers occasional cloud builds if ever required |
| Render (API) | Free web service | ✅ (sleeps when idle — fine at this usage level) |
| Upstash Redis | Free tier | ✅ trivial usage |
| Supabase (Auth + DB + Storage) | Free tier | ✅ — worth monitoring storage as audio accumulates, though the 7-day auto-delete significantly limits long-term growth |
| Gemini API | Flash models, free tier | ✅ no card required, generous daily request allowance, comfortably covers daily personal use |

Optional future costs:
- Apple Developer Program: $99/year — only needed if this graduates from Expo Go to a proper installed app icon via TestFlight/App Store. Deliberately deferred; revisit once the daily habit proves out.
- Custom domain (for the API only): ~$12/year, not required.
- If usage ever expands to real external users: move off Gemini's free tier to paid (cheap, and removes the "data used for training" tradeoff) — not a concern at current scope.
