import type { TableRow } from '../types';

/**
 * Whether a link target (as written, without `[[ ]]`, alias or heading) meant
 * the note at `oldPath`. Obsidian accepts the path with or without `.md`, or
 * — when unambiguous — just the note name, relative to anywhere.
 */
export function targetsPath(linkpath: string, oldPath: string): boolean {
  const target = linkpath.trim().replace(/^\/+/, '').toLowerCase();
  if (!target) return false;
  const old = oldPath.toLowerCase();
  const oldNoExt = old.replace(/\.md$/, '');
  return target === old || target === oldNoExt || oldNoExt.endsWith(`/${target}`) || old.endsWith(`/${target}`);
}

/** How a rename is applied to link text. */
export interface Relink {
  oldPath: string;
  /** How the new target is written (e.g. the shortest unambiguous path). */
  linkText: string;
  /** Whether a target still resolves to an existing note — then it never meant the renamed one. */
  resolves: (target: string) => boolean;
}

/**
 * Rewrite one cell string if it links to the renamed note. Handles `[[target]]`,
 * `[[target|alias]]`, `[[target#heading]]` and `![[...]]`; the alias and heading
 * are kept. Returns null when nothing changed.
 */
export function relinkText(value: string, r: Relink): string | null {
  let changed = false;
  const out = value.replace(/(!?)\[\[([^\]|#]*)(#[^\]|]*)?(\|[^\]]*)?\]\]/g, (whole, bang: string, target: string, heading = '', alias = '') => {
    if (!targetsPath(target, r.oldPath) || r.resolves(target.trim())) return whole;
    changed = true;
    return `${bang}[[${r.linkText}${heading}${alias}]]`;
  });
  return changed ? out : null;
}

/** Rewrite every link in a table's rows that pointed at the renamed note. Returns how many cells changed. */
export function relinkRows(rows: TableRow[], r: Relink): number {
  let count = 0;
  for (const row of rows) {
    for (const [key, cell] of Object.entries(row.cells)) {
      if (typeof cell === 'string') {
        const next = relinkText(cell, r);
        if (next !== null) {
          row.cells[key] = next;
          count++;
        }
      } else if (Array.isArray(cell)) {
        let hit = false;
        const next = cell.map((v) => {
          if (typeof v !== 'string') return v;
          const rewritten = relinkText(v, r);
          if (rewritten === null) return v;
          hit = true;
          return rewritten;
        });
        if (hit) {
          row.cells[key] = next;
          count++;
        }
      }
    }
  }
  return count;
}
