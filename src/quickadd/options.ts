import type { DatabaseConfig } from '../types';

/** Append new values to their select / multi properties' options (colors stay automatic). */
export function addOptions(config: DatabaseConfig, created: Record<string, string[]>): void {
  for (const p of config.properties) {
    const fresh = (created[p.name] ?? []).filter((v) => !p.options?.some((o) => o.value === v));
    if (fresh.length) p.options = [...(p.options ?? []), ...fresh.map((value) => ({ value }))];
  }
}
