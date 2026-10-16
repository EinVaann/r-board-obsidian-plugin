// @vitest-environment happy-dom
/**
 * Smoke tests for the React UI: render every view type and every settings tab
 * against a mock vault, and check the content that should appear. Catches
 * runtime failures (hook order, missing context, bad props) the type checker
 * can't see.
 */
import { act, createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { DatabaseConfig } from '../types';
import { createBoardStore, type BoardStore } from '../board/store';
import { BoardContext, type BoardContextValue } from '../board/context';
import { BoardApp } from '../board/BoardApp';
import { mountReact } from '../react/mount';
import { BoardSettings } from '../settings/BoardSettings';
import { ViewSettings } from '../settings/ViewSettings';
import { FilterBuilder } from '../settings/FilterBuilder';
import { openWizard } from '../settings/Wizard';
import { setProperty } from '../data/properties';
import { addRow, deleteRows, duplicateRow, setCell } from '../table/rows';
import type { TableRow } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout: give elements a size so virtualized lists render rows.
beforeAll(() => {
  const size = { width: 900, height: 700 };
  // Virtualized items (they carry data-index): gallery cards 300px, table rows 40px.
  const rowAware = (value: number) =>
    function (this: HTMLElement) {
      if (!this.hasAttribute('data-index')) return value;
      return this.classList.contains('rb-vitem') ? 300 : 40;
    };
  // Toolbar pieces: tabs 100px, the + button 32px, the tools 150px.
  const toolbarAware = (value: number) =>
    function (this: HTMLElement) {
      if (this.classList.contains('rb-view-btn')) return 100;
      if (this.classList.contains('rb-view-add-wrap')) return 32;
      if (this.classList.contains('rb-tools')) return 150;
      return value;
    };
  for (const [prop, get] of [
    ['clientWidth', () => size.width],
    ['clientHeight', rowAware(size.height)],
    ['offsetWidth', toolbarAware(size.width)],
    ['offsetHeight', rowAware(size.height)],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get });
  }
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const height = this.hasAttribute('data-index') ? 40 : size.height;
    return { x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: height, width: size.width, height, toJSON() {} } as DOMRect;
  };
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

// --- Mock vault ---------------------------------------------------------------

/** The mock TFile takes a path (the real one has no public constructor). */
const mkFile = (path: string): TFile => new (TFile as unknown as new (p: string) => TFile)(path);

const STATUSES = ['to-play', 'playing', 'completed', 'on-hold', 'dropped'];
const frontmatter: Record<string, Record<string, unknown>> = {};
const files: TFile[] = [];
for (let i = 0; i < 40; i++) {
  const file = mkFile(`Games/Game ${i}.md`);
  files.push(file);
  frontmatter[file.path] = {
    tags: ['backlog'],
    cover: '[[cover.png]]',
    genre: i % 2 ? ['rpg', 'action'] : ['puzzle'],
    status: STATUSES[i % STATUSES.length],
    rating: (i % 5) + 0.5,
    score: i * 2,
    finished: i % 3 === 0,
    related: ['[[Game 1]]', 'https://example.com'],
  };
}
const recipe = mkFile('Recipes/Pancakes.md');
files.push(recipe);
frontmatter[recipe.path] = { tags: ['recipe'], time: 20 };
const cover = mkFile('cover.png');

const RECIPE_NOTE = '---\ntags: [recipe]\n---\n```recipe\nportions: 2\ningredients:\n  - 200 g flour\n  - {abc:linear} broken\nsteps:\n  - Rest for {10 min:const}.\n```\n';

const app = {
  vault: {
    getMarkdownFiles: () => files,
    cachedRead: async (f: TFile) => (f === recipe ? RECIPE_NOTE : `---\ntags: [backlog]\n---\nBody of ${f.basename}`),
    getResourcePath: (f: TFile) => `app://local/${f.path}`,
  },
  metadataCache: {
    getFileCache: (f: TFile) => ({ frontmatter: frontmatter[f.path] }),
    getFirstLinkpathDest: (lp: string) => (lp === 'cover.png' ? cover : files.find((f) => f.basename === lp) ?? null),
  },
  workspace: { openLinkText: async () => {} },
  fileManager: {
    processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
      const next = { ...frontmatter[f.path] };
      fn(next);
      frontmatter[f.path] = next;
    },
  },
} as unknown as App;

