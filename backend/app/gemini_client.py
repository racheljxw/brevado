"""
Shared Gemini API client, lazily built from `GEMINI_API_KEY` and reused for
the life of the process.

Uses the `google-genai` SDK (Google's current unified Gen AI SDK), not the
legacy `google-generativeai` package. Migration guide:
https://ai.google.dev/gemini-api/docs/migrate
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
