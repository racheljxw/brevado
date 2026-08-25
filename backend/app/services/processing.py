"""
Background processing for a recording.

*** Phase 2 Step 3: real Gemini transcription. Feedback is still a stub. ***
`process_recording` now downloads the recording's audio from Supabase
Storage and sends it to Gemini (native audio input) for a real transcript.
Feedback generation is deliberately left as stub text — that's Step 5,
kept out of this step so transcription can be tested in isolation first
(see docs/CLAUDE.md's "AI processing endpoint" section). Deterministic
metrics (Step 4) also aren't computed yet. Remaining stub/TODO work:
  - Step 4: deterministic metrics (filler words, WPM, repetition)
  - Step 5: real Gemini feedback generation call
  - Step 6: the one-inline-retry failure policy described in
    docs/PROJECT_PLAN.md Section 5 ("On failure it retries once inline") —
    today a transcription failure marks the recording `failed` on the
    first error, no retry yet.

This runs as a FastAPI `BackgroundTasks` callback, i.e. after the request
that scheduled it has already returned a response — there's no HTTP request
context here, which is why it uses the service-role client directly rather
than anything tied to the caller's bearer token.
"""

import logging

from google.genai import types
from google.genai.errors import APIError

from app.config import RECORDINGS_BUCKET, settings
from app.gemini_client import get_gemini_client
from app.supabase_client import get_service_client

logger = logging.getLogger(__name__)

# Gemini's documented native audio MIME types (ai.google.dev/gemini-api/docs/audio)
# are audio/wav, audio/mp3, audio/aiff, audio/aac, audio/ogg, audio/flac — m4a isn't
# explicitly listed, but it's AAC audio in an MP4 container, and audio/mp4 is the
# IANA-registered MIME type for that container (Gemini accepts it in practice). m4a is
# also the realistic case: it's what expo-audio's HIGH_QUALITY preset actually produces
# on iOS, the only device this project tests on (see docs/CLAUDE.md's Conventions
# section). Other extensions here are best-effort/untested against Gemini.
_GEMINI_MIME_TYPES = {
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
    "wav": "audio/wav",
    "mp3": "audio/mp3",
    "aac": "audio/aac",
    "ogg": "audio/ogg",
    "flac": "audio/flac",
    "aiff": "audio/aiff",
}


class TranscriptionError(Exception):
    """Raised when transcribing a recording's audio fails or yields nothing usable.

    Covers: the audio failing to download, the Gemini call itself erroring, and a
    technically-successful Gemini response with no usable transcript text. Caught
    specifically in `process_recording` so a bad transcript can never fall through to
    getting a `done` status with stub feedback attached.
    """


def _mime_type_for(audio_path: str) -> str:
    extension = audio_path.rsplit(".", 1)[-1].lower() if "." in audio_path else ""
    return _GEMINI_MIME_TYPES.get(extension, "audio/mp4")


def _transcribe(audio_path: str) -> str:
    """Downloads `audio_path` from Storage and sends it to Gemini for transcription.

    Raises `TranscriptionError` on any failure — never returns an empty or
    placeholder transcript.
    """
    supabase = get_service_client()

    logger.info("processing: downloading audio for transcription: %s", audio_path)
    try:
        audio_bytes = supabase.storage.from_(RECORDINGS_BUCKET).download(audio_path)
    except Exception as exc:
        raise TranscriptionError(f"Failed to download '{audio_path}' from Storage: {exc}") from exc

    if not audio_bytes:
        raise TranscriptionError(f"Downloaded audio file was empty: {audio_path}")

    mime_type = _mime_type_for(audio_path)
    logger.info(
        "processing: sending %d bytes (%s) to Gemini model %s for transcription",
        len(audio_bytes),
        mime_type,
        settings.gemini_model,
    )

    try:
        response = get_gemini_client().models.generate_content(
            model=settings.gemini_model,
            contents=[
                "Transcribe this audio recording verbatim. Return only the spoken words as "
                "plain text — no extra commentary, labels, timestamps, or formatting. If the "
                "audio contains no discernible speech, return exactly: [no speech detected]",
                types.Part.from_bytes(data=audio_bytes, mime_type=mime_type),
            ],
        )
    except APIError as exc:
        logger.error("processing: Gemini transcription call failed for %s: %s", audio_path, exc)
        raise TranscriptionError(f"Gemini API error: {exc}") from exc
    except Exception as exc:
        logger.error("processing: unexpected error calling Gemini for %s: %s", audio_path, exc)
        raise TranscriptionError(f"Unexpected error calling Gemini: {exc}") from exc

    transcript = (response.text or "").strip()
    if not transcript or transcript == "[no speech detected]":
        logger.error("processing: Gemini returned no usable transcript for %s (got: %r)", audio_path, transcript)
        raise TranscriptionError(f"Gemini returned no usable transcript (got: {transcript!r}).")

    logger.info("processing: transcription succeeded for %s (%d characters)", audio_path, len(transcript))
    return transcript


def process_recording(recording_id: str) -> None:
    client = get_service_client()

    try:
        client.table("recordings").update({"status": "processing"}).eq("id", recording_id).execute()

        result = (
            client.table("recordings")
            .select("audio_path")
            .eq("id", recording_id)
            .maybe_single()
            .execute()
        )
        row = None if result is None else result.data
        audio_path = row.get("audio_path") if row else None
        if not audio_path:
            raise TranscriptionError(f"Recording {recording_id} has no audio_path to transcribe.")

        transcript = _transcribe(audio_path)

        # Feedback generation is still a stub (Step 5) and metrics aren't computed yet
        # (Step 4) — `status: done` here means "done for what Step 3 covers", not that
        # the full pipeline ran. See module docstring.
        client.table("recordings").update(
            {
                "status": "done",
                "transcript": transcript,
                "feedback": "STUB - Step 5 will replace this",
            }
        ).eq("id", recording_id).execute()
    except TranscriptionError as exc:
        # Transcription-specific failure: logged distinctly from an unexpected/
        # infrastructure error below, but handled the same way either way — mark
        # `failed` and stop, never write a `done` status with stub feedback attached.
        logger.error("processing: recording %s failed to transcribe: %s", recording_id, exc)
        client.table("recordings").update({"status": "failed"}).eq("id", recording_id).execute()
    except Exception as exc:
        # Not the real retry policy (see module docstring, Step 6) — just prevents an
        # unexpected failure (e.g. a Supabase error) from leaving a row stuck at
        # "processing" forever.
        logger.error("processing: recording %s failed unexpectedly: %s", recording_id, exc)
        client.table("recordings").update({"status": "failed"}).eq("id", recording_id).execute()
