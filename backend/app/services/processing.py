"""
Background processing for a recording.

*** Phase 2 Step 5: the full pipeline is now real — no stubs remain. ***
`process_recording` downloads the recording's audio from Supabase Storage
once, sends it to Gemini (native audio input) for a real transcript, then
computes deterministic metrics (filler-word rate, words per minute,
repetition — see `app/services/metrics.py`) from that transcript and the
same audio bytes, then sends the transcript, metrics, mode, and question to
Gemini again for real mode-aware feedback (see `app/services/feedback.py`)
— no second download involved anywhere in this. Each stage's result is
written to the row as soon as it succeeds (transcript, then metrics), so a
later stage failing can never lose earlier, already-successful work.
Remaining TODO work:
  - Step 6: the one-inline-retry failure policy described in
    docs/PROJECT_PLAN.md Section 5 ("On failure it retries once inline") —
    today any stage's failure marks the recording `failed` on the first
    error, no retry yet.

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
from app.services.feedback import FeedbackGenerationError, generate_feedback
from app.services.metrics import compute_metrics
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
    metrics/feedback generation and a `done` status.
    """


def _mime_type_for(audio_path: str) -> str:
    extension = audio_path.rsplit(".", 1)[-1].lower() if "." in audio_path else ""
    return _GEMINI_MIME_TYPES.get(extension, "audio/mp4")


def _download_audio(audio_path: str) -> bytes:
    """Downloads `audio_path` from Storage. Raises `TranscriptionError` on failure.

    Kept separate from `_transcribe` so `process_recording` can download once and reuse
    the same bytes for both the Gemini call and metrics' `get_audio_duration_seconds`
    (see `app/services/metrics.py`) — no second Storage round-trip for metrics.
    """
    supabase = get_service_client()

    logger.info("processing: downloading audio for transcription: %s", audio_path)
    try:
        audio_bytes = supabase.storage.from_(RECORDINGS_BUCKET).download(audio_path)
    except Exception as exc:
        raise TranscriptionError(f"Failed to download '{audio_path}' from Storage: {exc}") from exc

    if not audio_bytes:
        raise TranscriptionError(f"Downloaded audio file was empty: {audio_path}")

    return audio_bytes


def _transcribe(audio_bytes: bytes, mime_type: str) -> str:
    """Sends already-downloaded audio bytes to Gemini for transcription.

    Raises `TranscriptionError` on any failure — never returns an empty or
    placeholder transcript.
    """
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
        logger.error("processing: Gemini transcription call failed: %s", exc)
        raise TranscriptionError(f"Gemini API error: {exc}") from exc
    except Exception as exc:
        logger.error("processing: unexpected error calling Gemini: %s", exc)
        raise TranscriptionError(f"Unexpected error calling Gemini: {exc}") from exc

    transcript = (response.text or "").strip()
    if not transcript or transcript == "[no speech detected]":
        logger.error("processing: Gemini returned no usable transcript (got: %r)", transcript)
        raise TranscriptionError(f"Gemini returned no usable transcript (got: {transcript!r}).")

    logger.info("processing: transcription succeeded (%d characters)", len(transcript))
    return transcript


def process_recording(recording_id: str) -> None:
    client = get_service_client()

    try:
        client.table("recordings").update({"status": "processing"}).eq("id", recording_id).execute()

        result = (
            client.table("recordings")
            .select("audio_path, mode, question")
            .eq("id", recording_id)
            .maybe_single()
            .execute()
        )
        row = None if result is None else result.data
        audio_path = row.get("audio_path") if row else None
        if not audio_path:
            raise TranscriptionError(f"Recording {recording_id} has no audio_path to transcribe.")
        mode = row.get("mode") if row else None
        question = row.get("question") if row else None

        mime_type = _mime_type_for(audio_path)
        audio_bytes = _download_audio(audio_path)
        transcript = _transcribe(audio_bytes, mime_type)

        # Store the transcript immediately, before touching metrics — a metrics bug
        # below must never be able to lose an already-successful transcript (see
        # module docstring and docs/CLAUDE.md's "Metrics" section).
        client.table("recordings").update({"transcript": transcript}).eq("id", recording_id).execute()

        metrics = None
        try:
            metrics = compute_metrics(transcript, audio_bytes, mime_type)
        except Exception as exc:
            # Deliberately lenient, not the stricter "fail the recording" option: a
            # good transcript is the expensive/valuable part (real Gemini call,
            # user's actual speech) and metrics are a derived nice-to-have for the
            # feedback prompt below — losing metrics is a much smaller loss than
            # losing a transcript over what's likely a duration-parsing edge case.
            # `metrics` stays None here; `compute_metrics` itself already isolates
            # the one field (words_per_minute) that can legitimately fail on its
            # own, so reaching this branch means something more unexpected broke.
            logger.error("processing: metrics computation failed for recording %s: %s", recording_id, exc)

        # Store metrics immediately too, before attempting feedback generation —
        # mirrors the transcript store above, so a feedback-generation failure below
        # can never lose metrics that already succeeded (see
        # docs/CLAUDE.md's "AI processing endpoint" section).
        client.table("recordings").update({"metrics": metrics}).eq("id", recording_id).execute()

        feedback = generate_feedback(transcript=transcript, metrics=metrics, mode=mode, question=question)

        client.table("recordings").update(
            {
                "status": "done",
                "feedback": feedback,
            }
        ).eq("id", recording_id).execute()
    except TranscriptionError as exc:
        # Transcription-specific failure: logged distinctly from an unexpected/
        # infrastructure error below, but handled the same way either way — mark
        # `failed` and stop before metrics/feedback are ever attempted.
        logger.error("processing: recording %s failed to transcribe: %s", recording_id, exc)
        client.table("recordings").update({"status": "failed"}).eq("id", recording_id).execute()
    except FeedbackGenerationError as exc:
        # Feedback-specific failure: the transcript and metrics steps above already
        # wrote their results to the row before this ran, so this branch only ever
        # touches `status` — the good partial work (transcript, metrics) is never
        # lost or overwritten, matching the same principle as the transcription
        # failure branch above. See docs/CLAUDE.md's "AI processing endpoint" section.
        logger.error("processing: recording %s failed to generate feedback: %s", recording_id, exc)
        client.table("recordings").update({"status": "failed"}).eq("id", recording_id).execute()
    except Exception as exc:
        # Not the real retry policy (see module docstring, Step 6) — just prevents an
        # unexpected failure (e.g. a Supabase error) from leaving a row stuck at
        # "processing" forever.
        logger.error("processing: recording %s failed unexpectedly: %s", recording_id, exc)
        client.table("recordings").update({"status": "failed"}).eq("id", recording_id).execute()
