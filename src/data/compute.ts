import type { BoardItem, PropertyConfig } from '../types';
import { BlankInput, evaluateFormula, type FValue } from '../formula/evaluate';
import { FormulaError } from '../formula/tokenize';
import { asArray, asBoolean, asDate, asNumber, optionFor } from '../render/values';

/** A stored value as a formula sees it (select → label, date → Date, list → array). */
export function toFormulaValue(prop: PropertyConfig, raw: unknown): FValue {
  switch (prop.type) {
    case 'number':
      return asNumber(raw);
    case 'checkbox':
      return asBoolean(raw) ?? false;
    case 'date':
      return asDate(raw);
    case 'select':
      return raw == null || raw === '' ? null : optionFor(prop, String(raw)).label;
    case 'multi':
      return asArray(raw).map((v) => optionFor(prop, v).label);
    case 'links':
      return asArray(raw);
    default:
      if (raw == null) return null;
      if (Array.isArray(raw)) return asArray(raw).join(', ');
      if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
      return String(raw);
  }
}

/** Where a formula cell's value comes from: the property's formula, a per-record `=expr`, or a literal. */
export function formulaOverride(raw: unknown): 'none' | 'formula' | 'value' {
  if (raw === undefined || raw === null || raw === '') return 'none';
  return typeof raw === 'string' && raw.startsWith('=') ? 'formula' : 'value';
}

/**
 * Evaluates formula properties for one item at a time. Properties are referenced
 * by label or key (`{Price}`), case-insensitively; `{Title}` is the item title.
 */
export class FormulaEvaluator {
  private byName = new Map<string, PropertyConfig>();
  readonly formulas: PropertyConfig[];

  constructor(properties: PropertyConfig[]) {
    for (const p of properties) {
      for (const n of [p.label, p.name]) {
        const k = n?.trim().toLowerCase();
        if (k && !this.byName.has(k)) this.byName.set(k, p);
      }
    }
    this.formulas = properties.filter((p) => p.type === 'formula');
  }

  /** A copy of the item with formula results in `values` and failures in `errors`; the item itself if it has no formulas. */
  apply(item: BoardItem): BoardItem {
    if (this.formulas.length === 0) return item;
    const results = new Map<string, FValue>();
    const errors: Record<string, string> = {};
    const visiting = new Set<string>();

    const compute = (prop: PropertyConfig): FValue => {
      if (results.has(prop.name)) return results.get(prop.name)!;
      if (errors[prop.name]) throw new FormulaError(`{${prop.label ?? prop.name}} has an error`);
      const raw = item.values[prop.name];
      const mode = formulaOverride(raw);
      if (mode === 'value') {
        results.set(prop.name, raw as FValue);
        return raw as FValue;
      }
      const src = mode === 'formula' ? (raw as string).slice(1) : prop.formula ?? '';
      if (!src.trim()) {
        results.set(prop.name, null);
        return null;
      }
      if (visiting.has(prop.name)) throw new FormulaError(`Circular reference through {${prop.label ?? prop.name}}`);
      visiting.add(prop.name);
      try {
        const value = evaluateFormula(src, { resolve: (name) => this.resolve(name, item, compute) });
        if (typeof value === 'number' && !Number.isFinite(value)) throw new FormulaError('Result is not a finite number');
        results.set(prop.name, value);
        return value;
      } catch (e) {
        // A blank input (e.g. no date yet) leaves the result blank instead of #ERROR.
        if (e instanceof BlankInput) {
          results.set(prop.name, null);
          return null;
        }
        errors[prop.name] = e instanceof Error ? e.message : String(e);
        throw new FormulaError(`{${prop.label ?? prop.name}} has an error`);
      } finally {
        visiting.delete(prop.name);
      }
    };

    for (const prop of this.formulas) {
      try {
        compute(prop);
      } catch {
        // Recorded in `errors` by the failing formula itself.
      }
    }
    const values = { ...item.values };
    for (const prop of this.formulas) values[prop.name] = errors[prop.name] ? null : results.get(prop.name) ?? null;
    const out: BoardItem = { ...item, values, stored: item.values };
    if (Object.keys(errors).length) out.errors = errors;
    return out;
  }

  private resolve(name: string, item: BoardItem, compute: (p: PropertyConfig) => FValue): FValue {
    const prop = this.byName.get(name.trim().toLowerCase());
    if (!prop) {
      if (name.trim().toLowerCase() === 'title') return item.title;
      throw new FormulaError(`Unknown property {${name}}`);
    }
    return prop.type === 'formula' ? compute(prop) : toFormulaValue(prop, item.values[prop.name]);
  }
}

/** Evaluate formulas for a list of items. */
export function computeItems(items: BoardItem[], properties: PropertyConfig[]): BoardItem[] {
  const ev = new FormulaEvaluator(properties);
  return ev.formulas.length ? items.map((i) => ev.apply(i)) : items;
}