/** A `.table` database: rows stored in the file, a formula, a select. */
const TABLE: DatabaseConfig = {
  kind: 'table',
  sourceTag: '',
  titleProperty: 'item',
  properties: [
    { name: 'item', label: 'Item', type: 'text' },
    { name: 'kind', label: 'Kind', type: 'select', options: [{ value: 'k1', label: 'Food', color: '#ff0000' }, { value: 'k2', label: 'Fuel' }] },
    { name: 'price', label: 'Price', type: 'number' },
    { name: 'qty', label: 'Qty', type: 'number' },
    { name: 'total', label: 'Total', type: 'formula', formula: '{Price} * {Qty}' },
  ],
  views: [
    { name: 'Rows', type: 'table', limit: 'none', sort: { property: '$none', dir: 'asc' } },
    { name: 'Lanes', type: 'kanban', group: 'kind' },
  ],
};
const TABLE_ROWS: TableRow[] = [
  { id: 'r1', cells: { item: 'Apples', kind: 'k1', price: 2, qty: 3 } },
  { id: 'r2', cells: { item: 'Gas', kind: 'k2', price: 50, qty: 1, total: '=99' } },
  { id: 'r3', cells: { item: 'Bread', price: 3 } },
];

const GAMES: DatabaseConfig = {
  name: 'Games',
  sourceTag: 'backlog',
  properties: [
    { name: 'cover', type: 'image', render: 'fill' },
    { name: 'genre', type: 'multi', render: 'pills' },
    { name: 'status', type: 'text', render: 'badge' },
    { name: 'rating', type: 'number', render: 'stars', max: 5 },
    { name: 'score', type: 'number', render: 'circle', max: 100 },
    { name: 'finished', type: 'checkbox', render: 'toggle' },
    { name: 'related', type: 'links', render: 'pills' },
  ],
  views: [
    { name: 'Masonry', type: 'gallery', limit: 'none', showContent: true },
    { name: 'Grid', type: 'gallery', layout: 'grid', limit: 10, group: 'status' },
    { name: 'Board', type: 'kanban', limit: 'none', group: 'status', columns: ['to-play', 'playing'], groupConfig: { playing: { label: 'Now', color: '#f00' } } },
    { name: 'Table', type: 'table', limit: 50, sort: { property: 'score', dir: 'desc' } },
    {
      name: 'Filtered',
      type: 'table',
      limit: 'none',
      filter: { conjunction: 'and', conditions: [{ property: 'rating', op: 'gte', value: 4 }, { conjunction: 'or', conditions: [{ property: 'genre', op: 'contains', value: 'rpg' }] }] },
    },
  ],
};

const RECIPES: DatabaseConfig = {
  name: 'Recipes',
  sourceTag: 'recipe',
  properties: [{ name: 'time', type: 'number', render: 'text', suffix: ' min' }],
  views: [{ name: 'Recipes', type: 'recipe', limit: 'none' }],
};

// --- Harness ------------------------------------------------------------------

let cleanup: (() => void)[] = [];
afterEach(() => {
  act(() => cleanup.forEach((fn) => fn()));
  cleanup = [];
  document.body.innerHTML = '';
});

