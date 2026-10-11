export function formatKpiDuration(totalSeconds: number): string {
  const duration = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  if (minutes === 0) return `${seconds} sec`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds}`;
}
