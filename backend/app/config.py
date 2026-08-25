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
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8000

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    gemini_api_key: str = ""


settings = Settings()

# Per-user audio retention cap: how many recordings a user may have with
# audio_deleted = false at once. Not an env var — it's an app constant, not
# meant to vary by deployment. Unused as of this pass; the enforcement
# logic (checked when a user starts a new recording, per
# docs/PROJECT_PLAN.md Section 5 "Audio cap check") lands in a later step.
MAX_RECORDINGS_PER_USER = 30

# Supabase Storage bucket recordings' audio lives in. Mirrors
# RECORDINGS_BUCKET in src/lib/recordings.ts on the frontend — kept as a
# separate constant here rather than shared, since this is a separate
# Python project (see docs/CLAUDE.md's "Backend" section). Not an env var
# for the same reason as MAX_RECORDINGS_PER_USER above: an app constant,
# not something that varies by deployment.
RECORDINGS_BUCKET = "recordings-audio"
