"""
App configuration, read from environment variables (via .env locally, and
Render's dashboard env vars in production).

`gemini_model` is the model id used for both the transcription call
(`app/services/processing.py`) and the feedback generation call
(`app/services/feedback.py`). It's a setting rather than a hardcoded string
because Google retires and renames Gemini model ids over time (this project
has already had one such rename forced on it) — when it happens again, bump
the default here or set GEMINI_MODEL in .env/Render, no code change needed.
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
# audio_deleted = false at once. The backend isn't in the recording-creation
# path (upload + row insert happen frontend-to-Supabase directly), so this
# value is actually enforced elsewhere — a frontend pre-check and a Postgres
# trigger backstop (supabase/migrations/0004_recording_cap_enforcement.sql).
# This copy exists for any future backend use of the cap. If it changes,
# update all three: here, src/lib/recordings.ts, and the migration's
# hardcoded `max_recordings`.
MAX_RECORDINGS_PER_USER = 30

# Supabase Storage bucket the recordings' audio lives in. Duplicated as
# RECORDINGS_BUCKET in src/lib/recordings.ts — the frontend is a separate
# project and can't import this.
RECORDINGS_BUCKET = "recordings-audio"
