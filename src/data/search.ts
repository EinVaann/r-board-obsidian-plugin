import type { BoardItem, PropertyConfig } from '../types';
import { fieldSearchText } from '../render/values';

/**
 * Filter items by a search query: matches the title plus any `searchable`
 * property (or, if none opt in, all visible text/multi/links properties).
 */
export function filterBySearch(
  items: BoardItem[],
  properties: PropertyConfig[],
  query: string,
): BoardItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') return items;

  const explicit = properties.filter((p) => p.searchable);
  const searchProps =
    explicit.length > 0
      ? explicit
      : properties.filter((p) => ['text', 'multi', 'links', 'select', 'url', 'formula'].includes(p.type));

  return items.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    return searchProps.some((p) => fieldSearchText(item, p).includes(q));
  });
}
