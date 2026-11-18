/** Recursive-descent parser: tokens → AST. Precedence: or < and < not < compare < & < +- < * / % < unary < ^. */

import { FormulaError, Token, tokenize } from './tokenize';

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ref'; name: string }
  | { t: 'call'; name: string; args: Node[] }
  | { t: 'unary'; op: string; x: Node }
  | { t: 'bin'; op: string; a: Node; b: Node };

const CMP = new Set(['=', '==', '!=', '<>', '<', '<=', '>', '>=']);

class Parser {
  private i = 0;
  constructor(private tokens: Token[]) {}

  parse(): Node {
    if (this.tokens.length === 0) throw new FormulaError('Empty formula');
    const node = this.or();
    const extra = this.peek();
    if (extra) throw new FormulaError(`Unexpected "${extra.value}"`);
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }

  private isOp(...ops: string[]): boolean {
    const t = this.peek();
    return !!t && ((t.kind === 'op' && ops.includes(t.value)) || (t.kind === 'ident' && ops.includes(t.value.toLowerCase())));
  }

  private next(): Token {
    const t = this.tokens[this.i++];
    if (!t) throw new FormulaError('Unexpected end of formula');
    return t;
  }

  private or(): Node {
    let a = this.and();
    while (this.isOp('||', 'or')) {
      this.next();
      a = { t: 'bin', op: 'or', a, b: this.and() };
    }
    return a;
  }

  private and(): Node {
    let a = this.not();
    while (this.isOp('&&', 'and')) {
      this.next();
      a = { t: 'bin', op: 'and', a, b: this.not() };
    }
    return a;
  }

  private not(): Node {
    if (this.isOp('!', 'not')) {
      this.next();
      return { t: 'unary', op: 'not', x: this.not() };
    }
    return this.compare();
  }

  private compare(): Node {
    const a = this.concat();
    const t = this.peek();
    if (t && t.kind === 'op' && CMP.has(t.value)) {
      this.next();
      const op = t.value === '==' ? '=' : t.value === '<>' ? '!=' : t.value;
      return { t: 'bin', op, a, b: this.concat() };
    }
    return a;
  }

  private concat(): Node {
    let a = this.add();
    while (this.isOp('&')) {
      this.next();
      a = { t: 'bin', op: '&', a, b: this.add() };
    }
    return a;
  }

  private add(): Node {
    let a = this.mul();
    while (this.isOp('+', '-')) {
      const op = this.next().value;
      a = { t: 'bin', op, a, b: this.mul() };
    }
    return a;
  }

  private mul(): Node {
    let a = this.unary();
    while (this.isOp('*', '/', '%')) {
      const op = this.next().value;
      a = { t: 'bin', op, a, b: this.unary() };
    }
    return a;
  }

  private unary(): Node {
    if (this.isOp('-', '+')) {
      const op = this.next().value;
      const x = this.unary();
      return op === '-' ? { t: 'unary', op: '-', x } : x;
    }
    return this.pow();
  }

  private pow(): Node {
    const a = this.primary();
    if (this.isOp('^')) {
      this.next();
      return { t: 'bin', op: '^', a, b: this.unary() };
    }
    return a;
  }

  private primary(): Node {
    const t = this.next();
    switch (t.kind) {
      case 'num':
        return { t: 'num', v: Number(t.value) };
      case 'str':
        return { t: 'str', v: t.value };
      case 'ref':
        if (!t.value) throw new FormulaError('Empty field reference "{}"');
        return { t: 'ref', name: t.value };
      case 'lparen': {
        const inner = this.or();
        if (this.next().kind !== 'rparen') throw new FormulaError('Missing ")"');
        return inner;
      }
      case 'ident': {
        const lower = t.value.toLowerCase();
        if (lower === 'true' || lower === 'false') return { t: 'bool', v: lower === 'true' };
        if (this.peek()?.kind !== 'lparen') {
          throw new FormulaError(`Unknown name "${t.value}" — wrap field names in {braces}`);
        }
        this.next();
        const args: Node[] = [];
        if (this.peek()?.kind !== 'rparen') {
          for (;;) {
            args.push(this.or());
            if (this.peek()?.kind === 'comma') {
              this.next();
              continue;
            }
            break;
          }
        }
        if (this.next().kind !== 'rparen') throw new FormulaError(`Missing ")" after ${t.value}(…`);
        return { t: 'call', name: lower, args };
      }
      default:
        throw new FormulaError(`Unexpected "${t.value}"`);
    }
  }
}

const cache = new Map<string, Node | FormulaError>();

/** Parse a formula (without a leading "="). Results are cached by source text. */
export function parseFormula(src: string): Node {
  let hit = cache.get(src);
  if (!hit) {
    try {
      hit = new Parser(tokenize(src)).parse();
    } catch (e) {
      hit = e instanceof FormulaError ? e : new FormulaError(String(e));
    }
    if (cache.size > 2000) cache.clear();
    cache.set(src, hit);
  }
  if (hit instanceof FormulaError) throw hit;
  return hit;
}
