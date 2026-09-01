"""
Background processing for a recording.

`process_recording` downloads the recording's audio from Supabase Storage
once, sends it to Gemini (native audio input) for a transcript, computes
deterministic metrics from that transcript and the same audio bytes (see
`app/services/metrics.py`), then sends the transcript, metrics, mode, and
question to Gemini again for a mode-aware feedback summary, its
strengths/improvements lists, a short recording title, and four scores —
`impact_score` / `clarity_score` / `structure_score` and
`grammar_issue_count` — all from one structured-JSON call (see
`app/services/feedback.py`).

Each stage's result is written to the row as soon as it succeeds (transcript,
then metrics), so a later stage failing can never lose earlier, successful
work. A missing title, an unusable strengths/improvements list, or an
unparseable score is stored as NULL and logged — never a reason to fail the
recording (only a bad transcript or an empty feedback summary is).

Hand-edited titles are never overwritten: if the row's `title_edited_by_user`
flag is set (only `updateRecordingTitle` in src/lib/recordings.ts sets it),
the final write omits `title` entirely so a fresh generation or a
"Regenerate report" leaves the user's title alone.

Retry policy: each of the two Gemini-calling stages (transcription and
feedback) gets exactly one immediate inline retry of *just that stage* on
`TranscriptionError`/`FeedbackGenerationError` before the recording is marked
`failed` — see `_run_with_one_retry`. Both attempts happen synchronously
within this same call, so a caller polling `status` never sees an
intermediate `failed` unless both attempts failed.

Runs as a FastAPI `BackgroundTasks` callback — no HTTP request context, which
is why it uses the service-role client directly rather than the caller's
bearer token.
"""

import logging
from typing import Callable, TypeVar

from google.genai import types
from google.genai.errors import APIError

from app.config import RECORDINGS_BUCKET, settings
from app.gemini_client import get_gemini_client
from app.services.feedback import FeedbackGenerationError, GeneratedFeedback, generate_feedback
from app.services.metrics import compute_metrics
from app.supabase_client import get_service_client

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Gemini's documented native audio MIME types (ai.google.dev/gemini-api/docs/audio)
# don't list m4a, but it's AAC in an MP4 container and Gemini accepts audio/mp4 in
# practice. m4a is the case that matters — it's what expo-audio's HIGH_QUALITY preset
# produces on iOS. The other extensions are best-effort and untested against Gemini.
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


def _run_with_one_retry(stage_name: str, recording_id: str, fn: Callable[[], T]) -> T:
    """Runs `fn()`, retrying it exactly once, immediately, if it raises
    `TranscriptionError` or `FeedbackGenerationError`. If the retry succeeds the
    caller never learns the first attempt failed (except via the logs) and `status`
    never moves to `failed`; if the retry also fails, the exception propagates and
    the caller marks the recording `failed`.

    Deliberately stage-level, not whole-pipeline: `fn` is just the Gemini-calling
    unit that can fail (transcription's download+transcribe, or one feedback call),
    not a re-run of the whole `process_recording` body. Retrying the whole pipeline
    would redo a successful transcription on a feedback-only failure, burning a
    second transcription call over audio already transcribed correctly. Because each
    stage's result is stored to the row as soon as it succeeds, a feedback retry can
    just reuse the transcript/metrics already in hand.

    A transcription retry does re-download the audio — a cheap Storage round-trip,
    not the Gemini call this policy exists to protect — so a first-attempt download
    failure is retried too, not only a Gemini-call failure.
    """
    try:
        return fn()
    except (TranscriptionError, FeedbackGenerationError) as exc:
        logger.warning(
            "processing: recording %s: %s failed on first attempt (%s) — retrying once immediately",
            recording_id,
            stage_name,
            exc,
        )
        try:
            return fn()
        except (TranscriptionError, FeedbackGenerationError) as retry_exc:
            logger.error(
                "processing: recording %s: %s failed again on retry (%s) — giving up, marking failed",
                recording_id,
                stage_name,
                retry_exc,
            )
            raise


