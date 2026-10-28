/** Test data for the e2e harness: `.table` files and `.board` configs with known contents. */

type Json = Record<string, unknown>;

export const SHOP_PROPERTIES = [
  { name: 'item', label: 'Item', type: 'text' },
  {
    name: 'kind',
    label: 'Kind',
    type: 'select',
    options: [
      { value: 'food', label: 'Food', color: '#a3c9a8' },
      { value: 'fuel', label: 'Fuel', color: '#e3c88f' },
      { value: 'fun', label: 'Fun' },
    ],
  },
  { name: 'price', label: 'Price', type: 'number' },
  { name: 'qty', label: 'Qty', type: 'number' },
  { name: 'total', label: 'Total', type: 'formula', formula: '{Price} * {Qty}' },
  { name: 'paid', label: 'Paid', type: 'checkbox' },
  { name: 'tags', label: 'Tags', type: 'multi', options: [{ value: 'need' }, { value: 'want' }] },
  { name: 'date', label: 'Date', type: 'date' },
];

export const SHOP_ROWS = [
  { id: 'r1', cells: { item: 'Apples', kind: 'food', price: 2, qty: 3, paid: true, tags: ['need'], date: '2026-10-01' } },
  { id: 'r2', cells: { item: 'Gas', kind: 'fuel', price: 50, qty: 1, paid: false, date: '2026-10-03' } },
  { id: 'r3', cells: { item: 'Bread', kind: 'food', price: 3, qty: 2, paid: true, tags: ['need'], date: '2026-10-05' } },
  { id: 'r4', cells: { item: 'Cinema', kind: 'fun', price: 12, qty: 2, paid: false, tags: ['want'], date: '2026-10-09' } },
  { id: 'r5', cells: { item: 'Notebook', price: 4, qty: 1 } },
];

/** A `.table` file in R Board's own format. */
export function tableFile(opts: { views?: Json[]; rows?: Json[]; properties?: Json[]; titleProperty?: string } = {}): string {
  return JSON.stringify({
    version: 1,
    kind: 'table',
    titleProperty: opts.titleProperty ?? 'item',
    properties: opts.properties ?? SHOP_PROPERTIES,
    views: opts.views ?? [{ name: 'Rows', type: 'table', limit: 'none', sort: { property: '$none', dir: 'asc' } }],
    rows: opts.rows ?? SHOP_ROWS,
  });
}

/** `n` generated rows, for scrolling, virtualization and paging. */
export function manyRows(n: number): Json[] {
  const kinds = ['food', 'fuel', 'fun'];
  return Array.from({ length: n }, (_, i) => ({
    id: `g${i}`,
    cells: { item: `Row ${String(i).padStart(3, '0')}`, kind: kinds[i % 3], price: i, qty: (i % 4) + 1, paid: i % 2 === 0 },
  }));
}

/** Six game notes tagged #backlog, as the board harness's vault. */
export const GAME_NOTES: Record<string, Json> = {
  'Games/Hades.md': { tags: ['backlog'], status: 'playing', score: 9, genre: ['roguelike', 'action'], owned: true },
  'Games/Celeste.md': { tags: ['backlog'], status: 'to-play', score: 8.5, genre: ['platformer'], owned: true },
  'Games/Outer Wilds.md': { tags: ['backlog'], status: 'completed', score: 10, genre: ['exploration'] },
  'Games/Hollow Knight.md': { tags: ['backlog'], status: 'playing', score: 9.5, genre: ['metroidvania', 'action'] },
  'Games/Stardew Valley.md': { tags: ['backlog'], status: 'on-hold', score: 7, genre: ['farming'] },
  'Games/Disco Elysium.md': { tags: ['backlog'], status: 'to-play', genre: ['rpg'] },
};

export const GAME_PROPERTIES = [
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { value: 'to-play', label: 'To Play' },
      { value: 'playing', label: 'Playing' },
      { value: 'completed', label: 'Completed' },
      { value: 'on-hold', label: 'On Hold' },
    ],
  },
  { name: 'score', label: 'Score', type: 'number', render: 'stars', max: 10 },
  { name: 'genre', label: 'Genre', type: 'multi', render: 'pills' },
  { name: 'owned', label: 'Owned', type: 'checkbox' },
];

export function boardConfig(views: Json[], extra: Json = {}): Json {
  return { name: 'Backlog', sourceTag: 'backlog', newNoteFolder: 'Games', properties: GAME_PROPERTIES, views, ...extra };
}
