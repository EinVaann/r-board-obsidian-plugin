/** Formula tokenizer. Tokens keep source offsets so references can be rewritten in place. */

export type TokenKind = 'num' | 'str' | 'ident' | 'ref' | 'op' | 'lparen' | 'rparen' | 'comma';

export interface Token {
  kind: TokenKind;
  /** num: the digits · str: unescaped text · ref: field name · ident/op: as written. */
  value: string;
  start: number;
  end: number;
}

export class FormulaError extends Error {}

const OPS = ['<=', '>=', '!=', '<>', '==', '&&', '||', '+', '-', '*', '/', '%', '^', '&', '=', '<', '>', '!'];

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const start = i;

    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new FormulaError(`Unexpected "${ch}"`);
      i += m[0].length;
      out.push({ kind: 'num', value: m[0], start, end: i });
      continue;
    }

    if (ch === '"' || ch === "'") {
      i++;
      let text = '';
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\' && i + 1 < src.length) i++;
        text += src[i++];
      }
      if (i >= src.length) throw new FormulaError('Unclosed string');
      i++;
      out.push({ kind: 'str', value: text, start, end: i });
      continue;
    }

    if (ch === '{') {
      i++;
      let name = '';
      while (i < src.length && src[i] !== '}') {
        if (src[i] === '\\' && i + 1 < src.length) i++;
        name += src[i++];
      }
      if (i >= src.length) throw new FormulaError('Unclosed field reference "{"');
      i++;
      out.push({ kind: 'ref', value: name.trim(), start, end: i });
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      i += m[0].length;
      out.push({ kind: 'ident', value: m[0], start, end: i });
      continue;
    }

    if (ch === '(') { out.push({ kind: 'lparen', value: ch, start, end: ++i }); continue; }
    if (ch === ')') { out.push({ kind: 'rparen', value: ch, start, end: ++i }); continue; }
    if (ch === ',') { out.push({ kind: 'comma', value: ch, start, end: ++i }); continue; }

    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      i += op.length;
      out.push({ kind: 'op', value: op, start, end: i });
      continue;
    }
    throw new FormulaError(`Unexpected "${ch}"`);
  }
  return out;
}

/** Quote a field name as a reference, escaping braces. */
export function refText(name: string): string {
  return `{${name.replace(/[\\{}]/g, (c) => `\\${c}`)}}`;
}

/** Rewrite every `{old}` reference to `{renamed}`. Returns the source unchanged if it doesn't tokenize. */
export function renameRefs(src: string, old: string, renamed: string): string {
  let tokens: Token[];
  try {
    tokens = tokenize(src);
  } catch {
    return src;
  }
  let out = '';
  let pos = 0;
  for (const t of tokens) {
    if (t.kind === 'ref' && t.value === old) {
      out += src.slice(pos, t.start) + refText(renamed);
      pos = t.end;
    }
  }
  return out + src.slice(pos);
}

/** Field names referenced by a formula (empty if it doesn't tokenize). */
export function referencedNames(src: string): string[] {
  try {
    return [...new Set(tokenize(src).filter((t) => t.kind === 'ref').map((t) => t.value))];
  } catch {
    return [];
  }
}
