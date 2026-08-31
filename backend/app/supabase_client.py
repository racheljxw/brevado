"""
Service-role Supabase client, shared by anything in this backend that needs
to read/write `recordings` rows or Storage objects on behalf of any user.

This backend is trusted server-side code, so it authenticates with the
SERVICE ROLE key, which bypasses Row Level Security entirely — required for
writing to whichever user's row triggered processing, but it also means this
key must never reach the Expo app or any client-side code.

Built lazily on first use (not at import time) so importing this module
without a fully-populated .env — e.g. from a test — doesn't raise.
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


_client: Client | None = None


def get_service_client() -> Client:
    global _client
    if _client is None:
        _client = _build_client()
    return _client
