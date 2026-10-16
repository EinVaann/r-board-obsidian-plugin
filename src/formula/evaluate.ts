/** Formula evaluation over one record. Field values arrive through `resolve`. */

import { Node, parseFormula } from './parse';
import { FormulaError } from './tokenize';

export type FValue = number | string | boolean | Date | null | FValue[];

export interface EvalContext {
  /** Value of the field with this name in the current record; throws FormulaError if unknown. */
  resolve(name: string): FValue;
}

export function evaluateFormula(src: string, ctx: EvalContext): FValue {
  return evalNode(parseFormula(src), ctx);
}

// ---------------------------------------------------------------- coercion

export function isEmpty(v: FValue): boolean {
  return v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

export function truthy(v: FValue): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  return !!v;
}

export function toNum(v: FValue): number {
  if (v === null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) throw new FormulaError('A list is not a number');
  const n = Number(v.replace(/[,\s]/g, ''));
  if (Number.isNaN(n)) throw new FormulaError(`"${v}" is not a number`);
  return n;
}

export function toText(v: FValue): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(10)));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return formatDate(v, hasTime(v) ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD');
  return v.map(toText).join(', ');
}

/** A formula read a blank input where it needed a date: the result is blank, not an error. */
export class BlankInput extends FormulaError {}

export function toDate(v: FValue): Date {
  if (v instanceof Date) return v;
  if (isEmpty(v)) throw new BlankInput('Blank date');
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') {
    const d = parseDateString(v);
    if (d) return d;
  }
  throw new FormulaError(`"${toText(v)}" is not a date`);
}

/** Parse "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" as LOCAL time (not UTC). */
export function parseDateString(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s.trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hasTime(d: Date): boolean {
  return d.getHours() !== 0 || d.getMinutes() !== 0;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatDate(d: Date, pattern: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return pattern.replace(/YYYY|MMM|MM|DD|HH|mm|M|D/g, (tok) => {
    switch (tok) {
      case 'YYYY': return String(d.getFullYear());
      case 'MMM': return months[d.getMonth()];
      case 'MM': return pad(d.getMonth() + 1);
      case 'M': return String(d.getMonth() + 1);
      case 'DD': return pad(d.getDate());
      case 'D': return String(d.getDate());
      case 'HH': return pad(d.getHours());
      case 'mm': return pad(d.getMinutes());
      default: return tok;
    }
  });
}

function compare(a: FValue, b: FValue): number {
  if (a instanceof Date || b instanceof Date) return toDate(a).getTime() - toDate(b).getTime();
  if (typeof a === 'number' || typeof b === 'number') {
    if (isEmpty(a) || isEmpty(b)) return isEmpty(a) === isEmpty(b) ? 0 : isEmpty(a) ? -1 : 1;
    return toNum(a) - toNum(b);
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(truthy(a)) - Number(truthy(b));
  return toText(a).localeCompare(toText(b));
}

function equals(a: FValue, b: FValue): boolean {
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b);
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  try {
    return compare(a, b) === 0;
  } catch {
    return toText(a) === toText(b);
  }
}

// ---------------------------------------------------------------- evaluation

function evalNode(n: Node, ctx: EvalContext): FValue {
  switch (n.t) {
    case 'num':
    case 'str':
    case 'bool':
      return n.v;
    case 'ref':
      return ctx.resolve(n.name);
    case 'unary': {
      const x = evalNode(n.x, ctx);
      return n.op === 'not' ? !truthy(x) : -toNum(x);
    }
    case 'bin':
      return evalBinary(n.op, n.a, n.b, ctx);
    case 'call': {
      const fn = FUNCTIONS[n.name];
      if (!fn) throw new FormulaError(`Unknown function "${n.name}"`);
      if (fn.lazy) return fn.lazy(n.args, ctx);
      return fn.call!(n.args.map((a) => evalNode(a, ctx)));
    }
  }
}

function evalBinary(op: string, an: Node, bn: Node, ctx: EvalContext): FValue {
  if (op === 'and') return truthy(evalNode(an, ctx)) && truthy(evalNode(bn, ctx));
  if (op === 'or') return truthy(evalNode(an, ctx)) || truthy(evalNode(bn, ctx));
  const a = evalNode(an, ctx);
  const b = evalNode(bn, ctx);
  switch (op) {
    case '&':
      return toText(a) + toText(b);
    case '+':
      if (typeof a === 'string' || typeof b === 'string') {
        // "+" concatenates unless both sides read as numbers.
        if (isNumeric(a) && isNumeric(b)) return toNum(a) + toNum(b);
        return toText(a) + toText(b);
      }
      return toNum(a) + toNum(b);
    case '-': return toNum(a) - toNum(b);
    case '*': return toNum(a) * toNum(b);
    case '/': {
      const d = toNum(b);
      if (d === 0) throw new FormulaError('Division by zero');
      return toNum(a) / d;
    }
    case '%': {
      const d = toNum(b);
      if (d === 0) throw new FormulaError('Division by zero');
      return toNum(a) % d;
    }
    case '^': return Math.pow(toNum(a), toNum(b));
    case '=': return equals(a, b);
    case '!=': return !equals(a, b);
    case '<': return compare(a, b) < 0;
    case '<=': return compare(a, b) <= 0;
    case '>': return compare(a, b) > 0;
    case '>=': return compare(a, b) >= 0;
  }
  throw new FormulaError(`Unknown operator "${op}"`);
}

function isNumeric(v: FValue): boolean {
  if (typeof v === 'number' || v === null || v === '') return true;
  return typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v.replace(/[,\s]/g, '')));
}

