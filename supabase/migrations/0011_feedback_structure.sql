-- Splits generated feedback from one free-text block into a short overview plus
-- separate "what went well" / "areas to improve" point lists.
--
-- The existing `feedback` column is kept and repurposed as the 1-2 sentence
-- summary. `feedback_strengths` / `feedback_improvements` hold JSON arrays of
-- prose points. Both are nullable with no default and there is no backfill:
-- recordings generated before this change keep their full prose in `feedback`
-- and both new columns NULL, which is the signal the detail screen uses to fall
-- back to rendering that prose as a single block.
--
-- A missing/malformed list from a generation run also stays NULL without failing
-- the recording, matching the lenient degradation already used for `title` and
-- the scores.
--
-- New numbered migration rather than an edit to an applied one, per the project
-- convention. Run manually in the Supabase SQL editor like the others.

alter table public.recordings add column feedback_strengths jsonb;
alter table public.recordings add column feedback_improvements jsonb;
