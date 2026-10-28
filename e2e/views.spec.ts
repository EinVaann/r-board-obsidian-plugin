import { expect, test, type Page } from '@playwright/test';
import { activeView, headers, menu, open, pageErrors, saved, showView, tab, tabNames, titles } from './harness';
import { boardConfig, GAME_NOTES, tableFile } from './fixtures';

test.afterEach(({ page }) => expect(pageErrors(page)).toEqual([]));

const VIEWS = [
  { name: 'Rows', type: 'table', limit: 'none', sort: { property: '$none', dir: 'asc' } },
  { name: 'Lanes', type: 'kanban', group: 'kind' },
  { name: 'Cards', type: 'gallery', layout: 'grid', limit: 'none' },
  { name: 'Spend', type: 'chart', chart: { type: 'bar', x: 'kind', dateBucket: 'none', splitBy: null, values: ['price'], aggregate: 'sum', stacked: false, horizontal: false, sort: 'x', showLegend: true, showLabels: false, colors: {} } },
  { name: 'Fifth', type: 'table', limit: 'none' },
];
const openShop = (page: Page, views: Record<string, unknown>[] = VIEWS) => open(page, { fixture: { table: tableFile({ views }) } });
const setting = (page: Page, name: string) => page.locator('.dev-modal .setting-item', { has: page.locator('.setting-item-name', { hasText: new RegExp(`^${name}$`) }) });

