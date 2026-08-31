export function formatSeconds(value: number | null): string {
  if (value === null) return "-";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}

export function formatCount(
  count: number,
  noun: string,
  options: { plural?: string; zeroLabel?: string } = {},
): string {
  const label = count === 1 ? noun : (options.plural ?? pluralize(noun, count));
  if (count === 0 && options.zeroLabel) return `${options.zeroLabel} ${label}`;
  return `${count} ${label}`;
}
