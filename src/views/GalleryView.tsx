import type { BoardItem, PropertyConfig, ViewConfig } from '../types';
import { Card } from '../components/Card';
import { Sections, ViewMore, useBodyVirtualizer, useElementWidth, usePaged } from '../components/layout';
import { useRef } from 'react';

/** Card width per size; must match the `--rb-card-w` values in the gallery CSS. */
const CARD_WIDTH = { small: 160, medium: 220, large: 300 } as const;
const GAP = 14;

/**
 * Gallery of cards (masonry or fixed grid). Each card shows the cover image,
 * the title, the remaining visible properties, and optionally an excerpt of
 * the note. When the view sets `group`, items are split into sections.
 * Virtualized: only cards near the viewport are in the DOM.
 */
export function GalleryView({ view, items, properties }: { view: ViewConfig; items: BoardItem[]; properties: PropertyConfig[] }) {
  if (items.length === 0) return <div className="rb-empty">No notes match this view.</div>;

  const groupProp = view.group ? properties.find((p) => p.name === view.group) : undefined;
  const grid = (list: BoardItem[], pageKey: string) => (
    <GalleryList key={pageKey} items={list} pageKey={pageKey} view={view} properties={properties} />
  );
  return groupProp ? (
    <Sections items={items} groupProp={groupProp} view={view} pagePrefix="g">{grid}</Sections>
  ) : (
    grid(items, 'g')
  );
}

interface ListProps {
  items: BoardItem[];
  pageKey: string;
  view: ViewConfig;
  properties: PropertyConfig[];
}

/** Measures the available width, then lays out lanes (masonry) or rows (grid). */
function GalleryList({ items, pageKey, view, properties }: ListProps) {
  const { visible, more, remaining } = usePaged(pageKey, items, view.limit ?? 50);
  const outer = useRef<HTMLDivElement>(null);
  const width = useElementWidth(outer);
  const size = view.cardSize ?? 'medium';
  const cardW = CARD_WIDTH[size];
  const lanes = Math.max(1, Math.floor((width + GAP) / (cardW + GAP)));
  const Layout = (view.layout ?? 'masonry') === 'grid' ? GridLayout : MasonryLayout;

  return (
    <div ref={outer} className={`rb-gallery rb-gallery-virtual rb-size-${size}`}>
      {/* Remount on lane-count change so the virtualizer re-flows cleanly. */}
      {width > 0 && <Layout key={lanes} items={visible} lanes={lanes} width={width} view={view} properties={properties} />}
      <ViewMore more={more} remaining={remaining} />
    </div>
  );
}

interface LayoutProps {
  items: BoardItem[];
  lanes: number;
  width: number;
  view: ViewConfig;
  properties: PropertyConfig[];
}

/** Masonry: each card drops into the shortest lane (TanStack Virtual `lanes`). */
function MasonryLayout({ items, lanes, width, view, properties }: LayoutProps) {
  const laneW = (width - GAP * (lanes - 1)) / lanes;
  const { listRef, virtualizer, offset } = useBodyVirtualizer({
    count: items.length,
    estimateSize: Math.round(laneW * 1.3),
    lanes,
    gap: GAP,
  });

  return (
    <div ref={listRef} className="rb-vlist" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((v) => (
        <div
          key={items[v.index].file.path}
          ref={virtualizer.measureElement}
          data-index={v.index}
          className="rb-vitem"
          style={{ width: laneW, transform: `translate(${v.lane * (laneW + GAP)}px, ${offset(v.start)}px)` }}
        >
          <Card item={items[v.index]} properties={properties} showContent={view.showContent} className="rb-gallery-card" />
        </div>
      ))}
    </div>
  );
}

/** Grid: fixed tiles in rows; each row is one virtual item. */
function GridLayout({ items, lanes, view, properties }: LayoutProps) {
  const rows = Math.ceil(items.length / lanes);
  const { listRef, virtualizer, offset } = useBodyVirtualizer({ count: rows, estimateSize: 320, gap: GAP });

  return (
    <div ref={listRef} className="rb-vlist" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((v) => (
        <div
          key={v.index}
          ref={virtualizer.measureElement}
          data-index={v.index}
          className="rb-vitem rb-vgrid-row"
          style={{ gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))`, transform: `translateY(${offset(v.start)}px)` }}
        >
          {items.slice(v.index * lanes, v.index * lanes + lanes).map((item) => (
            <Card key={item.file.path} item={item} properties={properties} showContent={view.showContent} className="rb-gallery-card" />
          ))}
        </div>
      ))}
    </div>
  );
}