function makeContext(config: DatabaseConfig, rows: TableRow[] = []): { ctx: BoardContextValue; store: BoardStore; saved: DatabaseConfig[] } {
  const saved: DatabaseConfig[] = [];
  const store = createBoardStore({ saveConfig: (c) => saved.push(c), saveActiveView: () => {} });
  store.getState().loadRows(structuredClone(rows));
  store.getState().loadConfig(structuredClone(config), null);
  const noop = (): void => {};
  const ctx: BoardContextValue = {
    app,
    store,
    boardFile: mkFile('Games.board'),
    scrollRef: createRef<HTMLDivElement>(),
    actions: {
      editFile: noop,
      openNote: noop,
      openBoardSettings: noop,
      openViewSettings: noop,
      openFilter: noop,
      createNewNote: noop,
      openSetup: noop,
      reportItems: noop,
      editItem: noop,
      addRow: (cells, after) => {
        if (store.getState().config?.kind !== 'table') return null;
        let id = '';
        store.getState().updateRows((rows) => void (id = addRow(rows, cells, after)));
        return id;
      },
      deleteRows: (ids) => store.getState().updateRows((rows) => deleteRows(rows, ids)),
      duplicateRow: (id) => store.getState().updateRows((rows) => void duplicateRow(rows, id)),
      setValue: async (item, prop, value) => {
        if (item.file) return setProperty(app, item.file, prop, value);
        store.getState().updateRows((rows) => setCell(rows, item.id, prop, value));
      },
    },
  };
  return { ctx, store, saved };
}

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const el = document.body.createDiv();
  await act(async () => {
    cleanup.push(mountReact(app, el, node));
  });
  // Let async effects (excerpts, recipe reads) settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return el;
}

async function renderBoard(config: DatabaseConfig, rows?: TableRow[]) {
  const { ctx, store, saved } = makeContext(config, rows);
  const el = await render(
    <BoardContext.Provider value={ctx}>
      <BoardApp />
    </BoardContext.Provider>,
  );
  const show = async (view: string): Promise<void> => {
    await act(async () => store.getState().setActiveView(view));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  };
  return { el, store, saved, show, ctx };
}

const count = (el: HTMLElement, sel: string): number => el.querySelectorAll(sel).length;

// --- Tests --------------------------------------------------------------------

