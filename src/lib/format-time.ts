// Formats a duration as m:ss (e.g. 65 -> "1:05"). Shared by the recording
// elapsed-time counter and audio playback progress labels.
export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = Math.floor(safeSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Formats a `recordings.created_at` timestamp as "Aug 25 · 3:42 PM". Shared
// by the History list rows and the Phase 3 Step 1 detail screen so both
// render the same date/time the same way.
export function formatRecordedAt(isoString: string): string {
  const date = new Date(isoString);
  const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeLabel = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${dateLabel} · ${timeLabel}`;
}