def process_recording(recording_id: str) -> None:
    client = get_service_client()

    try:
        client.table("recordings").update({"status": "processing"}).eq("id", recording_id).execute()

        result = (
            client.table("recordings")
            .select("audio_path, mode, question, title_edited_by_user")
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
        # If the user has hand-edited this recording's title, the final write
        # below must not overwrite it with a freshly-generated one. Read here so
        # that write can honour it without a second round-trip.
        title_edited_by_user = bool(row.get("title_edited_by_user")) if row else False

        mime_type = _mime_type_for(audio_path)

        def _do_transcription() -> tuple[bytes, str]:
            audio_bytes = _download_audio(audio_path)
            transcript = _transcribe(audio_bytes, mime_type)
            return audio_bytes, transcript

        audio_bytes, transcript = _run_with_one_retry("transcription", recording_id, _do_transcription)

        # Store the transcript before touching metrics — a metrics failure below
        # must never be able to lose an already-successful transcript.
        client.table("recordings").update({"transcript": transcript}).eq("id", recording_id).execute()

        metrics = None
        try:
            metrics = compute_metrics(transcript, audio_bytes, mime_type)
        except Exception as exc:
            # Lenient, not "fail the recording": the transcript is the expensive
            # part and metrics are just grounding for the feedback prompt.
            # `compute_metrics` already isolates the one field that can fail on its
            # own (words_per_minute), so reaching here means something unexpected
            # broke — still not worth discarding a good transcript over.
            logger.error("processing: metrics computation failed for recording %s: %s", recording_id, exc)

        # Store metrics before attempting feedback, same reasoning as the transcript
        # store above.
        client.table("recordings").update({"metrics": metrics}).eq("id", recording_id).execute()

        generated: GeneratedFeedback = _run_with_one_retry(
            "feedback generation",
            recording_id,
            lambda: generate_feedback(transcript=transcript, metrics=metrics, mode=mode, question=question),
        )

        # Any of title / strengths / improvements / the three scores /
        # grammar_issue_count is None when the model returned nothing usable for it
        # — tolerated (logged in `generate_feedback`), written as SQL NULL, never a
        # reason to fail. `feedback` holds the short summary; the strengths /
        # improvements lists go to their own jsonb columns.
        #
        # The scores are always written, even on a "Regenerate report" run — nothing
        # lets a user hand-edit a score, so the `title_edited_by_user` guard doesn't
        # apply to them. `title` is omitted from the payload when that flag is set,
        # so a hand-edited title survives regeneration untouched.
        update_payload: dict = {
            "status": "done",
            "feedback": generated.summary,
            "feedback_strengths": generated.strengths,
            "feedback_improvements": generated.improvements,
            "impact_score": generated.impact_score,
            "clarity_score": generated.clarity_score,
            "structure_score": generated.structure_score,
            "grammar_issue_count": generated.grammar_issue_count,
        }
        if not title_edited_by_user:
            update_payload["title"] = generated.title
        else:
            logger.info(
                "processing: recording %s: title was hand-edited by the user — not "
                "overwriting it with the freshly generated title",
                recording_id,
            )
        client.table("recordings").update(update_payload).eq("id", recording_id).execute()
    except TranscriptionError as exc:
        # Reached after `_run_with_one_retry` already tried transcription twice, or
        # directly from the missing-audio_path check above. Terminal: mark `failed`
        # and stop before metrics/feedback are attempted.
        logger.error(
            "processing: recording %s: giving up after retry, marking failed to transcribe: %s",
            recording_id,
            exc,
        )
        client.table("recordings").update({"status": "failed"}).eq("id", recording_id).execute()
    except FeedbackGenerationError as exc:
        # Reached after feedback generation was tried twice. Transcript and metrics
        # were already written to the row, so this branch only touches `status` —
        # the good partial work is kept.
        logger.error(
            "processing: recording %s: giving up after retry, marking failed to generate feedback: %s",
            recording_id,
            exc,
        )
        client.table("recordings").update({"status": "failed"}).eq("id", recording_id).execute()
    except Exception as exc:
        # Not retried — the retry policy targets flaky Gemini calls, not arbitrary
        # failures. This branch just stops an unexpected error (e.g. a Supabase
        # read/write failure) from leaving a row stuck at "processing" forever.
        logger.error("processing: recording %s failed unexpectedly: %s", recording_id, exc)
        client.table("recordings").update({"status": "failed"}).eq("id", recording_id).execute()