describe('board views', () => {
  it('shows up to three view tabs (fewer if they do not fit); the rest go in a dropdown', async () => {
    const setWidth = (w: number): void => {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => w });
    };
    const wide = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!;
    try {
      // 900px: room for all five, but capped at three + "2 more".
      let { el, show } = await renderBoard(GAMES);
      expect(count(el, '.rb-view-switch > .rb-view-btn:not(.rb-view-more-btn)')).toBe(3);
      expect(el.querySelector('.rb-view-more-btn')?.textContent).toBe('2 more');
      act(() => cleanup.splice(0).forEach((fn) => fn()));

      // Three views or fewer: all tabs, no dropdown.
      ({ el } = await renderBoard({ ...GAMES, views: GAMES.views.slice(0, 3) }));
      expect(count(el, '.rb-view-switch > .rb-view-btn:not(.rb-view-more-btn)')).toBe(3);
      expect(el.querySelector('.rb-view-more-btn')).toBeNull();
      act(() => cleanup.splice(0).forEach((fn) => fn()));

      // 600px: 600 - 150 tools - 16 gaps - 32 + = 402 → two tabs + "3 more" dropdown.
      setWidth(600);
      ({ el, show } = await renderBoard(GAMES));
      expect(count(el, '.rb-view-switch > .rb-view-btn:not(.rb-view-more-btn)')).toBe(2);
      expect(el.querySelector('.rb-view-more-btn')?.textContent).toBe('3 more');
      // A hidden active view shows (highlighted) on the dropdown button.
      await show('Filtered');
      expect(el.querySelector('.rb-view-more-btn.rb-active')?.textContent).toBe('Filtered');
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', wide);
    }
  });

  it('masonry gallery: virtualized cards with every field type and excerpts', async () => {
    const { el } = await renderBoard(GAMES);
    const cards = count(el, '.rb-gallery-card');
    expect(cards).toBeGreaterThan(0);
    expect(cards).toBeLessThan(40); // virtualized: not all 40 in the DOM
    expect(el.querySelector('.rb-img img')?.getAttribute('src')).toBe('app://local/cover.png');
    expect(count(el, '.rb-stars')).toBeGreaterThan(0);
    expect(count(el, '.rb-circle svg')).toBeGreaterThan(0);
    expect(count(el, '.rb-toggle')).toBeGreaterThan(0);
    expect(count(el, '.rb-link-pill')).toBeGreaterThan(0);
    expect(el.querySelector('.rb-card-content')?.textContent).toContain('Body of');
  });

  it('grid gallery: grouped sections with paging', async () => {
    const { el, show, store } = await renderBoard(GAMES);
    await show('Grid');
    expect(count(el, '.rb-section')).toBe(STATUSES.length);
    expect(count(el, '.rb-vgrid-row')).toBeGreaterThan(0);
    // Collapsing a section hides its cards.
    const before = count(el, '.rb-gallery-card');
    await act(async () => store.getState().toggleCollapsed('to-play'));
    expect(count(el, '.rb-gallery-card')).toBeLessThan(before);
  });

  it('kanban: pinned columns first, labels, every card', async () => {
    const { el, show } = await renderBoard(GAMES);
    await show('Board');
    const titles = [...el.querySelectorAll('.rb-kanban-title')].map((t) => t.textContent);
    expect(titles.slice(0, 2)).toEqual(['to-play', 'Now']);
    expect(titles).toHaveLength(STATUSES.length);
    expect(count(el, '.rb-kanban-card')).toBe(40);
    expect(count(el, '.rb-kanban-add')).toBe(1);
  });

  it('kanban on mobile: no drag handles, no top scrollbar, menu button stays', async () => {
    const platform = (await import('obsidian')).Platform as unknown as { isMobile: boolean };
    platform.isMobile = true;
    try {
      const { el, show } = await renderBoard(GAMES);
      await show('Board');
      expect(count(el, '.rb-kanban-card')).toBe(40);
      expect(el.querySelector('.rb-kanban-scrolltop')).toBeNull();
      expect(count(el, '.rb-kanban-header.rb-draggable')).toBe(0);
      expect(el.querySelector('.rb-kanban-card-slot')?.getAttribute('role')).toBeNull();
      expect(count(el, '.rb-card-menu')).toBe(40);
    } finally {
      platform.isMobile = false;
    }
  });

  it('table: header per property, sorted rows, sort toggles', async () => {
    const { el, show, store } = await renderBoard(GAMES);
    await show('Table');
    expect(count(el, 'th')).toBe(GAMES.properties.length + 1);
    expect(el.querySelector('th .rb-sort-ind')?.textContent).toContain('▼');
    expect(el.querySelector('.rb-tr .rb-title')?.textContent).toBe('Game 39'); // highest score first
    const scoreTh = [...el.querySelectorAll('th')].find((th) => th.textContent?.startsWith('score'))!;
    await act(async () => scoreTh.click());
    expect(store.getState().config!.views[3].sort).toEqual({ property: 'score', dir: 'asc' });
  });

  it('compact toolbar below 560px: a single view dropdown, filter count kept', async () => {
    const wide = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 390 });
    try {
      const { el, show } = await renderBoard(GAMES);
      expect(el.querySelector('.rb-toolbar.rb-compact')).not.toBeNull();
      expect(count(el, '.rb-view-switch > .rb-view-btn:not(.rb-view-more-btn)')).toBe(0);
      expect(el.querySelector('.rb-view-more-btn')?.textContent).toBe('Masonry');
      await show('Filtered');
      expect(el.querySelector('.rb-chip-badge')?.textContent).toBe('2');
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', wide);
    }
  });

  it('table with paging = pages: numbered pages instead of View More', async () => {
    const paged: DatabaseConfig = { ...GAMES, views: [{ name: 'Paged', type: 'table', limit: 10, paging: 'pages', sort: { property: 'score', dir: 'desc' } }] };
    const { el, store } = await renderBoard(paged);
    expect(el.querySelector('.rb-view-more')).toBeNull();
    expect(el.querySelector('.rb-pager-range')?.textContent).toBe('1–10 of 40');
    expect(count(el, '.rb-tr')).toBe(10);
    expect(el.querySelector('.rb-tr .rb-title')?.textContent).toBe('Game 39');
    // On page 1 of 4 the numbers read "1 2 … 4"; jump to the last page (rows 31–40).
    const buttons = (): string[] => [...el.querySelectorAll('.rb-pager-pages > *')].map((b) => b.textContent ?? '');
    expect(buttons()).toEqual(['', '1', '2', '…', '4', '']);
    const last = [...el.querySelectorAll<HTMLButtonElement>('.rb-pager-btn')].find((b) => b.textContent === '4')!;
    await act(async () => last.click());
    expect(el.querySelector('.rb-pager-range')?.textContent).toBe('31–40 of 40');
    expect(el.querySelector('.rb-tr .rb-title')?.textContent).toBe('Game 9');
    expect(el.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.disabled).toBe(true);
    // A search that shrinks the list clamps back to its last page.
    await act(async () => store.getState().setSearch('Game 3'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // 11 matches = 2 pages; page 4 no longer exists, so it shows page 2 (Game 3 alone).
    expect(el.querySelector('.rb-pager-range')?.textContent).toBe('11–11 of 11');
    expect(el.querySelector('.rb-tr .rb-title')?.textContent).toBe('Game 3');
  });

  it('table as the first view renders rows on the very first render', async () => {
    // Regression: the virtualizer looked for the scroll body before React had
    // attached it, and rendered no rows until something else re-rendered.
    const { el } = await renderBoard({ ...GAMES, views: [GAMES.views[3]] });
    expect(count(el, '.rb-tr')).toBeGreaterThan(0);
  });

  it('table: nested filter narrows rows', async () => {
    const { el, show } = await renderBoard(GAMES);
    await show('Filtered');
    const rows = count(el, '.rb-tr');
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(40);
  });

  it('search narrows the view, and an impossible search shows the empty state', async () => {
    const { el, show, store } = await renderBoard(GAMES);
    await show('Table');
    await act(async () => store.getState().setSearch('Game 3'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(count(el, '.rb-tr')).toBe(1 + 10); // Game 3, Game 30–39
    await act(async () => store.getState().setSearch('zzz-no-match'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(el.querySelector('.rb-empty-state')?.textContent).toContain('hidden by the current search');
  });

  it('recipe view: interactive recipe with scaling and a broken-token warning', async () => {
    const { el } = await renderBoard(RECIPES);
    expect(el.querySelector('.rb-recipe-count')?.textContent).toBe('2');
    // The leading number scales; the unit stays part of the name.
    expect(el.querySelector('.rb-recipe-amt')?.textContent).toBe('200');
    expect(el.querySelector('.rb-recipe-name')?.textContent).toBe('g flour');
    expect(count(el, '.rb-token-error')).toBeGreaterThan(0);
    const plus = el.querySelector<HTMLButtonElement>('[aria-label="more portions"]')!;
    await act(async () => plus.click());
    expect(el.querySelector('.rb-recipe-count')?.textContent).toBe('3');
    expect(el.querySelector('.rb-recipe-amt')?.textContent).toBe('300');
  });

  it('shows the setup prompt for an unconfigured board', async () => {
    const { ctx, store } = makeContext(GAMES);
    store.getState().loadConfig(null, 'Unexpected token');
    const el = await render(
      <BoardContext.Provider value={ctx}>
        <BoardApp />
      </BoardContext.Provider>,
    );
    expect(el.querySelector('.rb-setup-error')?.textContent).toBe('Unexpected token');
  });
});

describe('settings', () => {
  const mousedown = (el: Element): void => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  };

  it('view settings: all tabs render; edits reach the store; rename keeps the view active', async () => {
    const { ctx, store, saved } = makeContext(GAMES);
    store.getState().setActiveView('Board');
    const el = await render(
      <BoardContext.Provider value={ctx}>
        <ViewSettings viewIndex={2} onDelete={() => {}} />
      </BoardContext.Provider>,
    );
    const tabs = [...el.querySelectorAll('.rb-settings-tab')].map((t) => t.textContent);
    expect(tabs).toEqual(['General', 'Display', 'Columns']);

    // Rename through the Name input.
    const name = el.querySelector<HTMLInputElement>('.setting-item input[type="text"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(name, 'Kanban!');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(store.getState().config!.views[2].name).toBe('Kanban!');
    expect(store.getState().activeView).toBe('Kanban!');
    expect(saved.length).toBeGreaterThan(0);

    // Display tab: a sortable row per property with a visibility toggle.
    await act(async () => mousedown(el.querySelectorAll('.rb-settings-tab')[1]));
    expect(count(el, '.rb-vis-row')).toBe(GAMES.properties.length);
    await act(async () => el.querySelector<HTMLButtonElement>('.rb-vis-toggle')!.click());
    expect(store.getState().config!.views[2].properties).not.toContain('cover');

    // Columns tab: pinned columns with label inputs and switches.
    await act(async () => mousedown(el.querySelectorAll('.rb-settings-tab')[2]));
    expect(count(el, '.rb-col-config-row')).toBe(2);
    expect(count(el, '.rb-switch')).toBe(2);
  });

  it('board settings: general + property editor (expand, edit, add)', async () => {
    const { ctx, store } = makeContext(GAMES);
    const el = await render(
      <BoardContext.Provider value={ctx}>
        <BoardSettings />
      </BoardContext.Provider>,
    );
    await act(async () => mousedown(el.querySelectorAll('.rb-settings-tab')[1]));
    expect(count(el, '.rb-prop-card')).toBe(GAMES.properties.length);

    await act(async () => el.querySelector<HTMLButtonElement>('.rb-prop-expand')!.click());
    expect(count(el, '.rb-prop-body:not([hidden])')).toBe(1);
    expect(count(el, '.rb-segment')).toBe(2); // image: fill / fit

    await act(async () => el.querySelector<HTMLButtonElement>('.rb-prop-add')!.click());
    expect(store.getState().config!.properties).toHaveLength(GAMES.properties.length + 1);
    expect(count(el, '.rb-prop-name.rb-invalid')).toBe(1);
  });

  it('filter builder: renders nested groups and saves edits', async () => {
    let saved: unknown = 'unset';
    const el = await render(
      <FilterBuilder initial={GAMES.views[4].filter} properties={GAMES.properties} onSave={(g) => (saved = g)} onClose={() => {}} />,
    );
    expect(count(el, '.rb-filter-group-box')).toBe(1);
    expect(count(el, '.rb-filter-rule')).toBe(2);
    // The conjunction picker sits on a group's 2nd condition.
    const conj = el.querySelector<HTMLSelectElement>('.rb-filter-conj')!;
    expect(conj.value).toBe('and');
    await act(async () => {
      conj.value = 'or';
      conj.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect((saved as { conjunction: string }).conjunction).toBe('or');
    await act(async () => el.querySelector<HTMLButtonElement>('.rb-filter-delete')!.click());
    expect(saved).toBeUndefined();
  });

  describe('on phones', () => {
    let platform: { isPhone: boolean };
    beforeAll(async () => {
      platform = (await import('obsidian')).Platform as unknown as { isPhone: boolean };
    });
    afterEach(() => {
      platform.isPhone = false;
    });

    it('modals open as bottom sheets with a grab handle; a long swipe down closes them', async () => {
      platform.isPhone = true;
      await act(async () => openWizard(app, {}, 'Create database', () => {}));
      const container = document.querySelector('.rb-sheet-container')!;
      const sheet = container.querySelector<HTMLElement>('.modal, .rb-sheet')!;
      expect(sheet.classList.contains('rb-sheet')).toBe(true);
      const handle = sheet.querySelector<HTMLElement>('.rb-sheet-handle')!;
      expect(handle).not.toBeNull();

      // A short, slow drag springs back; a long one dismisses. (A fast flick
      // dismisses too, so the short drag takes its time like a real finger.)
      handle.setPointerCapture = () => {};
      const drag = async (to: number, ms: number): Promise<void> => {
        handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 0, pointerId: 1 }));
        handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: to, pointerId: 1 }));
        await new Promise((r) => setTimeout(r, ms));
        handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: to, pointerId: 1 }));
      };
      await drag(40, 200);
      expect(sheet.style.transform).toBe('');
      expect(document.querySelector('.rb-sheet-container')).not.toBeNull();
      await act(async () => {
        await drag(300, 0);
        await new Promise((r) => setTimeout(r, 250));
      });
      expect(document.querySelector('.rb-sheet-container')).toBeNull();
    });

    it('not on desktop: no sheet classes', async () => {
      await act(async () => openWizard(app, {}, 'Create database', () => {}));
      expect(document.querySelector('.rb-sheet')).toBeNull();
    });

    it('property rows: type and remove move from the header into the expanded body', async () => {
      platform.isPhone = true;
      const { ctx } = makeContext(GAMES);
      const el = await render(
        <BoardContext.Provider value={ctx}>
          <BoardSettings />
        </BoardContext.Provider>,
      );
      await act(async () => mousedown(el.querySelectorAll('.rb-settings-tab')[1]));
      const head = el.querySelector('.rb-prop-head')!;
      expect(head.querySelector('.rb-prop-type')).toBeNull();
      expect(head.querySelector('.rb-prop-remove')).toBeNull();
      await act(async () => el.querySelector<HTMLButtonElement>('.rb-prop-expand')!.click());
      const body = el.querySelector('.rb-prop-body:not([hidden])')!;
      expect(body.querySelector('.rb-prop-type')).not.toBeNull();
      expect(body.querySelector('.rb-prop-remove-wide')).not.toBeNull();
    });
  });

  it('table settings name columns instead of frontmatter keys and pick a title column', async () => {
    const { ctx } = makeContext(TABLE, TABLE_ROWS);
    const el = await render(
      <BoardContext.Provider value={ctx}>
        <BoardSettings />
      </BoardContext.Provider>,
    );
    expect(el.textContent).toContain('Title column');
    expect(el.textContent).not.toContain('Base tag');
    await act(async () => mousedown(el.querySelectorAll('.rb-settings-tab')[1]));
    const names = [...el.querySelectorAll<HTMLInputElement>('.rb-prop-name')].map((i) => i.value);
    expect(names).toEqual(['Item', 'Kind', 'Price', 'Qty', 'Total']);
  });

  it('wizard opens in a modal and requires a tag', async () => {
    let created: DatabaseConfig | null = null;
    await act(async () => openWizard(app, {}, 'Create database', (c) => (created = c)));
    const create = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Create')!;
    await act(async () => create.click());
    expect(created).toBeNull();
    const { Notice } = await import('obsidian');
    expect((Notice as unknown as { messages: string[] }).messages.at(-1)).toContain('base tag is required');
  });
});

