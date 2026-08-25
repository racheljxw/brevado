"""
Service-role Supabase client, shared by anything in this backend that needs
to read/write `recordings` rows or Storage objects on behalf of any user.

This backend process is trusted (it never runs inside a user's device), so
it authenticates to Supabase with the SERVICE ROLE key rather than the anon
key the Expo app uses. The service role key bypasses Row Level Security
entirely — that's exactly what's needed here (e.g. writing to a recording
row that belongs to whichever user triggered processing), but it also means
this key must never reach the Expo app or any other client-side code. See
`app/config.py` and `.env.example` for where it's configured, and
docs/CLAUDE.md's "AI processing endpoint" section for the full story.

The client is created once (module import time) and reused — supabase-py's
Client is safe to share across requests within a single process, and
BackgroundTasks run in the same process/event loop, so the same instance
works for both request handlers and background work.
"""

from supabase import Client, create_client

from app.config import settings


def _build_client() -> Client:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see backend/.env.example) "
            "before any endpoint that talks to Supabase can be used."
        )
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


# Lazily built on first use rather than at import time, so importing this
# module (e.g. from a test, or from routers that don't need it yet) doesn't
# blow up just because .env isn't fully filled in.
_client: Client | None = None


def get_service_client() -> Client:
    global _client
    if _client is None:
        _client = _build_client()
    return _client
