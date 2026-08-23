// Formats a duration as m:ss (e.g. 65 -> "1:05"). Shared by the recording
// elapsed-time counter and audio playback progress labels.
export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = Math.floor(safeSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
