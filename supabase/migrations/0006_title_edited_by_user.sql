-- Brevado — v2 Epic D Part 7: track whether a recording's title was
-- hand-edited by the user, so the processing pipeline stops clobbering it.
--
-- Bug (flagged in the Epic D wrap-up, docs/CLAUDE.md's "Recording titles"
-- section): `process_recording` (backend/app/services/processing.py) always
-- overwrote `title` with whatever the feedback call generated, on every run
-- — including a "Regenerate report" run triggered *after* a user had
-- manually retitled the recording via the Part 2 editor. That silently threw
-- away a hand-set title the moment someone regenerated a failed or
-- unsatisfying report.
--
-- Fix: a new boolean, defaulting false (so every existing row and every
-- freshly-inserted row starts as "not edited", i.e. still eligible for
-- AI-generated titles same as before). `updateRecordingTitle`
-- (src/lib/recordings.ts) — the ONLY place a title is ever hand-set — flips
-- it to true in the same update as the title itself. `process_recording`
-- reads it alongside `mode`/`question` at the top of the run and, when true,
-- omits `title` from its final `status: done` update entirely, leaving
-- whatever the user set untouched. Feedback/transcript/metrics still refresh
-- normally regardless of this flag — only the title-overwrite is skipped.
--
-- A new migration rather than editing 0005, per docs/CLAUDE.md's convention
-- ("add new schema changes as a new numbered migration file rather than
-- editing an applied one") — 0005 is already applied to the live project.

alter table public.recordings
  add column title_edited_by_user boolean not null default false;