// ---------------------------------------------------------------- functions

interface FnDef {
  /** Plain function over evaluated arguments. */
  call?: (args: FValue[]) => FValue;
  /** Receives unevaluated arguments (for short-circuiting like `if`). */
  lazy?: (args: Node[], ctx: EvalContext) => FValue;
  /** Shown in the formula help. */
  sig: string;
  doc: string;
}

function arity(name: string, args: unknown[], min: number, max = min): void {
  if (args.length < min || args.length > max) {
    const want = min === max ? `${min}` : `${min}–${max}`;
    throw new FormulaError(`${name}() takes ${want} argument${max === 1 ? '' : 's'}, got ${args.length}`);
  }
}

const flat = (args: FValue[]): FValue[] => args.flatMap((a) => (Array.isArray(a) ? a : [a]));
const nums = (args: FValue[]): number[] => flat(args).filter((v) => !isEmpty(v)).map(toNum);

type Unit = 'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes';
function unitOf(v: FValue): Unit {
  const u = toText(v).toLowerCase().replace(/s?$/, 's');
  if (['years', 'months', 'weeks', 'days', 'hours', 'minutes'].includes(u)) return u as Unit;
  throw new FormulaError(`Unknown unit "${toText(v)}" — use days, weeks, months, years, hours, or minutes`);
}

