"""
Bearer-token verification for endpoints the Expo app calls directly.

The app sends the signed-in user's Supabase access token as
`Authorization: Bearer <token>` (the same JWT `supabase-js` already holds in
its session — see `src/lib/auth-context.tsx` on the frontend side). Rather
than validating that JWT's signature locally (which would mean handling the
project's JWT secret in this backend too), we hand the token back to
Supabase's own Auth API via `auth.get_user(token)` — it verifies the token
and returns the user it belongs to, or raises if it's invalid/expired. This
call goes out over `get_service_client()`, but only to reuse the client the
rest of the app already has around; the service role key isn't what's being
checked here, the caller's own token is.
"""

from fastapi import Header, HTTPException
from supabase_auth.errors import AuthError

from app.supabase_client import get_service_client


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
    return token


def get_current_user_id(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency: verifies the bearer token and returns the caller's user id.

    Raises 401 if the header is missing/malformed or Supabase rejects the token
    (expired, revoked, or simply invalid).
    """
    token = _extract_bearer_token(authorization)

    try:
        response = get_service_client().auth.get_user(token)
    except AuthError:
        raise HTTPException(status_code=401, detail="Invalid or expired access token.")

    if response is None or response.user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired access token.")

    return response.user.id
