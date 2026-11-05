import type { AutoDateRule, DatabaseConfig } from '../types';
import { asArray } from '../render/values';
import { formatDate } from '../formula/evaluate';

/** Rules whose trigger and target properties exist, with at least one status. */
export function activeRules(config: DatabaseConfig): AutoDateRule[] {
  const names = new Set(config.properties.map((p) => p.name));
  return (config.autoDates ?? []).filter((r) => names.has(r.property) && names.has(r.date) && r.values.length > 0);
}

/** A rule's trigger values, lower-cased for comparison. */
const triggers = (rule: AutoDateRule): Set<string> => new Set(rule.values.map((v) => v.toLowerCase()));

/** Whether a property value (scalar or list) holds one of the rule's values. */
function hits(rule: AutoDateRule, value: unknown): boolean {
  const want = triggers(rule);
  return asArray(value).some((v) => want.has(v.toLowerCase()));
}

/**
 * Date properties to fill on one note, given its frontmatter before and after
 * a change. A rule fires when its property now holds a trigger value it did
 * not hold before, and the date property is still empty. Dates already set are
 * never overwritten.
 */
export function datesToFill(
  rules: AutoDateRule[],
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  now: Date,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (!hits(rule, after[rule.property])) continue;
    if (before && hits(rule, before[rule.property])) continue;
    const current = after[rule.date];
    if (current !== undefined && current !== null && String(current).trim() !== '') continue;
    if (out[rule.date]) continue;
    out[rule.date] = formatDate(now, rule.includeTime ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD');
  }
  return out;
}

/** The values a set of rules watches, per note, for comparing later changes. */
export function snapshot(rules: AutoDateRule[], frontmatter: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rules) out[r.property] = frontmatter[r.property];
  return out;
}