function addToDate(d: Date, n: number, unit: Unit): Date {
  const r = new Date(d.getTime());
  switch (unit) {
    case 'years':
    case 'months': {
      // Clamp to the target month's last day: Jan 31 + 1 month = Feb 28, not Mar 3.
      const months = unit === 'years' ? 12 * n : n;
      const day = r.getDate();
      r.setDate(1);
      r.setMonth(r.getMonth() + months);
      r.setDate(Math.min(day, new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
      break;
    }
    case 'weeks': r.setDate(r.getDate() + 7 * n); break;
    case 'days': r.setDate(r.getDate() + n); break;
    case 'hours': r.setHours(r.getHours() + n); break;
    case 'minutes': r.setMinutes(r.getMinutes() + n); break;
  }
  return r;
}

function diffDates(a: Date, b: Date, unit: Unit): number {
  const ms = a.getTime() - b.getTime();
  switch (unit) {
    case 'years': return a.getFullYear() - b.getFullYear() - (monthDay(a) < monthDay(b) ? 1 : 0);
    case 'months': {
      const m = (a.getFullYear() - b.getFullYear()) * 12 + a.getMonth() - b.getMonth();
      return m - (a.getDate() < b.getDate() ? 1 : 0);
    }
    case 'weeks': return Math.trunc(ms / (7 * 864e5));
    case 'days': return Math.round(ms / 864e5);
    case 'hours': return Math.trunc(ms / 36e5);
    case 'minutes': return Math.trunc(ms / 6e4);
  }
}
const monthDay = (d: Date) => d.getMonth() * 100 + d.getDate();

export const FUNCTIONS: Record<string, FnDef> = {
  if: {
    sig: 'if(condition, then, else)',
    doc: 'Pick a value based on a condition.',
    lazy: (args, ctx) => {
      arity('if', args, 2, 3);
      if (truthy(evalNode(args[0], ctx))) return evalNode(args[1], ctx);
      return args[2] ? evalNode(args[2], ctx) : null;
    },
  },
  ifs: {
    sig: 'ifs(cond1, value1, cond2, value2, …, else)',
    doc: 'First value whose condition is true.',
    lazy: (args, ctx) => {
      for (let i = 0; i + 1 < args.length; i += 2) {
        if (truthy(evalNode(args[i], ctx))) return evalNode(args[i + 1], ctx);
      }
      return args.length % 2 === 1 ? evalNode(args[args.length - 1], ctx) : null;
    },
  },
  empty: { sig: 'empty(value)', doc: 'True when the value is blank.', call: (a) => (arity('empty', a, 1), isEmpty(a[0])) },
  coalesce: {
    sig: 'coalesce(a, b, …)',
    doc: 'First value that is not blank.',
    call: (a) => a.find((v) => !isEmpty(v)) ?? null,
  },

  abs: { sig: 'abs(x)', doc: 'Absolute value.', call: (a) => (arity('abs', a, 1), Math.abs(toNum(a[0]))) },
  round: {
    sig: 'round(x, decimals?)',
    doc: 'Round to a number of decimals (default 0).',
    call: (a) => {
      arity('round', a, 1, 2);
      const f = Math.pow(10, a[1] === undefined ? 0 : toNum(a[1]));
      return Math.round(toNum(a[0]) * f) / f;
    },
  },
  floor: { sig: 'floor(x)', doc: 'Round down.', call: (a) => (arity('floor', a, 1), Math.floor(toNum(a[0]))) },
  ceil: { sig: 'ceil(x)', doc: 'Round up.', call: (a) => (arity('ceil', a, 1), Math.ceil(toNum(a[0]))) },
  sqrt: { sig: 'sqrt(x)', doc: 'Square root.', call: (a) => (arity('sqrt', a, 1), Math.sqrt(toNum(a[0]))) },
  pow: { sig: 'pow(x, y)', doc: 'x to the power y.', call: (a) => (arity('pow', a, 2), Math.pow(toNum(a[0]), toNum(a[1]))) },
  mod: {
    sig: 'mod(x, y)',
    doc: 'Remainder of x / y.',
    call: (a) => {
      arity('mod', a, 2);
      const d = toNum(a[1]);
      if (d === 0) throw new FormulaError('Division by zero');
      return toNum(a[0]) % d;
    },
  },
  min: { sig: 'min(a, b, …)', doc: 'Smallest number.', call: (a) => (nums(a).length ? Math.min(...nums(a)) : null) },
  max: { sig: 'max(a, b, …)', doc: 'Largest number.', call: (a) => (nums(a).length ? Math.max(...nums(a)) : null) },
  sum: { sig: 'sum(a, b, …)', doc: 'Add numbers together.', call: (a) => nums(a).reduce((s, n) => s + n, 0) },
  avg: {
    sig: 'avg(a, b, …)',
    doc: 'Average of numbers (blanks ignored).',
    call: (a) => {
      const n = nums(a);
      return n.length ? n.reduce((s, x) => s + x, 0) / n.length : null;
    },
  },
  number: { sig: 'number(value)', doc: 'Convert text to a number.', call: (a) => (arity('number', a, 1), toNum(a[0])) },

  text: { sig: 'text(value)', doc: 'Convert any value to text.', call: (a) => (arity('text', a, 1), toText(a[0])) },
  concat: { sig: 'concat(a, b, …)', doc: 'Join values as text.', call: (a) => a.map(toText).join('') },
  join: {
    sig: 'join(list, separator)',
    doc: 'Join a list (e.g. a multi-select) with a separator.',
    call: (a) => (arity('join', a, 1, 2), flat([a[0]]).map(toText).join(a[1] === undefined ? ', ' : toText(a[1]))),
  },
  len: {
    sig: 'len(value)',
    doc: 'Length of text, or number of items in a list.',
    call: (a) => (arity('len', a, 1), Array.isArray(a[0]) ? a[0].length : toText(a[0]).length),
  },
  lower: { sig: 'lower(text)', doc: 'Lowercase.', call: (a) => (arity('lower', a, 1), toText(a[0]).toLowerCase()) },
  upper: { sig: 'upper(text)', doc: 'Uppercase.', call: (a) => (arity('upper', a, 1), toText(a[0]).toUpperCase()) },
  trim: { sig: 'trim(text)', doc: 'Remove surrounding spaces.', call: (a) => (arity('trim', a, 1), toText(a[0]).trim()) },
  contains: {
    sig: 'contains(textOrList, value)',
    doc: 'True if text contains the value, or a list has it.',
    call: (a) => {
      arity('contains', a, 2);
      if (Array.isArray(a[0])) return a[0].some((v) => equals(v, a[1]));
      return toText(a[0]).toLowerCase().includes(toText(a[1]).toLowerCase());
    },
  },
  replace: {
    sig: 'replace(text, find, with)',
    doc: 'Replace every occurrence.',
    call: (a) => (arity('replace', a, 3), toText(a[0]).split(toText(a[1])).join(toText(a[2]))),
  },
  slice: {
    sig: 'slice(text, start, end?)',
    doc: 'Part of the text (0-based).',
    call: (a) => {
      arity('slice', a, 2, 3);
      return toText(a[0]).slice(toNum(a[1]), a[2] === undefined ? undefined : toNum(a[2]));
    },
  },

  now: { sig: 'now()', doc: 'Current date and time.', call: (a) => (arity('now', a, 0), new Date()) },
  today: {
    sig: 'today()',
    doc: 'Today’s date.',
    call: (a) => {
      arity('today', a, 0);
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    },
  },
  date: {
    sig: 'date(year, month, day)',
    doc: 'Build a date.',
    call: (a) => (arity('date', a, 3), new Date(toNum(a[0]), toNum(a[1]) - 1, toNum(a[2]))),
  },
  dateadd: {
    sig: 'dateAdd(date, amount, unit)',
    doc: 'Add days/weeks/months/years/hours/minutes.',
    call: (a) => (arity('dateAdd', a, 3), addToDate(toDate(a[0]), toNum(a[1]), unitOf(a[2]))),
  },
  datediff: {
    sig: 'dateDiff(a, b, unit)',
    doc: 'a − b in whole units.',
    call: (a) => (arity('dateDiff', a, 3), diffDates(toDate(a[0]), toDate(a[1]), unitOf(a[2]))),
  },
  year: { sig: 'year(date)', doc: 'Year number.', call: (a) => (arity('year', a, 1), toDate(a[0]).getFullYear()) },
  month: { sig: 'month(date)', doc: 'Month 1–12.', call: (a) => (arity('month', a, 1), toDate(a[0]).getMonth() + 1) },
  day: { sig: 'day(date)', doc: 'Day of the month.', call: (a) => (arity('day', a, 1), toDate(a[0]).getDate()) },
  weekday: {
    sig: 'weekday(date)',
    doc: 'Day of the week, 1 = Monday … 7 = Sunday.',
    call: (a) => (arity('weekday', a, 1), ((toDate(a[0]).getDay() + 6) % 7) + 1),
  },
  formatdate: {
    sig: 'formatDate(date, pattern)',
    doc: 'Format with YYYY, MM, MMM, DD, HH, mm.',
    call: (a) => (arity('formatDate', a, 2), formatDate(toDate(a[0]), toText(a[1]))),
  },
};
