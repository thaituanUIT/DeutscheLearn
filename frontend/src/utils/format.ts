export function formatSeconds(value: number | null): string {
  if (value === null) return "-";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
