-- Brevado — v4 Epic H Step 1: the global daily-question system (schema).
--
-- A new migration rather than an edit to an applied one, per docs/CLAUDE.md's
-- convention — 0001–0007 are already applied to the live Supabase project. Run
-- this SQL manually in the Supabase dashboard's SQL editor, then run
-- 0009_seed_question_pool.sql right after it.
--
-- v4 replaces v1's per-user random-pick pool (src/lib/questions.ts +
-- pickQuestionForMode) with ONE shared "question of the day" per mode
-- (interview / story), assigned lazily on first access and stored so every
-- later request that day reads it. A pool question is retired the instant it's
-- assigned (questions.used_date), which structurally guarantees no repeats with
-- zero per-user tracking. See docs/CLAUDE.md's "v4 scope" and "Daily questions"
-- sections and docs/PROJECT_PLAN.md Section 5.
--
-- This migration is schema only. The seed data (the 25 + 25 starting questions,
-- read from src/lib/questions.ts) is in 0009_seed_question_pool.sql. The
-- assignment logic and its endpoint are backend/app/services/daily_questions.py
-- and backend/app/routers/questions.py. NOTHING on the frontend uses any of
-- this yet — that's Epic H Step 2.

-- ============================================================================
-- questions.used_date — retirement marker
-- ============================================================================

-- NULL  = unused, available to be assigned as a future daily question.
-- a date = the day this question was assigned as the daily question for its
--          mode, which retires it permanently (never assigned again, for anyone).
alter table public.questions add column used_date date;

-- The candidate lookup ("a random unused question for this mode") is the one
-- hot query against this table; a partial index keeps it cheap as the pool
-- grows over time.
create index if not exists questions_mode_unused_idx
  on public.questions (mode)
  where used_date is null;

-- ============================================================================
-- daily_questions — one assigned question per mode per day
-- ============================================================================

create table if not exists public.daily_questions (
  date date not null,
  mode text not null check (mode in ('interview', 'story')),
  question_id uuid not null references public.questions (id),
  -- The primary key IS the concurrency guard: first-of-the-day assignment does
  -- `insert ... on conflict (date, mode) do nothing returning question_id`, so
  -- two near-simultaneous requests can both pick a candidate but only one
  -- insert wins — see get_or_assign_daily_question in
  -- backend/app/services/daily_questions.py.
  primary key (date, mode)
);

alter table public.daily_questions enable row level security;

-- No user-specific data — open read for any client, same as `questions`. All
-- writes go through the service-role key (the backend assignment logic), which
-- bypasses RLS, so no insert/update/delete policy is defined.
create policy "Anyone can read daily questions"
  on public.daily_questions for select
  using (true);

-- ============================================================================
-- recordings.question_id / recordings.re_practice_of
-- ============================================================================

-- Which pool question this recording answered. NULL for a custom typed-in
-- topic, for miscellaneous, and for every recording created before v4.
alter table public.recordings
  add column question_id uuid references public.questions (id);

-- Set when this recording is a re-practice of an earlier one. This self-FK is
-- the ONLY attempt-grouping mechanism History needs: because a freshly-assigned
-- pool question is retired on assignment, the only way two recordings share a
-- question is a deliberate re-practice, so the re_practice_of chain fully
-- groups the attempts. Populated in Epic H Step 2+; the column lands now.
alter table public.recordings
  add column re_practice_of uuid references public.recordings (id);

create index if not exists recordings_re_practice_of_idx
  on public.recordings (re_practice_of)
  where re_practice_of is not null;
