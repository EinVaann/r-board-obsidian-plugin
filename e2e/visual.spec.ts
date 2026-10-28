/**
 * Screenshot tests: each compares against e2e/__screenshots__. After an intended
 * visual change, refresh them with `npm run e2e -- --update-snapshots` and review the diff.
 */
import { expect, test, type Page } from '@playwright/test';
import { cell, open, pageErrors } from './harness';
import { boardConfig, GAME_NOTES, tableFile } from './fixtures';

test.afterEach(({ page }) => expect(pageErrors(page)).toEqual([]));

/** Let fonts, images and chart animations settle. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

const shot = async (page: Page, name: string): Promise<void> => {
  await settle(page);
  await expect(page).toHaveScreenshot(name);
};

const chart = (over: Record<string, unknown>) => ({
  type: 'bar', x: 'kind', dateBucket: 'none', splitBy: null, values: ['price'], aggregate: 'sum',
  stacked: false, horizontal: false, sort: 'x', showLegend: true, showLabels: true, colors: {}, ...over,
});

test.describe('table', () => {
  test('plain table', async ({ page }) => {
    await open(page, { fixture: { table: tableFile() } });
    await shot(page, 'table.png');
  });

  test('selection range and an open editor', async ({ page }) => {
    await open(page, { fixture: { table: tableFile() } });
    await cell(page, 0, 2).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    await cell(page, 3, 1).dblclick();
    await shot(page, 'table-editing.png');
  });

  test('grouped with summary rows and a collapsed group', async ({ page }) => {
    const views = [{ name: 'Rows', type: 'table', limit: 'none', group: 'kind', summary: true, calculations: { price: 'sum', qty: 'avg', paid: 'checked' }, collapsed: ['fuel'] }];
    await open(page, { fixture: { table: tableFile({ views }) } });
    await shot(page, 'table-grouped-summary.png');
  });

  test('numbered pages', async ({ page }) => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, cells: { item: `Row ${i}`, price: i, qty: 1 } }));
    await open(page, { fixture: { table: tableFile({ rows, views: [{ name: 'Rows', type: 'table', limit: 10, paging: 'pages' }] }) } });
    await shot(page, 'table-pages.png');
  });

  test('empty table', async ({ page }) => {
    await open(page, { fixture: { table: tableFile({ rows: [] }) } });
    await shot(page, 'table-empty.png');
  });
});

test.describe('board views', () => {
  test('kanban', async ({ page }) => {
    await open(page, { kind: 'board', fixture: { board: boardConfig([{ name: 'Board', type: 'kanban', group: 'status', sort: { property: 'score', dir: 'desc' } }]), notes: GAME_NOTES } });
    await shot(page, 'kanban.png');
  });

  test('kanban swimlanes', async ({ page }) => {
    await open(page, { kind: 'board', fixture: { board: boardConfig([{ name: 'Lanes', type: 'kanban', group: 'status', subGroup: 'owned', cardSize: 'small' }]), notes: GAME_NOTES } });
    await shot(page, 'kanban-lanes.png');
  });

  test('gallery grid with sections', async ({ page }) => {
    await open(page, { kind: 'board', fixture: { board: boardConfig([{ name: 'Grid', type: 'gallery', layout: 'grid', limit: 'none', group: 'status' }]), notes: GAME_NOTES } });
    await shot(page, 'gallery.png');
  });

  test('split view: table beside kanban', async ({ page }) => {
    const views = [
      { name: 'Rows', type: 'table', limit: 'none', companion: { view: 'Lanes', position: 'right', size: 45, followFilter: false } },
      { name: 'Lanes', type: 'kanban', group: 'kind', cardSize: 'small' },
    ];
    await open(page, { fixture: { table: tableFile({ views }) } });
    await shot(page, 'split-view.png');
  });
});

test.describe('charts', () => {
  for (const [name, over] of [
    ['bar', {}],
    ['stacked-bar', { x: 'date', dateBucket: 'day', splitBy: 'kind', stacked: true, showLabels: false }],
    ['donut', { type: 'donut' }],
    ['line', { type: 'line', x: 'date', dateBucket: 'day' }],
  ] as const) {
    test(name, async ({ page }) => {
      await open(page, { fixture: { table: tableFile({ views: [{ name: 'Chart', type: 'chart', chart: chart(over) }] }) } });
      await shot(page, `chart-${name}.png`);
    });
  }
});

test.describe('dialogs and menus', () => {
  test('view settings', async ({ page }) => {
    await open(page, { fixture: { table: tableFile() } });
    await page.getByLabel('View settings').click();
    await shot(page, 'view-settings.png');
  });

  test('table settings: columns', async ({ page }) => {
    await open(page, { fixture: { table: tableFile() } });
    await page.getByLabel('Board settings').click();
    await page.locator('.rb-settings-tab').nth(1).click();
    await shot(page, 'table-settings-columns.png');
  });

  test('filter builder with a nested group', async ({ page }) => {
    const filter = {
      conjunction: 'and',
      conditions: [
        { property: 'price', op: 'gt', value: 2 },
        { conjunction: 'or', conditions: [{ property: 'kind', op: 'eq', value: 'food' }, { property: 'paid', op: 'checked' }] },
      ],
    };
    await open(page, { fixture: { table: tableFile({ views: [{ name: 'Rows', type: 'table', limit: 'none', filter }] }) } });
    await page.locator('.rb-chip', { hasText: 'Filter' }).click();
    await shot(page, 'filter-builder.png');
  });

  test('record editor', async ({ page }) => {
    await open(page, { fixture: { table: tableFile() } });
    await cell(page, 0, 0).hover();
    await cell(page, 0, 0).getByLabel('Expand row').click();
    await shot(page, 'record-editor.png');
  });

  test('row context menu', async ({ page }) => {
    await open(page, { fixture: { table: tableFile() } });
    await cell(page, 1, 2).click({ button: 'right' });
    await shot(page, 'row-menu.png');
  });
});

test.describe('narrow window', () => {
  test.use({ viewport: { width: 480, height: 760 } });

  test('compact toolbar and a sideways-scrolling table', async ({ page }) => {
    await open(page, { fixture: { table: tableFile() } });
    await shot(page, 'narrow-table.png');
  });
});
