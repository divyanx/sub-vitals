/**
 * Centralised time formatting — single source of truth for all time displays.
 *
 * Usage:
 *   relativeTime(ts)   → "2h ago" | "3d ago" | "Mar 17"
 *   absoluteTime(ts)   → "Mar 17, 2026 · 14:32"
 *
 * All time-display JSX should use:
 *   <time dateTime={new Date(ts).toISOString()} title={absoluteTime(ts)}>
 *     {relativeTime(ts)}
 *   </time>
 */

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "2h ago" / "3d ago" / "Mar 17" (falls back to month+day after 30 days) */
export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const date = new Date(ms);
  return `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}`;
}

/** "Mar 17, 2026 · 14:32" */
export function absoluteTime(ms: number): string {
  const date = new Date(ms);
  const month = MONTH_ABBR[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${month} ${day}, ${year} · ${hh}:${mm}`;
}

/** ISO 8601 string for the dateTime attribute */
export function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}
