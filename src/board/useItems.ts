import { useDeferredValue, useEffect, useMemo, useRef } from 'react';
import type { App } from 'obsidian';
import type { BoardItem, DatabaseConfig, PropertyConfig, SortSpec, TableRow, ViewConfig } from '../types';
import { effectiveSort, visibleProperties } from '../config';
import { queryItems } from '../data/query';
import { applyFilter } from '../data/filter';
import { filterBySearch } from '../data/search';
import { applySort } from '../render/sort';
import { FormulaEvaluator } from '../data/compute';
import { rowsToItems } from '../table/rows';
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
    if (!sourceTag) return [];
    const next = new Map<string, BoardItem>();
    const items = queryItems(app, { sourceTag } as DatabaseConfig).map((item) => {
      const prev = cache.current.get(item.id);
      const same = prev
        && prev.file === item.file
        && prev.values === item.values
        && prev.title === item.title
        && prev.tags.join('\n') === item.tags.join('\n');
      const kept = same ? prev : item;
      next.set(item.id, kept);
      return kept;
    });
    cache.current = next;
    return items;
    // vaultTick isn't read inside — it is the re-query trigger.
  }, [app, sourceTag, vaultTick]);
}

/** A table's rows as items (empty for boards, whose store holds no rows). */
function useRowItems(titleProperty: string | undefined): BoardItem[] {
  const rows = useBoard((s) => s.rows);
  const cache = useRef({ titleProperty, map: new WeakMap<TableRow, BoardItem>() });
  return useMemo(() => {
    if (cache.current.titleProperty !== titleProperty) cache.current = { titleProperty, map: new WeakMap() };
    return rowsToItems(rows, titleProperty, cache.current.map);
  }, [rows, titleProperty]);
}

/**
 * Items with formula results filled in. An item keeps its computed object while
 * neither it nor the properties change, so memoized cards still skip re-rendering.
 */
export function useComputed(items: BoardItem[], properties: PropertyConfig[]): BoardItem[] {
  const cache = useRef({ properties, map: new WeakMap<BoardItem, BoardItem>() });
  return useMemo(() => {
    if (cache.current.properties !== properties) cache.current = { properties, map: new WeakMap() };
    const ev = new FormulaEvaluator(properties);
    if (ev.formulas.length === 0) return items;
    const map = cache.current.map;
    return items.map((item) => {
      let out = map.get(item);
      if (!out) map.set(item, (out = ev.apply(item)));
      return out;
    });
  }, [items, properties]);
}

/** The full query → filter → search → sort pipeline for one view, memoized per stage. */
export function useViewItems(config: DatabaseConfig, view: ViewConfig): ViewItems {
  const { app, actions } = useBoardContext();
  const vaultTick = useBoard((s) => s.vaultTick);
  // Typing stays responsive: filtering a large board renders at lower priority.
  const search = useDeferredValue(useBoard((s) => s.search));

  const isTable = config.kind === 'table';
  const notes = useAllItems(app, isTable ? '' : config.sourceTag, isTable ? -1 : vaultTick);
  const rows = useRowItems(config.titleProperty);
  const stored = isTable ? rows : notes;
  useEffect(() => actions.reportItems(stored), [actions, stored]);
  const all = useComputed(stored, config.properties);

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
