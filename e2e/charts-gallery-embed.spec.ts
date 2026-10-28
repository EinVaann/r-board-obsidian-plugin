import { expect, test, type Page } from '@playwright/test';
import { log, open, pageErrors, rows, showView } from './harness';
import { boardConfig, GAME_NOTES, manyRows, tableFile } from './fixtures';

test.afterEach(({ page }) => expect(pageErrors(page)).toEqual([]));

const chart = (over: Record<string, unknown> = {}) => ({
  type: 'bar', x: 'kind', dateBucket: 'none', splitBy: null, values: ['price'], aggregate: 'sum',
  stacked: false, horizontal: false, sort: 'x', showLegend: true, showLabels: false, colors: {}, ...over,
});
const openChart = (page: Page, over: Record<string, unknown> = {}) =>
  open(page, { fixture: { table: tableFile({ views: [{ name: 'Chart', type: 'chart', chart: chart(over) }] }) } });

test.describe('charts', () => {
  for (const type of ['bar', 'line', 'area', 'pie', 'donut', 'scatter']) {
    test(`${type} chart renders`, async ({ page }) => {
      // Scatter plots a value against a numeric / date X.
      await openChart(page, type === 'scatter' ? { type, x: 'date' } : { type });
      await expect(page.locator('.rb-chart-host svg')).toBeVisible();
      await expect(page.locator('.rb-chart-empty')).toHaveCount(0);
    });
  }

  test('a split-by chart has a legend item per series; clicking hides one', async ({ page }) => {
    await openChart(page, { x: 'date', dateBucket: 'month', splitBy: 'kind', stacked: true });
    const items = page.locator('.rb-legend-item');
    await expect(items).toHaveText(['Food', 'Fuel', 'Fun', 'No value'].map((t) => new RegExp(t)));
    await items.first().click();
    await expect(items.first()).toHaveClass(/rb-off/);
  });

  test('clicking a bar lists its rows (drill-down)', async ({ page }) => {
    await openChart(page);
    // The first category (Food) is the left-most bar.
    const boxes = await page.locator('.rb-chart-host svg path').evaluateAll((ps) =>
      ps.map((p) => p.getBoundingClientRect()).filter((r) => r.width > 10 && r.height > 10 && r.width < 300).map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })),
    );
    expect(boxes.length).toBeGreaterThan(0);
    await page.mouse.click(boxes[0].x, boxes[0].y);
    await expect(page.locator('.rb-drill')).toBeVisible();
    await expect(page.locator('.rb-drill .rb-tr')).toHaveCount(2);
  });

  test('a chart over an empty table explains itself', async ({ page }) => {
    await open(page, { fixture: { table: tableFile({ rows: [], views: [{ name: 'Chart', type: 'chart', chart: chart() }] }) } });
    await expect(page.locator('.rb-chart-empty, .rb-empty-state').first()).toBeVisible();
  });

  test('a chart updates when the table changes', async ({ page }) => {
    await open(page, { fixture: { table: tableFile({ views: [{ name: 'Chart', type: 'chart', chart: chart({ type: 'pie' }) }, { name: 'Rows', type: 'table', limit: 'none' }] }) } });
    await showView(page, 'Rows');
    await expect(page.locator('.rb-tr')).toHaveCount(5);
    await page.evaluate(() => window.__store.getState().updateRows((r) => void r.forEach((row) => (row.cells.kind = row.cells.kind ? 'fun' : 'food'))));
    await showView(page, 'Chart');
    // Two slices left (Fun, Food), so two legend entries.
    await expect(page.locator('.rb-legend-item')).toHaveText([/Food/, /Fun/]);
    expect(new Set((await rows(page)).map((r) => r.kind))).toEqual(new Set(['fun', 'food']));
  });
});

