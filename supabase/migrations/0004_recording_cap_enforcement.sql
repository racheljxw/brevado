-- Brevado — Phase 3 Step 3: enforce the per-user recording cap
-- (MAX_RECORDINGS_PER_USER, see docs/PROJECT_PLAN.md Section 3 "Audio
-- retention" and docs/CLAUDE.md's Audio retention / cap section) as a
-- database-level safety net.
--
-- Why a trigger and not backend application code: as of this migration,
-- `recordings` rows are still created entirely on the frontend, direct
-- against Supabase (`uploadRecording` in src/lib/recordings.ts) — there is
-- no backend endpoint in the insert path to put a check in (see
-- docs/CLAUDE.md's "Upload" section). The frontend already checks the cap
-- before a recording even starts (src/app/(tabs)/index.tsx) as the primary,
-- user-facing gate — this trigger is the belt-and-suspenders backstop that
-- holds regardless of which client is doing the inserting, closing the race
-- the frontend check alone can't (e.g. two inserts firing back-to-back, or
-- any future/alternate client hitting the table directly with a valid
-- Supabase session).
--
-- The cap number is hardcoded below rather than read from anywhere, since
-- Postgres has no way to read Python's MAX_RECORDINGS_PER_USER
-- (backend/app/config.py) or its frontend mirror (src/lib/recordings.ts).
-- This is now a third copy of the same number — same accepted tradeoff as
-- RECORDINGS_BUCKET already being duplicated between config.py and
-- recordings.ts. If MAX_RECORDINGS_PER_USER ever changes, update it in all
-- three places: this constant, backend/app/config.py, and
-- src/lib/recordings.ts.

create or replace function public.enforce_recording_cap()
returns trigger as $$
declare
  max_recordings constant integer := 30; -- keep in sync — see comment above
  active_count integer;
begin
  -- Deliberately no `security definer` here: this runs as the inserting
  -- role, so with RLS's existing "Users can view their own recordings"
  -- policy (user_id = auth.uid()), this select is already scoped to the
  -- same user the insert is for — exactly the count we want, with no need
  -- to bypass RLS to get it.
  select count(*) into active_count
  from public.recordings
  where user_id = new.user_id
    and audio_deleted = false;

  if active_count >= max_recordings then
    raise exception
      'You have reached your % recording limit. Delete some audio from History to record more.',
      max_recordings
      using errcode = '23514'; -- check_violation, so this reads as a constraint failure, not a generic server error
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists recordings_enforce_cap on public.recordings;

create trigger recordings_enforce_cap
  before insert on public.recordings
  for each row
  execute function public.enforce_recording_cap();
