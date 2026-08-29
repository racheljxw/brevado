"""
Background processing for a recording.

*** Phase 2 Step 6: the full pipeline is real and now retries once on
failure — no stubs and no more "fail on the first error" remain. ***
`process_recording` downloads the recording's audio from Supabase Storage
once, sends it to Gemini (native audio input) for a real transcript, then
computes deterministic metrics (filler-word rate, words per minute,
repetition — see `app/services/metrics.py`) from that transcript and the
same audio bytes, then sends the transcript, metrics, mode, and question to
Gemini again for real mode-aware feedback, a short 2-4 word recording
title, and the v3 scores — `impact_score` / `clarity_score` /
`structure_score` (each 0-100) plus `grammar_issue_count` — all from one
structured-JSON call (see `app/services/feedback.py`). No second download
involved anywhere in this. Each stage's result is written to the row as
soon as it succeeds (transcript, then metrics), so a later stage failing
can never lose earlier, already-successful work. A missing title or any
missing/out-of-range score never fails the recording — it's stored as NULL
and logged, same lenient degradation as a metrics-computation failure.

**v2 Epic D Part 7 bug fix: a hand-edited title is never overwritten.** If
the row's `title_edited_by_user` flag is set (set only by
`updateRecordingTitle` in src/lib/recordings.ts, the Part 2 title editor),
the final `status: done` write omits `title` entirely, so a user's own
title survives a fresh generation or a later "Regenerate report" untouched.
Feedback/transcript/metrics are unaffected by this flag — only the title
write is conditional. See migration `0006_title_edited_by_user.sql`.

**Retry policy (Step 6, docs/PROJECT_PLAN.md Section 3 "Retry behavior"):**
each of the two Gemini-calling stages — transcription (download + the
transcribe call, via `_run_with_one_retry` in `process_recording`) and
feedback generation — gets one immediate inline retry of *just that stage*
if it raises `TranscriptionError`/`FeedbackGenerationError`, before the
recording is marked `failed`. This is stage-level retry, not whole-pipeline
retry: a feedback failure retries only the feedback call, reusing the
transcript/metrics already computed and stored on the first pass, rather
than re-downloading audio and burning a second transcription Gemini call
for work that already succeeded. See `_run_with_one_retry`'s docstring for
the full reasoning and `docs/CLAUDE.md`'s "Background processing" section
for the project-level summary. Both attempts happen synchronously inside
this same `BackgroundTasks` call — a caller polling `status` never sees an
intermediate `failed` unless both attempts of a stage failed.

This runs as a FastAPI `BackgroundTasks` callback, i.e. after the request
that scheduled it has already returned a response — there's no HTTP request
context here, which is why it uses the service-role client directly rather
than anything tied to the caller's bearer token.
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


def _run_with_one_retry(stage_name: str, recording_id: str, fn: Callable[[], T]) -> T:
    """Runs `fn()`, retrying it exactly once, immediately, if it raises
    `TranscriptionError` or `FeedbackGenerationError` — the Step 6 retry policy from
    docs/PROJECT_PLAN.md Section 3 ("On failure, the pipeline auto-retries once
    immediately"). If `fn` succeeds on the retry, the caller never learns a first
    attempt failed at all except via the logs — `status` never moves to `failed`. If
    the retry also fails, that same exception propagates to the caller, who is
    responsible for marking the recording `failed`.

    Deliberately **stage-level**, not whole-pipeline: `fn` is expected to be just the
    Gemini-calling unit that can fail (transcription's download+transcribe, or a bare
    feedback generation call), not a re-run of the entire `process_recording` body.
    This was the two options considered for Step 6:
      - Retry the whole pipeline from scratch — simpler, but a feedback failure would
        redo a successful transcription too, wasting a second transcription Gemini
        call over audio that was already transcribed correctly.
      - Retry only the failed stage, preserving already-succeeded stages — the
        approach used here. It isn't meaningfully more complex than whole-pipeline
        retry *because* the pipeline was already structured to store each stage's
        result to the row as soon as it succeeds (see `process_recording` and
        docs/CLAUDE.md's "Metrics"/"Feedback generation" sections) — that same
        structure means a feedback retry can just reuse the transcript/metrics
        already in hand rather than needing to fetch them back from the row.
    A transcription-stage retry does re-download the audio (see `process_recording`)
    rather than reusing bytes from a failed first attempt — that's a cheap Storage
    round-trip, not a Gemini call, so it isn't the waste this policy is trying to
    avoid; it also means a first-attempt download failure is retried too, not just a
    first-attempt Gemini-call failure.

    Only two log lines exist for this, deliberately worded to be unambiguous when
    read later in Render's log stream: a first-attempt failure says "retrying once
    immediately" and never appears if the retry then succeeds; a retry failure says
    "retry also failed" and only appears once both attempts are exhausted. Before
    Step 6 these were indistinguishable — every failure logged the same way whether
    it was a first or only attempt.
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
        # v2 Epic D Part 7 bug fix: if the user has hand-edited this
        # recording's title (via the Part 2 editor — the only place that ever
        # sets this flag, see `updateRecordingTitle` in src/lib/recordings.ts
        # and migration 0006_title_edited_by_user.sql), a pipeline run (fresh
        # generation or a "Regenerate report" retry) must never clobber it
        # with a freshly-generated one. Read once here so both the retry
        # branch below and the final write can use it without a second
        # round-trip.
        title_edited_by_user = bool(row.get("title_edited_by_user")) if row else False

        mime_type = _mime_type_for(audio_path)

        def _do_transcription() -> tuple[bytes, str]:
            audio_bytes = _download_audio(audio_path)
            transcript = _transcribe(audio_bytes, mime_type)
            return audio_bytes, transcript

        audio_bytes, transcript = _run_with_one_retry("transcription", recording_id, _do_transcription)

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

        generated: GeneratedFeedback = _run_with_one_retry(
            "feedback generation",
            recording_id,
            lambda: generate_feedback(transcript=transcript, metrics=metrics, mode=mode, question=question),
        )

        # `generated.title` (and any of the v3 scores) is None if the model returned
        # nothing usable for that field — deliberately tolerated (logged in
        # `generate_feedback`), never a reason to fail the recording, same lenient
        # degradation as metrics above. A None writes as SQL NULL.
        #
        # v3 Epic F Step 1: the three 0-100 scores + grammar_issue_count are always
        # written (including on a "Regenerate report" run) — unlike `title`, they are
        # NOT subject to the `title_edited_by_user` hand-edit guard, since nothing lets
        # a user hand-edit a score. Streaks aggregation (Epic G) excludes any recording
        # with a NULL score, so a regenerate that fills a previously-NULL score simply
        # brings that recording into the aggregation.
        #
        # v2 Epic D Part 7 bug fix: if the user hand-edited this recording's title
        # (`title_edited_by_user`, read above), `title` is left out of this update
        # entirely — feedback/transcript/metrics/scores still refresh normally, but the
        # user's own title is never overwritten by a freshly-generated one, on
        # either an initial run or a later "Regenerate report".
        update_payload: dict = {
            "status": "done",
            "feedback": generated.feedback,
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
        # Reached only after `_run_with_one_retry` already tried transcription twice
        # (see that function's own "retrying once immediately" / "failed again on
        # retry" log lines above this one) — this is the terminal "give up" step:
        # mark `failed` and stop before metrics/feedback are ever attempted. Also
        # reached directly (no retry involved) for the missing-audio_path check
        # above, which raises `TranscriptionError` outside of `_run_with_one_retry`.
        logger.error(
            "processing: recording %s: giving up after retry, marking failed to transcribe: %s",
            recording_id,
            exc,
        )
        client.table("recordings").update({"status": "failed"}).eq("id", recording_id).execute()
    except FeedbackGenerationError as exc:
        # Reached only after `_run_with_one_retry` already tried feedback generation
        # twice. The transcript and metrics steps above already wrote their results
        # to the row before this ran, so this branch only ever touches `status` — the
        # good partial work (transcript, metrics) is never lost or overwritten,
        # matching the same principle as the transcription failure branch above. See
        # docs/CLAUDE.md's "AI processing endpoint" section.
        logger.error(
            "processing: recording %s: giving up after retry, marking failed to generate feedback: %s",
            recording_id,
            exc,
        )
        client.table("recordings").update({"status": "failed"}).eq("id", recording_id).execute()
    except Exception as exc:
        # Deliberately NOT retried (see `_run_with_one_retry`'s docstring): the Step 6
        # retry policy targets flaky Gemini calls specifically, not every possible
        # failure mode. This branch just prevents an unexpected failure (e.g. a
        # Supabase read/write error) from leaving a row stuck at "processing" forever.
        logger.error("processing: recording %s failed unexpectedly: %s", recording_id, exc)
        client.table("recordings").update({"status": "failed"}).eq("id", recording_id).execute()