describe('tables', () => {
  it('lists rows in stored order under the title column, with computed formulas', async () => {
    const { el } = await renderBoard(TABLE, TABLE_ROWS);
    expect(el.querySelector('.rb-th')?.textContent).toBe('Item');
    const titles = [...el.querySelectorAll('.rb-tr .rb-title')].map((a) => a.textContent);
    expect(titles).toEqual(['Apples', 'Gas', 'Bread']);
    const totals = [...el.querySelectorAll('.rb-tr')].map((tr) => tr.lastElementChild?.textContent);
    expect(totals).toEqual(['6', '99', '0']);
    expect(el.querySelector('.rb-new-note-label')?.textContent).toBe('New row');
  });

  /** Type into a React-controlled input. */
  const typeInto = (input: HTMLInputElement, value: string): void => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const key = (target: Element, k: string, opts: KeyboardEventInit = {}) =>
    act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts })));
  const cell = (el: HTMLElement, r: number, c: number): HTMLElement => el.querySelector(`[data-pos="${r}:${c}"]`)!;
  const pointer = (target: Element, opts: Record<string, unknown> = {}) =>
    act(async () => void target.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true, ...opts }), { pointerType: 'mouse' })));

  it('edits a cell into the stored rows (double-click, type, Enter)', async () => {
    const { el, store } = await renderBoard(TABLE, TABLE_ROWS);
    const qty = cell(el, 2, 3);
    await act(async () => qty.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    const input = qty.querySelector('input')!;
    await act(async () => typeInto(input, '4'));
    await key(input, 'Enter');
    expect(store.getState().rows[2].cells.qty).toBe(4);
    expect(el.querySelectorAll('.rb-tr')[2].lastElementChild?.textContent).toBe('12');
  });

  it('selects with the pointer, moves with arrows, starts editing by typing, Enter moves down', async () => {
    const { el, store } = await renderBoard(TABLE, TABLE_ROWS);
    const grid = el.querySelector('.rb-grid')!;
    await pointer(cell(el, 0, 2));
    expect(cell(el, 0, 2).classList.contains('rb-cell-active')).toBe(true);
    await key(grid, 'ArrowRight');
    expect(cell(el, 0, 3).classList.contains('rb-cell-active')).toBe(true);
    await key(grid, '9');
    const input = cell(el, 0, 3).querySelector('input')!;
    expect(input.value).toBe('9');
    await key(input, 'Enter');
    expect(store.getState().rows[0].cells.qty).toBe(9);
    expect(cell(el, 1, 3).classList.contains('rb-cell-active')).toBe(true);
    // Shift+arrow extends a range; Delete clears it.
    await key(grid, 'ArrowUp', { shiftKey: true });
    expect(cell(el, 0, 3).classList.contains('rb-cell-active')).toBe(true);
    expect(cell(el, 1, 3).classList.contains('rb-cell-range')).toBe(true);
    await key(grid, 'Delete');
    expect(store.getState().rows.slice(0, 2).map((r) => r.cells.qty)).toEqual([undefined, undefined]);
  });

  it('edits the title column inline, and adds rows that start in edit mode', async () => {
    const { el, store } = await renderBoard(TABLE, TABLE_ROWS);
    await act(async () => el.querySelector<HTMLButtonElement>('.rb-grid-add')!.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(store.getState().rows).toHaveLength(4);
    const input = cell(el, 3, 0).querySelector('input')!;
    await act(async () => typeInto(input, 'Milk'));
    await key(input, 'Enter');
    expect(store.getState().rows[3].cells.item).toBe('Milk');
    expect(cell(el, 3, 0).textContent).toContain('Milk');
  });

  it('kanban groups rows by a select, in option order, with option labels and colors', async () => {
    const { el, show } = await renderBoard(TABLE, TABLE_ROWS);
    await show('Lanes');
    const titles = [...el.querySelectorAll('.rb-kanban-title')].map((t) => t.textContent);
    expect(titles).toEqual(['Food', 'Fuel', 'Uncategorized']);
    expect((el.querySelector('.rb-kanban-title') as HTMLElement).style.getPropertyValue('--gc')).toBe('#ff0000');
  });
});
