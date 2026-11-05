import type { Range } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parts = (s: string): { y: number; m: number; d: number } => {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m: m - 1, d };
};

/** `Dec 18`, with the year when it isn't `thisYear`. */
export function formatDay(s: string, thisYear: number): string {
  const p = parts(s);
  return `${MONTHS[p.m]} ${p.d}${p.y !== thisYear ? `, ${p.y}` : ''}`;
}

/** `Dec 18–28`, `Dec 28 – Jan 4`, `Dec 28, 2026 – Jan 4, 2027`; one day when early = late. */
export function formatRange(r: Range, thisYear: number): string {
  if (r.early === r.late) return formatDay(r.early, thisYear);
  const a = parts(r.early);
  const b = parts(r.late);
  const year = (y: number): string => (y !== thisYear ? `, ${y}` : '');
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m]} ${a.d}–${b.d}${year(a.y)}`;
  if (a.y === b.y) return `${MONTHS[a.m]} ${a.d} – ${MONTHS[b.m]} ${b.d}${year(a.y)}`;
  return `${formatDay(r.early, NaN)} – ${formatDay(r.late, NaN)}`;
}

/** Shorter for narrow screens: `Dec 18–28`, `Dec 28–Jan 4`, `Dec ’26–Jan ’27`. */
export function formatShortRange(r: Range, thisYear: number): string {
  const a = parts(r.early);
  const b = parts(r.late);
  const yy = (y: number): string => `’${String(y).slice(2)}`;
  if (r.early === r.late) return `${MONTHS[a.m]} ${a.d}${a.y !== thisYear ? ` ${yy(a.y)}` : ''}`;
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m]} ${a.d}–${b.d}${a.y !== thisYear ? ` ${yy(a.y)}` : ''}`;
  if (a.y === b.y) return `${MONTHS[a.m]} ${a.d}–${MONTHS[b.m]} ${b.d}${a.y !== thisYear ? ` ${yy(a.y)}` : ''}`;
  return `${MONTHS[a.m]} ${yy(a.y)}–${MONTHS[b.m]} ${yy(b.y)}`;
}

/** `7.5 h`, `12 h`. */
export function formatHours(h: number): string {
  return `${Math.round(h * 10) / 10} h`;
}
