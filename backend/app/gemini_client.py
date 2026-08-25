"""
Shared Gemini API client, lazily built from `GEMINI_API_KEY`.

Uses the official **`google-genai`** SDK (`pip install google-genai`, pinned
in `backend/requirements.txt`) — Google's current unified Gen AI SDK, not
the older `google-generativeai` package. `google-generativeai` is now
explicitly marked legacy/limited-maintenance upstream in favor of
`google-genai` (see https://github.com/googleapis/python-genai and the
migration guide at https://ai.google.dev/gemini-api/docs/migrate), so
`google-genai` is what any new Gemini work in this project should use.

Built once (module-level singleton) and reused, the same way
`app/supabase_client.py` builds one shared Supabase client — cheap to
construct, but no reason to rebuild it on every `BackgroundTasks` call.
"""

from google import genai

from app.config import settings

_client: genai.Client | None = None


def get_gemini_client() -> genai.Client:
    global _client
    if _client is None:
        if not settings.gemini_api_key:
            raise RuntimeError(
                "GEMINI_API_KEY must be set (see backend/.env.example — get a free key "
                "from Google AI Studio) before any Gemini call can be made."
            )
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client