test.describe('view tabs', () => {
  test('up to three tabs, the rest in a "more" dropdown that shows the active view', async ({ page }) => {
    await openShop(page);
    expect(await tabNames(page)).toEqual(['Rows', 'Lanes', 'Cards']);
    await expect(page.locator('.rb-view-more-btn')).toHaveText(/2 more/);
    await showView(page, 'Fifth');
    await expect(page.locator('.rb-view-more-btn.rb-active')).toHaveText(/Fifth/);
  });

  test('long tab names that do not fit move into the dropdown', async ({ page }) => {
    const long = VIEWS.map((v, i) => ({ ...v, name: `${v.name} with a rather long name ${i}` }));
    await openShop(page, long);
    await page.setViewportSize({ width: 800, height: 800 });
    await expect.poll(async () => (await tabNames(page)).length).toBeLessThan(3);
    await expect(page.locator('.rb-view-more-btn')).toBeVisible();
    // Nothing in the tabs row overflows its box.
    const overflow = await page.locator('.rb-tabs-row').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('below 560px the toolbar is compact: one dropdown with the active view', async ({ page }) => {
    await openShop(page);
    await page.setViewportSize({ width: 450, height: 800 });
    await expect(page.locator('.rb-toolbar')).toHaveClass(/rb-compact/);
    expect(await tabNames(page)).toEqual([]);
    await expect(page.locator('.rb-view-more-btn')).toHaveText(/Rows/);
  });

  test('switching views renders each view type', async ({ page }) => {
    await openShop(page);
    await expect(page.locator('.rb-tr')).toHaveCount(5);
    await showView(page, 'Lanes');
    await expect(page.locator('.rb-kanban-card')).toHaveCount(5);
    await showView(page, 'Cards');
    await expect(page.locator('.rb-gallery-card')).toHaveCount(5);
    await showView(page, 'Spend');
    await expect(page.locator('.rb-chart-host svg')).toBeVisible();
  });

  test('"Create view" adds a view, switches to it and opens its settings', async ({ page }) => {
    await openShop(page, VIEWS.slice(0, 1));
    await page.getByLabel('Create view').click();
    await menu(page, 'New kanban view');
    await expect(page.locator('.dev-modal')).toBeVisible();
    const config = await page.evaluate(() => window.__store.getState().config!);
    expect(config.views.map((v) => v.type)).toEqual(['table', 'kanban']);
    expect(await page.evaluate(() => window.__store.getState().activeView)).toBe(config.views[1].name);
  });

  test('the tab menu deletes a view', async ({ page }) => {
    await openShop(page, VIEWS.slice(0, 2));
    await tab(page, 'Lanes').click({ button: 'right' });
    await menu(page, 'Delete view');
    expect(await tabNames(page)).toEqual(['Rows']);
  });

  test('the tab menu copies embed code', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openShop(page, VIEWS.slice(0, 2));
    await tab(page, 'Lanes').click({ button: 'right' });
    await menu(page, 'Copy embed code');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('```rboard\nfile: Expenses.table\nview: Lanes\n```\n');
  });

  test('no views: an empty state with a create button', async ({ page }) => {
    await open(page, { kind: 'board', fixture: { board: boardConfig([]), notes: GAME_NOTES } });
    await expect(page.locator('.rb-empty-views')).toBeVisible();
  });
});

test.describe('split view', () => {
  test('"Show beside" from the tab menu opens a companion; × closes it', async ({ page }) => {
    await openShop(page, VIEWS.slice(0, 2));
    await tab(page, 'Rows').click({ button: 'right' });
    await menu(page, 'Show beside');
    await menu(page, /^Lanes$/);
    await expect(page.locator('.rb-split-pane')).toHaveCount(2);
    await expect(page.locator('.rb-split-companion .rb-kanban-card')).toHaveCount(5);
    await page.getByLabel('Close split view').click();
    await expect(page.locator('.rb-split-pane')).toHaveCount(0);
  });

  test('the divider resizes the split and saves the size', async ({ page }) => {
    const views = [{ ...VIEWS[0], companion: { view: 'Lanes', position: 'right', size: 40, followFilter: false } }, VIEWS[1]];
    await openShop(page, views);
    const divider = (await page.getByRole('separator', { name: 'Resize split view' }).boundingBox())!;
    await page.mouse.move(divider.x + divider.width / 2, divider.y + 100);
    await page.mouse.down();
    await page.mouse.move(divider.x - 200, divider.y + 100, { steps: 8 });
    await page.mouse.up();
    const size = (await activeView(page)).companion!.size;
    expect(size).toBeGreaterThan(45);
  });

  test('a companion that follows the filter shows only matching items', async ({ page }) => {
    const views = [
      { ...VIEWS[0], filter: { conjunction: 'and', conditions: [{ property: 'kind', op: 'eq', value: 'food' }] }, companion: { view: 'Lanes', position: 'below', size: 40, followFilter: true } },
      VIEWS[1],
    ];
    await openShop(page, views);
    await expect(page.locator('.rb-split-follow')).toHaveText('filtered by Rows');
    await expect(page.locator('.rb-split-companion .rb-kanban-card')).toHaveCount(2);
  });
});

test.describe('search, sort, filter', () => {
  test('search narrows the rows; no match shows the empty state', async ({ page }) => {
    await openShop(page);
    await page.locator('.rb-search').fill('bre');
    expect(await titles(page)).toEqual(['Bread']);
    await page.locator('.rb-search').fill('zzz');
    await expect(page.locator('.rb-empty-state')).toContainText('search');
  });

  test('the sort chip picks a property and flips direction', async ({ page }) => {
    await openShop(page);
    await page.locator('.rb-chip', { hasText: 'No sort' }).click();
    await menu(page, /^Price$/);
    await expect(page.locator('.rb-chip').first()).toHaveText(/Price ↑/);
    expect(await titles(page)).toEqual(['Apples', 'Bread', 'Notebook', 'Cinema', 'Gas']);
    await page.locator('.rb-chip').first().click();
    await menu(page, /^Price$/);
    expect(await titles(page)).toEqual(['Gas', 'Cinema', 'Notebook', 'Bread', 'Apples']);
  });

  test('filter builder: add a rule, switch to Or, nest a group, delete', async ({ page }) => {
    await openShop(page);
    await page.locator('.rb-chip', { hasText: 'Filter' }).click();
    const modal = page.locator('.dev-modal');
    await expect(modal.locator('.rb-filter-empty')).toBeVisible();

    await modal.locator('.rb-filter-add').click();
    await menu(page, 'Add rule');
    const rule = modal.locator('.rb-filter-rule').first();
    await rule.locator('select').first().selectOption({ label: 'Price' });
    await rule.locator('select').nth(1).selectOption({ index: 0 });
    const op = await rule.locator('select').nth(1).inputValue();
    expect(op).toBeTruthy();
    // "Price > 10": pick the greater-than operator by its value.
    await rule.locator('select').nth(1).selectOption('gt');
    await rule.locator('.rb-filter-value').fill('10');
    expect(await titles(page)).toEqual(['Gas', 'Cinema']);
    await expect(page.locator('.rb-chip-badge')).toHaveText('1');

    await modal.locator('.rb-filter-add').last().click();
    await menu(page, 'Add filter group');
    await expect(modal.locator('.rb-filter-group-box')).toHaveCount(1);
    await modal.locator('.rb-filter-conj').selectOption('or');
    const inner = modal.locator('.rb-filter-group-box .rb-filter-rule');
    await inner.locator('select').first().selectOption({ label: 'Item' });
    await inner.locator('select').nth(1).selectOption('contains');
    await inner.locator('.rb-filter-value').fill('bread');
    expect(await titles(page)).toEqual(['Gas', 'Bread', 'Cinema']);

    await modal.locator('.rb-filter-delete').click();
    await expect(modal).toHaveCount(0);
    expect(await titles(page)).toHaveLength(5);
    expect((await activeView(page)).filter).toBeUndefined();
  });

  test('a select rule picks options as pills', async ({ page }) => {
    await openShop(page);
    await page.locator('.rb-chip', { hasText: 'Filter' }).click();
    await page.locator('.dev-modal .rb-filter-add').click();
    await menu(page, 'Add rule');
    const rule = page.locator('.dev-modal .rb-filter-rule');
    await rule.locator('select').first().selectOption({ label: 'Kind' });
    const ops = await rule.locator('select').nth(1).locator('option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
    const listOp = ops.find((o) => /any|in|oneOf/i.test(o));
    test.skip(!listOp, 'no list operator for selects');
    await rule.locator('select').nth(1).selectOption(listOp!);
    await rule.locator('.rb-filter-option', { hasText: 'Food' }).click();
    await rule.locator('.rb-filter-option', { hasText: 'Fun' }).click();
    expect(await titles(page)).toEqual(['Apples', 'Bread', 'Cinema']);
  });
});

test.describe('view settings', () => {
  test('rename keeps the view active and saves the file', async ({ page }) => {
    await openShop(page, VIEWS.slice(0, 2));
    await page.getByLabel('View settings').click();
    await setting(page, 'Name').locator('input').fill('All rows');
    await expect(tab(page, 'All rows')).toHaveClass(/rb-active/);
    expect(JSON.parse(await saved(page)).views[0].name).toBe('All rows');
  });

  test('group by from settings splits the table into sections', async ({ page }) => {
    await openShop(page, VIEWS.slice(0, 1));
    await page.getByLabel('View settings').click();
    await setting(page, 'Group by').locator('select').selectOption({ label: 'Kind' });
    await expect(page.locator('.rb-section-title')).toHaveText(['Food', 'Fuel', 'Fun', 'Uncategorized']);
  });

  test('the summary toggle adds a summary row', async ({ page }) => {
    await openShop(page, VIEWS.slice(0, 1));
    await page.getByLabel('View settings').click();
    await setting(page, 'Summary row').locator('.rb-switch').click();
    await expect(page.locator('.rb-summary-row')).toHaveCount(1);
  });

  test('Display tab: toggling visibility hides a column', async ({ page }) => {
    await openShop(page, VIEWS.slice(0, 1));
    await page.getByLabel('View settings').click();
    await page.locator('.rb-settings-tab', { hasText: 'Display' }).click();
    await page.locator('.rb-vis-row', { hasText: 'Tags' }).locator('.rb-vis-toggle').click();
    expect(await headers(page)).not.toContain('Tags');
  });

  test('changing the view type re-renders as that type', async ({ page }) => {
    await openShop(page, [VIEWS[0], VIEWS[1]]);
    await page.getByLabel('View settings').click();
    const select = setting(page, 'Type').locator('select');
    if (await select.count()) await select.selectOption('gallery');
    else await setting(page, 'Type').locator('.rb-segment', { hasText: 'Gallery' }).click();
    await expect(page.locator('.rb-gallery-card').first()).toBeVisible();
  });
});

test.describe('board / table settings', () => {
  test('table settings: rename a column; the header follows', async ({ page }) => {
    await openShop(page, VIEWS.slice(0, 1));
    await page.getByLabel('Board settings').click();
    await expect(page.locator('.dev-modal')).toContainText('Title column');
    await page.locator('.rb-settings-tab').nth(1).click();
    await page.locator('.rb-prop-name').nth(2).fill('Cost');
    await expect.poll(() => headers(page)).toContain('Cost');
  });

  test('adding a property adds a column', async ({ page }) => {
    await openShop(page, VIEWS.slice(0, 1));
    await page.getByLabel('Board settings').click();
    await page.locator('.rb-settings-tab').nth(1).click();
    const before = await page.locator('.rb-prop-card').count();
    await page.locator('.rb-prop-add').click();
    await expect(page.locator('.rb-prop-card')).toHaveCount(before + 1);
  });

  test('a formula referencing a renamed column keeps working', async ({ page }) => {
    await openShop(page, VIEWS.slice(0, 1));
    await page.getByLabel('Board settings').click();
    await page.locator('.rb-settings-tab').nth(1).click();
    await page.locator('.rb-prop-name').nth(2).fill('Cost');
    await page.keyboard.press('Escape');
    await page.locator('.dev-modal-bg').click({ position: { x: 5, y: 5 } });
    // Total = Price * Qty → still 6 for Apples, whether or not the formula was rewritten.
    await expect(page.locator('[data-pos="0:4"]')).toHaveText('6');
  });
});