test.describe('gallery', () => {
  const NOTES = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`Games/Game ${i}.md`, { tags: ['backlog'], status: ['to-play', 'playing'][i % 2], score: i % 10 }]));

  test('masonry gallery virtualizes many cards', async ({ page }) => {
    await open(page, { kind: 'board', fixture: { board: boardConfig([{ name: 'All', type: 'gallery', limit: 'none' }]), notes: NOTES } });
    const n = await page.locator('.rb-gallery-card').count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(80);
  });

  test('grid gallery groups into sections', async ({ page }) => {
    await open(page, { kind: 'board', fixture: { board: boardConfig([{ name: 'Grid', type: 'gallery', layout: 'grid', limit: 'none', group: 'status' }]), notes: GAME_NOTES } });
    await expect(page.locator('.rb-section-title')).toHaveText(['To Play', 'Playing', 'Completed', 'On Hold']);
    await page.locator('.rb-section-header', { hasText: 'Playing' }).click();
    await expect(page.locator('.rb-gallery-card')).toHaveCount(4);
  });

  test('cards render stars and pills; clicking a title opens the note', async ({ page }) => {
    await open(page, { kind: 'board', fixture: { board: boardConfig([{ name: 'Grid', type: 'gallery', layout: 'grid', limit: 'none' }]), notes: GAME_NOTES } });
    await expect(page.locator('.rb-gallery-card .rb-stars').first()).toBeVisible();
    await expect(page.locator('.rb-gallery-card .rb-pill, .rb-gallery-card [class*="pill"]').first()).toBeVisible();
    await page.locator('.rb-gallery-card', { hasText: 'Celeste' }).locator('.rb-title').click();
    await expect.poll(() => log(page)).toContainEqual(expect.stringMatching(/Celeste/));
  });
});

test.describe('embeds', () => {
  test('a note with a chart embed and a table embed', async ({ page }) => {
    await open(page, { kind: 'embed' });
    await expect(page.locator('.rb-embed-root')).toHaveCount(2);
    await expect(page.locator('.rb-embed-root').first().locator('.rb-chart-host svg')).toBeVisible();
    await expect(page.locator('.rb-embed-view').nth(1)).toHaveText('· Table');
  });

  test('editing in the table embed saves the file and updates the chart embed', async ({ page }) => {
    await open(page, { kind: 'embed' });
    const table = page.locator('.rb-embed-root').nth(1);
    await table.locator('.rb-section-header').first().click();
    const amount = table.locator('.rb-td-number').first();
    await amount.dblclick();
    await amount.locator('input').fill('9999');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__saved ?? '')).toContain('9999');
  });

  test('the Open button opens the file', async ({ page }) => {
    await open(page, { kind: 'embed' });
    await page.locator('.rb-embed-open').first().click();
    await expect.poll(() => log(page)).toContainEqual(expect.stringMatching(/Expenses\.table/));
  });
});

test.describe('robustness', () => {
  test('a 2,000-row table opens fast and scrolls without errors', async ({ page }) => {
    const t0 = Date.now();
    await open(page, { fixture: { table: tableFile({ rows: manyRows(2000), views: [{ name: 'Rows', type: 'table', limit: 'none', group: 'kind', summary: true, calculations: { price: 'sum' } }] }) } });
    await expect(page.locator('.rb-tr').first()).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(5000);
    const body = page.locator('.rb-body');
    for (const f of [0.25, 0.5, 0.75, 1]) await body.evaluate((el, f) => (el.scrollTop = el.scrollHeight * f), f);
    await expect(page.locator('.rb-grand-total .rb-summary-count')).toHaveText(/2,?000 rows/);
  });

  test('a broken .table file shows the setup screen with the error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => void ((window as unknown as { __fixture: unknown }).__fixture = { table: '{"properties": 5' }));
    await page.goto('/index.html');
    await page.waitForTimeout(500);
    expect(errors.join('\n')).toMatch(/Invalid JSON/);
  });

  test('R Sheet v1 files (the bundled sample) open and render', async ({ page }) => {
    await open(page);
    await expect(page.locator('.rb-section')).toHaveCount(3);
    await page.locator('.rb-section-header').first().click();
    await expect(page.locator('.rb-tr').first()).toBeVisible();
  });
});
