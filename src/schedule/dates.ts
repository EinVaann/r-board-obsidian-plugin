/** Calendar days as integers (UTC-based, so no DST drift) and `YYYY-MM-DD` strings. */

const DAY = 86_400_000;

/** `YYYY-MM-DD` (time part ignored) → day number; null when unreadable. */
export function toDay(s: string | undefined | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? '').trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : Math.round(t / DAY);
}

export function fromDay(day: number): string {
  return new Date(Math.floor(day) * DAY).toISOString().slice(0, 10);
}

/** A local Date → `YYYY-MM-DD`. */
export function localDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** First day of the week containing `day`. Day 0 (1970-01-01) was a Thursday. */
export function weekStart(day: number, start: 'mon' | 'sun'): number {
  const weekday = (day + 4) % 7; // 0 = Sunday
  const back = start === 'sun' ? weekday : (weekday + 6) % 7;
  return day - back;
}
