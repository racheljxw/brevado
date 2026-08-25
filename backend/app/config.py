"""
App configuration, read from environment variables (via .env locally, and
Render's dashboard env vars in production).

`supabase_url` / `supabase_service_role_key` are read by
`app/supabase_client.py`, which every endpoint or background task that
touches Supabase goes through — see docs/CLAUDE.md's "AI processing
endpoint" section for why the service role key specifically (not anon) is
used here.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8000

    supabase_url: str = ""
    supabase_service_role_key: str = ""


settings = Settings()

# Per-user audio retention cap: how many recordings a user may have with
# audio_deleted = false at once. Not an env var — it's an app constant, not
# meant to vary by deployment. Unused as of this pass; the enforcement
# logic (checked when a user starts a new recording, per
# docs/PROJECT_PLAN.md Section 5 "Audio cap check") lands in a later step.
MAX_RECORDINGS_PER_USER = 30
