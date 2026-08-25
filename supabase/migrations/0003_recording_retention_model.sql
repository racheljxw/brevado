-- Brevado — replace time-based retention with a manual, cap-based model
-- (see docs/PROJECT_PLAN.md Section 3 "Audio retention" and
-- docs/CLAUDE.md "Background processing" for the reasoning: no Celery/Redis
-- worker, so no scheduled retention job either).
--
-- This is a new migration rather than an edit to 0001_initial_schema.sql
-- because 0001 is already applied to the live Supabase project, and
-- docs/CLAUDE.md's own convention is "add new schema changes as a new
-- numbered migration file rather than editing an applied one" — editing
-- 0001 in place wouldn't change anything already applied, and would make
-- the migrations directory no longer match the live database's actual
-- history.

-- `saved` meant "exempt from the old 7-day auto-delete". `favorite` is a
-- plain personal star marker with no deletion behavior attached. Renaming
-- (rather than dropping + adding) keeps existing values: recordings a user
-- had previously starred "saved" show up already favorited.
alter table public.recordings rename column saved to favorite;

-- Existed only to compute the old 7-day retention window; no longer needed
-- now that retention is a manual per-user cap (MAX_RECORDINGS_PER_USER),
-- not a rolling deadline from report generation time.
alter table public.recordings drop column report_generated_at;

-- audio_deleted is unchanged — still the flag manual delete sets, and still
-- what the (future) MAX_RECORDINGS_PER_USER cap check counts against.
