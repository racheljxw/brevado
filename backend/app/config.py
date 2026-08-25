"""
App configuration, read from environment variables (via .env locally, and
Render's dashboard env vars in production).

Only PORT is actually used by this Step 1 skeleton. The Supabase fields are
placeholders reserved for Step 2+ (the processing pipeline needs the
service-role key to read/write `recordings` rows and Storage objects,
bypassing RLS) — they're declared now so the shape doesn't need to change
later, but nothing reads them yet.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8000

    # Placeholders — unused until Step 2 wires up the processing pipeline.
    supabase_url: str = ""
    supabase_service_role_key: str = ""


settings = Settings()

# Per-user audio retention cap: how many recordings a user may have with
# audio_deleted = false at once. Not an env var — it's an app constant, not
# meant to vary by deployment. Unused as of this pass; the enforcement
# logic (checked when a user starts a new recording, per
# docs/PROJECT_PLAN.md Section 5 "Audio cap check") lands in a later step.
MAX_RECORDINGS_PER_USER = 30
