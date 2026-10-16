import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import type { BoardItem, LoadLimit, PropertyConfig, ViewConfig } from '../types';
import { cellsForGroup, collapseKey, groupItems, type ItemGroup } from '../data/group';
import { useBoard, useBoardContext } from '../board/context';
import { Icon } from '../react/Icon';

/** A group label styled as a colored pill when the group has a color. */
export function GroupLabel({ label, color, className }: { label: string; color?: string; className: string }) {
  return (
    <span
      className={color ? `${className} rb-group-pill` : className}
      style={color ? ({ '--gc': color } as React.CSSProperties) : undefined}
    >
      {label}
    </span>
  );
}

/**
 * Split items into collapsible labelled sections by the view's group property
 * (gallery / table / recipe). `children` renders one section's items.
 */
export function Sections({
  items,
  groupProp,
  view,
  pagePrefix,
  children,
  collapsedContent,
}: {
  items: BoardItem[];
  groupProp: PropertyConfig;
  view: ViewConfig;
  pagePrefix: string;
  children: (items: BoardItem[], pageKey: string, group: ItemGroup) => ReactNode;
  /** Shown instead of the items while a group is collapsed (e.g. a table's summary row). */
  collapsedContent?: (items: BoardItem[], group: ItemGroup) => ReactNode;
}) {
  const { actions } = useBoardContext();
  const properties = useBoard((s) => s.config?.properties);
  const viewIndex = useBoard((s) => s.config?.views.indexOf(view) ?? -1);
  const toggle = useBoard((s) => s.toggleCollapsed);
  const collapsed = useMemo(() => new Set(view.collapsed), [view.collapsed]);
  const groups = useMemo(
    () => groupItems(items, groupProp, { order: view.columns, groupConfig: view.groupConfig, bucket: view.groupBucket }),
    [items, groupProp, view.columns, view.groupConfig, view.groupBucket],
  );

  return (
    <>
      {groups.map((group) => {
        const isCollapsed = collapsed.has(collapseKey(group.key));
        const add = (e: React.MouseEvent): void => {
          e.stopPropagation();
          const template = group.items[group.items.length - 1];
          actions.createNewNote(cellsForGroup(groupProp, properties ?? [], view.groupBucket ?? 'none', group, template));
        };
        return (
          <div key={group.key ?? '\u0000none'} className="rb-section">
            <div className="rb-section-header" onClick={() => toggle(viewIndex, collapseKey(group.key))}>
              <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} className="rb-section-caret" />
              <GroupLabel label={group.label} color={group.color} className="rb-section-title" />
              <span className="rb-section-count">{group.items.length}</span>
              <button className="rb-icon-btn rb-section-add" aria-label="New item in this group" title="New item in this group" onClick={add}>
                <Icon name="plus" />
              </button>
            </div>
            {isCollapsed ? collapsedContent?.(group.items, group) : children(group.items, `${pagePrefix}:${group.label}`, group)}
          </div>
        );
      })}
    </>
  );
}

/**
 * "View More" paging over a list. The revealed count is kept in the board
 * store, so it survives re-renders (e.g. after moving a card).
 */
export function usePaged<T>(key: string, items: T[], limit: LoadLimit): { visible: T[]; more: (() => void) | null; remaining: number } {
  const remembered = useBoard((s) => s.pages[key]);
  const setPage = useBoard((s) => s.setPage);
  if (limit === 'none') return { visible: items, more: null, remaining: 0 };

  const shown = Math.min(items.length, Math.max(limit, remembered ?? limit));
  const remaining = items.length - shown;
  return {
    visible: shown === items.length ? items : items.slice(0, shown),
    more: remaining > 0 ? () => setPage(key, shown + limit) : null,
    remaining,
  };
}

/**
 * Numbered pages over a list (`limit` items each). The current page is kept
 * in the board store and clamped, so a shrinking list (search, filter) never
 * leaves you past the last page.
 */
