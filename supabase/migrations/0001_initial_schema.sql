-- Brevado — initial schema
-- Recordings (v1) + a reserved stub for the question pool (wired up in Phase 4).

-- Supabase projects ship with pgcrypto enabled already; this is just belt-and-suspenders
-- so gen_random_uuid() below is guaranteed to resolve.
create extension if not exists pgcrypto;

-- ============================================================================
-- recordings
-- ============================================================================

create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  mode text not null check (mode in ('interview', 'story', 'miscellaneous')),
  -- The chosen/curated question, or a custom typed-in topic. Null for miscellaneous
  -- (free-topic, labeled by date only).
  question text,

  -- Storage path within the recordings-audio bucket (see 0002). Null until the
  -- client finishes uploading.
  audio_path text,

  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),

  transcript text,
  feedback text,
  -- Deterministic metrics computed in Phase 2: filler-word rate, words per minute,
  -- repetition, etc. Shape isn't finalized yet, hence jsonb rather than columns.
  metrics jsonb,

  saved boolean not null default false,
  audio_deleted boolean not null default false,
  -- Set when a report first successfully generates; the 7-day retention job
  -- (Phase 3) measures from this timestamp, not created_at.
  report_generated_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists recordings_user_id_created_at_idx
  on public.recordings (user_id, created_at desc);

alter table public.recordings enable row level security;

create policy "Users can view their own recordings"
  on public.recordings for select
  using (user_id = auth.uid());

create policy "Users can insert their own recordings"
  on public.recordings for insert
  with check (user_id = auth.uid());

create policy "Users can update their own recordings"
  on public.recordings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No delete policy: nothing in the app deletes a recording row today (the retention
-- job only clears audio_path/sets audio_deleted, it keeps the row). Add one deliberately
-- later if a "delete this session" feature shows up.

-- ============================================================================
-- questions (stub — Phase 4 hardcoded pool; Phase 5 dynamic pool + re-practice)
-- ============================================================================

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('interview', 'story', 'miscellaneous')),
  prompt_text text not null,
  created_at timestamptz not null default now()
);

alter table public.questions enable row level security;

-- No user-specific data here — open read for any authenticated or anonymous client.
-- No insert/update/delete policies: writes go through the service role key only
-- (seed data now, the weekly generation job in Phase 5 later), which bypasses RLS.
create policy "Anyone can read questions"
  on public.questions for select
  using (true);
