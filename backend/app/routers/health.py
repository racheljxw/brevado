from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health_check() -> dict[str, str]:
    """Liveness check — confirms the API process is up and responding.

    This is the way to confirm the deploy is alive; it doesn't check any
    downstream dependency (Supabase, Gemini) since none of those are wired
    up yet as of Step 1.
    """
    return {"status": "ok"}
