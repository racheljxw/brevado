from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health_check() -> dict[str, str]:
    """Liveness check — confirms the API process is up and responding.

    Deliberately does not touch any downstream dependency (Supabase, Gemini);
    it's a pure "is this process alive" probe.
    """
    return {"status": "ok"}
