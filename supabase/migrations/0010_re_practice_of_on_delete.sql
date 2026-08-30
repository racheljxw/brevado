-- Brevado — v4 Epic H Step 2: safe delete behaviour for recordings.re_practice_of.
--
-- Run manually in the Supabase SQL editor, after 0008 (which adds the
-- re_practice_of column this alters) and 0009.
--
-- 0008_daily_questions.sql added `recordings.re_practice_of uuid references
-- public.recordings (id)` with NO `on delete` action. Nothing populates that
-- column yet (re-practice mode is Epic I), but once it does, the existing
-- `DELETE /recordings/{id}` endpoint would FK-violate whenever a user deletes a
-- recording that has re-practice children pointing at it.
--
-- Desired behaviour: deleting a recording must never cascade-delete its
-- re-practice attempts, and must never be blocked by their existence — the
-- attempt(s) simply lose the link (`re_practice_of` -> NULL) and become
-- standalone recordings. That's `on delete set null`.
--
-- The FK's name is whatever Postgres auto-generated on the `alter table ... add
-- column ... references ...` in 0008 (the convention is
-- `recordings_re_practice_of_fkey`, but this block looks it up rather than
-- assuming). To eyeball it first:
--
--   select conname
--   from pg_constraint
--   where conrelid = 'public.recordings'::regclass
--     and contype  = 'f'
--     and confrelid = 'public.recordings'::regclass
--     and conkey = array[(
--       select attnum from pg_attribute
--       where attrelid = 'public.recordings'::regclass and attname = 're_practice_of'
--     )];

do $$
declare
  fk_name text;
begin
  select conname
    into fk_name
  from pg_constraint
  where conrelid  = 'public.recordings'::regclass
    and contype   = 'f'
    and confrelid = 'public.recordings'::regclass
    and conkey = array[(
      select attnum from pg_attribute
      where attrelid = 'public.recordings'::regclass and attname = 're_practice_of'
    )];

  if fk_name is null then
    raise exception 'Could not find the re_practice_of foreign key on public.recordings';
  end if;

  execute format('alter table public.recordings drop constraint %I', fk_name);
end $$;

alter table public.recordings
  add constraint recordings_re_practice_of_fkey
  foreign key (re_practice_of)
  references public.recordings (id)
  on delete set null;
