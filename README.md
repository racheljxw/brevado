# Brevado

**Unmute your potential.**

Brevado is a mobile-first app for building a daily speaking-practice habit. Each day you pick a
mode, record a short voice memo answering a prompt (or a topic of your own), and get AI-generated
feedback a few seconds later — focused on structure, conciseness, and filler words. Every session
and its feedback is kept in a searchable history, and a Streaks tab tracks whether your speaking is
actually getting tighter over time, not just whether you showed up.

<img width="146" height="316" alt="IMG_5907" src="https://github.com/user-attachments/assets/c330e3e6-80eb-4885-bef0-23815e85a035" />
<img width="146" height="316" alt="IMG_5909" src="https://github.com/user-attachments/assets/8607f148-d9fa-4071-86e0-5b06ae145997" />
<img width="146" height="316" alt="IMG_5911" src="https://github.com/user-attachments/assets/54cf11b4-eb06-4a52-abba-cb94e910134d" />
<img width="146" height="316" alt="IMG_5910" src="https://github.com/user-attachments/assets/26a115db-1c58-44ee-b78c-f50f9d98ffb5" />


## Features

- **Daily practice modes.** Choose **Interview**, **Storytelling**, or **Miscellaneous** (free
  topic). Interview and Storytelling each get one shared *question of the day* — the same prompt for
  every user that day — or you can type your own question instead.
- **Record and review.** Record straight from the phone's microphone, play the take back, then keep
  it or discard and try again.
- **AI feedback pipeline.** On upload, the audio is transcribed, deterministic metrics are computed
  (filler-word rate, words per minute, immediate repetition), and a language model generates
  mode-aware coaching feedback plus a short auto-generated title for the recording. Feedback appears
  inline without a manual refresh; a failed run can be regenerated.
- **Three per-recording scores.** Every finished recording gets an **Impact**, **Clarity**, and
  **Structure** score (0–100), produced by the same feedback call. Impact and Structure are judged
  differently per mode; Clarity is one holistic judgment grounded by the filler/repetition/grammar
  signals.
- **Streaks and progress.** A Streaks tab shows your current and longest practice streak and, per
  score, a trend over Week / Month / Year / All Time with a line graph. Clarity also breaks out its
  supporting metrics (filler rate, repetition, grammar issues) over the selected window.
- **Searchable history.** Browse past sessions as a list or a month calendar (a dot on every day you
  recorded, tap to filter). Filter by title/prompt text, by mode, or to favorites only.
- **Re-practice mode.** Re-record your answer to a question you've already done; the attempts are
  grouped into a single History entry with an accordion so you can compare them.
- **Recording management.** Rename a recording's title, favorite it, download the audio via the
  native share sheet, delete just the audio (to free storage), or delete the whole recording.
- **Accounts.** Email/password sign-up and login, with a Settings screen for sign-out.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React Native + TypeScript (Expo), run via Expo Go; `expo-audio` for recording/playback, Expo Router for navigation |
| Auth | Supabase Auth (email/password) |
| Database | Supabase Postgres (recordings, transcripts, feedback, questions) |
| File storage | Supabase Storage (audio files, private bucket, per-user cap) |
| Backend API | Python + FastAPI on Render; background work runs in-process via FastAPI `BackgroundTasks` — no separate queue or worker |
| AI | Google Gemini API (Flash model) — audio transcription, feedback + title + score generation, and daily-question generation |

## Architecture

```
┌────────────────┐        ┌──────────────────┐        ┌───────────────┐
│  Expo app      │──auth──▶│  Supabase        │◀──────▶│  FastAPI       │
│  (React Native)│  data   │  Postgres +      │ service │  backend       │
│                │◀───────▶│  Storage + Auth  │  role   │  (Render)      │
└────────────────┘         └──────────────────┘        └───────┬───────┘
                                                              │
                                                       ┌──────▼──────┐
                                                       │  Gemini API  │
                                                       └─────────────┘
```

- The **Expo app** talks to Supabase directly for auth, reading recordings, uploading audio, and
  small writes (favorite, title). It talks to the **FastAPI backend** only for work that needs a
  secret API key or a multi-step operation that must not half-fail: starting/regenerating
  processing, deleting audio or a whole recording, and fetching the daily question.
- **Processing** is a background task inside the same FastAPI process: download the audio → Gemini
  for a transcript → compute metrics in code → Gemini again for feedback + title + scores → write
  the result back to the row. Each Gemini-calling stage retries once inline; each stage's result is
  saved as soon as it succeeds so a later failure can't lose earlier work.