export function usePages<T>(key: string, items: T[], limit: LoadLimit): { visible: T[]; page: number; pages: number; total: number; size: number; setPage: (page: number) => void } {
  const remembered = useBoard((s) => s.pages[key]);
  const setPage = useBoard((s) => s.setPage);
  const size = limit === 'none' ? Math.max(1, items.length) : limit;
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(Math.max(0, remembered ?? 0), pages - 1);
  return {
    visible: items.slice(page * size, page * size + size),
    page,
    pages,
    total: items.length,
    size,
    setPage: (p: number) => setPage(key, Math.min(Math.max(0, p), pages - 1)),
  };
}

/** Page numbers to show: first, last, and a window around the current page, with gaps as null. */
function pageWindow(page: number, pages: number): (number | null)[] {
  const keep = new Set([0, pages - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < pages));
  const out: (number | null)[] = [];
  [...keep].sort((a, b) => a - b).forEach((p, i, arr) => {
    if (i > 0 && p - arr[i - 1] > 1) out.push(null);
    out.push(p);
  });
  return out;
}

/** ‹ 1 … 4 5 6 … 12 ›  ·  "61–80 of 230" */
export function Pager({ page, pages, total, size, onPage }: { page: number; pages: number; total: number; size: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  const from = page * size + 1;
  const to = Math.min(total, from + size - 1);
  return (
    <div className="rb-pager">
      <span className="rb-pager-range">
        {from}–{to} of {total}
      </span>
      <div className="rb-pager-pages">
        <button className="rb-pager-btn" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}>
          <Icon name="chevron-left" />
        </button>
        {pageWindow(page, pages).map((p, i) =>
          p === null ? (
            <span key={`gap${i}`} className="rb-pager-gap">…</span>
          ) : (
            <button key={p} className={p === page ? 'rb-pager-btn rb-active' : 'rb-pager-btn'} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}>
              {p + 1}
            </button>
          ),
        )}
        <button className="rb-pager-btn" aria-label="Next page" disabled={page === pages - 1} onClick={() => onPage(page + 1)}>
          <Icon name="chevron-right" />
        </button>
      </div>
    </div>
  );
}

export function ViewMore({ more, remaining }: { more: (() => void) | null; remaining: number }) {
  if (!more) return null;
  return (
    <button className="rb-view-more" onClick={more}>
      View More ({remaining})
    </button>
  );
}

/** An element's content width, tracked with a ResizeObserver. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * A virtualizer for a list that lives somewhere inside the board's scrolling
 * body (possibly below other sections). Only rows near the viewport are
 * rendered. `scrollMargin` — the list's offset within the scroll content — is
 * re-measured whenever the content above it changes size.
 */
export function useBodyVirtualizer(opts: {
  count: number;
  estimateSize: number;
  lanes?: number;
  gap?: number;
}): { listRef: RefObject<HTMLDivElement | null>; virtualizer: Virtualizer<HTMLDivElement, Element>; offset: (start: number) => number } {
  const { scrollRef } = useBoardContext();
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    const scroll = scrollRef.current;
    if (!list || !scroll) return;
    const measure = (): void => {
      const m = list.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
      setMargin((prev) => (Math.abs(prev - m) > 0.5 ? m : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroll.firstElementChild ?? scroll);
    return () => ro.disconnect();
  }, [scrollRef]);

  const estimate = opts.estimateSize;
  const virtualizer = useVirtualizer({
    count: opts.count,
    getScrollElement: () => scrollRef.current,
    // The body is shared (e.g. a group opened mid-scroll): start where it is, not at 0.
    initialOffset: () => scrollRef.current?.scrollTop ?? 0,
    estimateSize: useCallback(() => estimate, [estimate]),
    overscan: 6,
    scrollMargin: margin,
    lanes: opts.lanes ?? 1,
    gap: opts.gap ?? 0,
  });

  // Item positions are relative to the scroll content; convert to the list.
  const offset = useCallback((start: number) => start - virtualizer.options.scrollMargin, [virtualizer]);
  return { listRef, virtualizer, offset };
}
