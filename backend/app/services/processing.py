"""
Background processing for a recording.

*** STUB — Phase 2 Step 2 only proves the plumbing works end-to-end. ***
`process_recording` here does NOT call Gemini and does NOT compute real
metrics. It just flips status pending -> processing -> done on a timer so
the upload -> process -> poll -> history-list path can be verified. Steps
3-6 replace the body of this function with:
  - Step 3: real Gemini transcription call
  - Step 4: deterministic metrics (filler words, WPM, repetition)
  - Step 5: real Gemini feedback generation call
  - Step 6: the one-inline-retry failure policy described in
    docs/PROJECT_PLAN.md Section 5 ("On failure it retries once inline")

This runs as a FastAPI `BackgroundTasks` callback, i.e. after the request
that scheduled it has already returned a response — there's no HTTP request
context here, which is why it uses the service-role client directly rather
than anything tied to the caller's bearer token.
"""

import time

from app.supabase_client import get_service_client


def process_recording(recording_id: str) -> None:
    client = get_service_client()

    try:
        client.table("recordings").update({"status": "processing"}).eq("id", recording_id).execute()

        # Stands in for the real Gemini transcription + feedback calls that
        # land in Steps 3-6. Long enough to be visibly watchable from the
        # History screen's poll, short enough not to be annoying to test.
        time.sleep(2)

        client.table("recordings").update(
            {
                "status": "done",
                "transcript": "STUB - Step 3 will replace this",
                "feedback": "STUB - Step 5 will replace this",
            }
        ).eq("id", recording_id).execute()
    except Exception:
        # Not the real retry policy (see docstring) — just prevents a stub
        # failure from leaving a row stuck at "processing" forever while
        # this step is being tested.
        client.table("recordings").update({"status": "failed"}).eq("id", recording_id).execute()
