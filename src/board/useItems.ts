import { useDeferredValue, useEffect, useMemo, useRef } from 'react';
import type { App } from 'obsidian';
import type { BoardItem, DatabaseConfig, PropertyConfig, SortSpec, ViewConfig } from '../types';
import { effectiveSort, visibleProperties } from '../config';
import { queryItems } from '../data/query';
import { applyFilter } from '../data/filter';
import { filterBySearch } from '../data/search';
import { applySort } from '../render/sort';
import { useBoard, useBoardContext } from './context';

export interface ViewItems {
  /** Every note in the database (before filter/search). */
  all: BoardItem[];
  /** Notes shown in the view: filtered, searched, sorted. */
  items: BoardItem[];
  /** Visible properties, in display order. */
  properties: PropertyConfig[];
  sort: SortSpec;
}

/**
 * Re-query the vault only when the source tag or the vault changes, and keep
 * each unchanged note's `BoardItem` object identical across re-queries — so
 * memoized cards for untouched notes don't re-render.
 */
function useAllItems(app: App, sourceTag: string, vaultTick: number): BoardItem[] {
  const cache = useRef(new Map<string, BoardItem>());
  return useMemo(() => {
    const next = new Map<string, BoardItem>();
    const items = queryItems(app, { sourceTag } as DatabaseConfig).map((item) => {
      const prev = cache.current.get(item.file.path);
      const same = prev
        && prev.file === item.file
        && prev.frontmatter === item.frontmatter
        && prev.title === item.title
        && prev.tags.join('\n') === item.tags.join('\n');
      const kept = same ? prev : item;
      next.set(item.file.path, kept);
      return kept;
    });
    cache.current = next;
    return items;
    // vaultTick isn't read inside — it is the re-query trigger.
  }, [app, sourceTag, vaultTick]);
}

/** The full query → filter → search → sort pipeline for one view, memoized per stage. */
export function useViewItems(config: DatabaseConfig, view: ViewConfig): ViewItems {
  const { app, actions } = useBoardContext();
  const vaultTick = useBoard((s) => s.vaultTick);
  // Typing stays responsive: filtering a large board renders at lower priority.
  const search = useDeferredValue(useBoard((s) => s.search));

  const all = useAllItems(app, config.sourceTag, vaultTick);
  useEffect(() => actions.reportItems(all), [actions, all]);

  const properties = useMemo(() => visibleProperties(config, view), [config.properties, view.properties]);
  const sort = useMemo(() => effectiveSort(view), [view.sort]);
  const filtered = useMemo(
    () => applyFilter(all, view.filter, config.properties),
    [all, view.filter, config.properties],
  );
  const searched = useMemo(() => filterBySearch(filtered, properties, search), [filtered, properties, search]);
  const items = useMemo(() => applySort(searched, sort, config.properties), [searched, sort, config.properties]);

  return { all, items, properties, sort };
}
