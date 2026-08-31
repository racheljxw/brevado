// Formats a duration as m:ss (e.g. 65 -> "1:05"). Shared by the recording
// elapsed-time counter and audio playback progress labels.
export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = Math.floor(safeSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Formats a `recordings.created_at` timestamp as "Aug 25 · 3:42 PM". Shared
// by the History list rows and the detail screen.
export function formatRecordedAt(isoString: string): string {
  const date = new Date(isoString);
  const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeLabel = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${dateLabel} · ${timeLabel}`;
}

// ---------------------------------------------------------------------------
// Local calendar-day keys
//
// `localDayKey` is the "which calendar day did this happen on" grouping key,
// shared by History's Calendar view and the Streaks aggregation
// (`src/lib/streaks.ts`) so both bucket dates the same way. It uses the
// device's LOCAL date parts on purpose — a recording made at 11pm is filed
// under the day the user actually made it, not a UTC-shifted one.
// Consequence: a user who travels across time zones between recording and
// viewing can see a recording shift days (accepted — it matches how a
// phone's own Photos/Calendar behave).
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` in the device's local time zone. Zero-padded, so plain
 *  string comparison (`<`, `>`, `===`) is also chronological order. */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Inverse of `localDayKey` — a `Date` at local midnight on that day. */
export function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** A new `Date` `n` local calendar days from `d` (negative = earlier).
 *  Calendar arithmetic via `setDate`, so it stays correct across DST. */
export function addLocalDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}
