"""
App configuration, read from environment variables (via .env locally, and
Render's dashboard env vars in production).

`supabase_url` / `supabase_service_role_key` are read by
`app/supabase_client.py`, which every endpoint or background task that
touches Supabase goes through — see docs/CLAUDE.md's "AI processing
endpoint" section for why the service role key specifically (not anon) is
used here.

`gemini_api_key` is read by `app/gemini_client.py` (Phase 2 Step 3) — see
that module and docs/CLAUDE.md's "AI processing endpoint" section for where
it's used and where to get one.

`gemini_model` is the model id used for both the transcription call
(`app/services/processing.py`) and the feedback generation call
(`app/services/feedback.py`) — one model id for the whole pipeline. Kept
as a setting rather than a hardcoded string because Google
retires/renames Gemini model ids over time — "gemini-2.5-flash" was already
rejected with a 404 telling callers to switch to "gemini-3.6-flash" during
Step 3 testing (2026-08-25), see docs/CLAUDE.md's "AI processing endpoint"
section. When that happens again, bump the default here (or set
GEMINI_MODEL in .env/Render to override without a code change at all).
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8000

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"


settings = Settings()

# Per-user audio retention cap: how many recordings a user may have with
# audio_deleted = false at once. Not an env var — it's an app constant, not
# meant to vary by deployment.
#
# As of Phase 3 Step 3 this is enforced, but not from this backend process:
# there's no backend endpoint in the recording-creation path to check it in
# (upload + row creation are still frontend-to-Supabase directly, see
# docs/CLAUDE.md's "Upload" section), so enforcement lives in two other
# places instead — the frontend's pre-recording check
# (src/app/(tabs)/index.tsx, mirrored as MAX_RECORDINGS_PER_USER in
# src/lib/recordings.ts) and a Postgres trigger as the belt-and-suspenders
# backstop (supabase/migrations/0004_recording_cap_enforcement.sql). This
# Python constant isn't read by either of those — Postgres can't read a
# Python value, and the frontend is a separate project — so it exists here
# only as documentation of the value and a reference point for this
# backend's future/other own uses of the cap (e.g. if it ever gains a
# recording-status or admin endpoint). If MAX_RECORDINGS_PER_USER changes,
# update it in all three places: here, the frontend copy, and the trigger's
# hardcoded `max_recordings` in the migration.
MAX_RECORDINGS_PER_USER = 30

# Supabase Storage bucket recordings' audio lives in. Mirrors
# RECORDINGS_BUCKET in src/lib/recordings.ts on the frontend — kept as a
# separate constant here rather than shared, since this is a separate
# Python project (see docs/CLAUDE.md's "Backend" section). Not an env var
# for the same reason as MAX_RECORDINGS_PER_USER above: an app constant,
# not something that varies by deployment.
RECORDINGS_BUCKET = "recordings-audio"
