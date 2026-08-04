export function formatRecordingDuration(durationSeconds: number | undefined) {
  if (durationSeconds === undefined) return null;
  const totalSeconds = Math.max(1, Math.round(durationSeconds));
  return totalSeconds < 60
    ? `${totalSeconds}s`
    : `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