- The **Streaks tab** and all of History's filtering/grouping are computed **client-side** over the
  recordings the app already fetched — there's no analytics endpoint.
- Row-Level Security scopes every client query to the signed-in user. The backend uses a
  service-role key (which bypasses RLS) and authorizes each request by verifying the caller's
  Supabase token.

## Running it locally

This isn't a zero-config clone-and-run — it needs your own Supabase project and a Gemini API key to
do anything useful. You'll need:

- **Node.js** 20+ and npm
- The **Expo Go** app on a physical iOS device (the project is pinned to a specific Expo SDK to
  match Expo Go; it's developed and tested on iOS)
- A **Supabase project** (free tier is fine)
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey) (free tier, no
  card required)
- **Python** 3.11+ for the backend

### 1. Database

Run the SQL files in [`supabase/migrations/`](supabase/migrations/) **in order** (`0001` →
`0010`) in your Supabase project's SQL editor. `0002` also creates the private `recordings-audio`
storage bucket and its policies. Email confirmation is on by default for new Supabase projects —
turn it off under **Authentication → Providers → Email** for solo testing.

### 2. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env                                # then fill in the values
uvicorn app.main:app --reload --host 0.0.0.0
```

`backend/.env` needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `GEMINI_API_KEY` — see the
comments in [`backend/.env.example`](backend/.env.example) for exactly where each comes from. The
service-role key and Gemini key are secrets and must never reach the app.

Check it's up: `curl http://localhost:8000/health` → `{"status": "ok"}`. Run the backend tests with
`pytest` from `backend/`.

### 3. Frontend

```bash
cp .env.example .env                                # then fill in the values
npm install
npm start
```

The root `.env` needs `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and
`EXPO_PUBLIC_API_URL`. For a physical phone, `EXPO_PUBLIC_API_URL` must be your computer's LAN IP
(e.g. `http://192.168.1.23:8000`), not `localhost` — see the comments in
[`.env.example`](.env.example). Scan the QR code from `npm start` with Expo Go.

The frontend logic tests run without a test runner: `npm run test:streaks` and `npm run test:chains`.
Type-check with `npx tsc --noEmit`.

## Project structure

```
src/
  app/                 Expo Router screens (file-based routing)
    (tabs)/            Record, History, Streaks — plus their detail routes
    login.tsx, signup.tsx, settings.tsx
  components/          Shared UI (cards, menus, graphs, audio controls)
  lib/                 Supabase client, API calls, and pure logic
                       (streaks aggregation, re-practice chain grouping)
  constants/theme.ts   The design system (palette, typography, spacing)
  hooks/               Small shared hooks

backend/
  app/
    routers/           HTTP endpoints (recordings, questions, health)
    services/          Background-work logic — processing pipeline,
                       metrics, feedback generation, daily questions
  tests/               pytest suite for the pure logic

supabase/migrations/   Versioned SQL — the schema source of truth
```

## Notes

A few things a technical reader might find interesting:

- **Zero infrastructure cost by design.** Supabase, Render, Gemini, and Expo Go are all used on
  their free tiers. There's no task queue or worker process — background processing runs in the web
  process via FastAPI `BackgroundTasks`, because Render has no free background-worker tier.
- **Client-side aggregation.** Streaks trends, calendar dots, search, and re-practice grouping are
  all derived on the device from the one recordings query the app already runs. The per-user
  recording count is small enough that this stays simpler and cheaper than adding endpoints.
- **The daily question is global and lazily assigned.** The first request for a given mode on a
  given day picks and stores that day's question; a question is retired the instant it's assigned,
  which is a structural guarantee it never repeats — and means no per-user "recently seen" tracking
  is needed anywhere. Pool exhaustion triggers a synchronous batch of new AI-generated questions.
- **Deterministic metrics feed the LLM, not the other way around.** Filler rate, WPM, and
  repetition are computed in plain code from the transcript and passed into the feedback prompt as
  grounding, so they're correct regardless of the model.
- **Pure logic is isolated and unit-tested.** `src/lib/streaks.ts`, `src/lib/re-practice-chains.ts`,
  and the backend `services/` modules have no framework or network dependencies and are covered by
  tests that run without a device or live API.

## License

This project is not currently licensed for reuse. The source is public for reference, but all
rights are reserved — please don't copy, redistribute, or build on it without permission.
