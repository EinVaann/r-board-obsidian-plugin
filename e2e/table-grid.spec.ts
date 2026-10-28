import { expect, test, type Page } from '@playwright/test';
import { activeView, cell, colWidths, headers, menu, open, pageErrors, rows, saved, titles } from './harness';
import { manyRows, tableFile } from './fixtures';

test.afterEach(({ page }) => expect(pageErrors(page)).toEqual([]));

const openShop = (page: Page, views?: Record<string, unknown>[], rowsOverride?: Record<string, unknown>[]) =>
  open(page, { fixture: { table: tableFile({ views, rows: rowsOverride }) } });

const isActive = (page: Page, r: number, c: number) => expect(cell(page, r, c)).toHaveClass(/rb-cell-active/);

test.describe('rendering', () => {
  test.beforeEach(({ page }) => openShop(page));

  test('every row in stored order, every column, computed formulas', async ({ page }) => {
    expect(await titles(page)).toEqual(['Apples', 'Gas', 'Bread', 'Cinema', 'Notebook']);
    expect(await headers(page)).toEqual(['Item', 'Kind', 'Price', 'Qty', 'Total', 'Paid', 'Tags', 'Date']);
    await expect(cell(page, 0, 4)).toHaveText('6');
    await expect(cell(page, 1, 4)).toHaveText('50');
    await expect(cell(page, 3, 4)).toHaveText('24');
  });

  test('select labels, multi pills and checkboxes render', async ({ page }) => {
    await expect(cell(page, 0, 1)).toHaveText('Food');
    await expect(cell(page, 1, 1)).toHaveText('Fuel');
    await expect(cell(page, 4, 1)).toHaveText('');
    await expect(cell(page, 0, 6)).toContainText('need');
  });

  test('the New row button is labelled for tables', async ({ page }) => {
    await expect(page.locator('.rb-new-note-label')).toHaveText('New row');
    await expect(page.locator('.rb-grid-add')).toHaveText(/New row/);
  });
});

test.describe('editing', () => {
  test.beforeEach(({ page }) => openShop(page));

  test('double-click, type, Enter writes the cell, recomputes and moves down', async ({ page }) => {
    await cell(page, 0, 3).dblclick();
    const input = cell(page, 0, 3).locator('input');
    await expect(input).toBeFocused();
    await input.fill('10');
    await input.press('Enter');
    expect((await rows(page))[0].qty).toBe(10);
    await expect(cell(page, 0, 4)).toHaveText('20');
    await isActive(page, 1, 3);
  });

  test('Escape cancels an edit', async ({ page }) => {
    await cell(page, 0, 2).dblclick();
    const input = cell(page, 0, 2).locator('input');
    await input.fill('999');
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    expect((await rows(page))[0].price).toBe(2);
  });

  test('typing on a selected cell starts editing with that key', async ({ page }) => {
    await cell(page, 1, 2).click();
    await page.keyboard.type('75');
    await expect(cell(page, 1, 2).locator('input')).toHaveValue('75');
    await page.keyboard.press('Enter');
    expect((await rows(page))[1].price).toBe(75);
  });

  test('clicking a selected cell again opens its editor (touch-friendly path)', async ({ page }) => {
    await cell(page, 2, 2).click();
    await cell(page, 2, 2).click();
    await expect(cell(page, 2, 2).locator('input')).toBeFocused();
  });

  test('Tab inside an editor commits and moves right; Shift+Tab moves left', async ({ page }) => {
    await cell(page, 0, 2).dblclick();
    await cell(page, 0, 2).locator('input').fill('5');
    await page.keyboard.press('Tab');
    await isActive(page, 0, 3);
    expect((await rows(page))[0].price).toBe(5);
    await page.keyboard.press('Enter');
    await cell(page, 0, 3).locator('input').fill('4');
    await page.keyboard.press('Shift+Tab');
    await isActive(page, 0, 2);
    expect((await rows(page))[0].qty).toBe(4);
  });

  test('a blur commits the edit', async ({ page }) => {
    await cell(page, 0, 2).dblclick();
    await cell(page, 0, 2).locator('input').fill('8');
    await page.locator('.rb-search').click();
    expect((await rows(page))[0].price).toBe(8);
  });

  test('edits the title column inline', async ({ page }) => {
    await cell(page, 1, 0).dblclick();
    const input = cell(page, 1, 0).locator('input');
    await input.fill('Diesel');
    await input.press('Enter');
    expect((await rows(page))[1].item).toBe('Diesel');
    await expect(cell(page, 1, 0)).toContainText('Diesel');
  });

  test('select cells open a dropdown; picking writes the option value', async ({ page }) => {
    await cell(page, 4, 1).dblclick();
    const select = cell(page, 4, 1).locator('select');
    await expect(select).toBeVisible();
    await select.selectOption({ label: 'Fun' });
    expect((await rows(page))[4].kind).toBe('fun');
    await expect(cell(page, 4, 1)).toHaveText('Fun');
  });

  test('multi cells take comma-separated labels', async ({ page }) => {
    await cell(page, 1, 6).dblclick();
    await cell(page, 1, 6).locator('input').fill('need, want');
    await page.keyboard.press('Enter');
    expect((await rows(page))[1].tags).toEqual(['need', 'want']);
  });

  test('checkbox cells toggle on click and with Space', async ({ page }) => {
    await cell(page, 1, 5).click();
    expect((await rows(page))[1].paid).toBe(true);
    await page.keyboard.press(' ');
    expect((await rows(page))[1].paid).toBe(false);
  });

  test('a formula cell takes an override and clearing it restores the formula', async ({ page }) => {
    await cell(page, 0, 4).dblclick();
    await cell(page, 0, 4).locator('input').fill('=100');
    await page.keyboard.press('Enter');
    await expect(cell(page, 0, 4)).toHaveText('100');
    await cell(page, 0, 4).dblclick();
    await cell(page, 0, 4).locator('input').fill('');
    await page.keyboard.press('Enter');
    await expect(cell(page, 0, 4)).toHaveText('6');
  });

  test('edits are saved to the file', async ({ page }) => {
    await cell(page, 0, 2).dblclick();
    await cell(page, 0, 2).locator('input').fill('7');
    await page.keyboard.press('Enter');
    const file = JSON.parse(await saved(page));
    expect(file.rows[0].cells.price).toBe(7);
  });
});

test.describe('keyboard selection', () => {
  test.beforeEach(({ page }) => openShop(page));

  test('arrows move the selection and stop at the edges', async ({ page }) => {
    await cell(page, 0, 0).click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await isActive(page, 1, 1);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await isActive(page, 0, 0);
  });

  test('Cmd/Ctrl+arrows jump to the first / last row and column', async ({ page }) => {
    await cell(page, 2, 2).click();
    await page.keyboard.press('ControlOrMeta+ArrowDown');
    await isActive(page, 4, 2);
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await isActive(page, 4, 7);
    await page.keyboard.press('ControlOrMeta+ArrowUp');
    await page.keyboard.press('ControlOrMeta+ArrowLeft');
    await isActive(page, 0, 0);
  });

  test('Tab moves right, Shift+Tab left', async ({ page }) => {
    await cell(page, 0, 1).click();
    await page.keyboard.press('Tab');
    await isActive(page, 0, 2);
    await page.keyboard.press('Shift+Tab');
    await isActive(page, 0, 1);
  });

  test('Shift+arrows extend a range; Escape collapses it', async ({ page }) => {
    await cell(page, 0, 2).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    await isActive(page, 1, 3);
    await expect(cell(page, 0, 2)).toHaveClass(/rb-cell-range/);
    await expect(cell(page, 0, 3)).toHaveClass(/rb-cell-range/);
    await expect(cell(page, 1, 2)).toHaveClass(/rb-cell-range/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.rb-cell-range')).toHaveCount(0);
  });

  test('Shift+click selects a range', async ({ page }) => {
    await cell(page, 0, 2).click();
    await cell(page, 2, 3).click({ modifiers: ['Shift'] });
    await expect(page.locator('.rb-cell-range')).toHaveCount(5);
  });

  test('dragging across cells selects a range', async ({ page }) => {
    const from = await cell(page, 0, 2).boundingBox();
    const to = await cell(page, 2, 3).boundingBox();
    await page.mouse.move(from!.x + 10, from!.y + 10);
    await page.mouse.down();
    await page.mouse.move(to!.x + 10, to!.y + 10, { steps: 5 });
    await page.mouse.up();
    await isActive(page, 2, 3);
    await expect(page.locator('.rb-cell-range')).toHaveCount(5);
  });

  test('Delete clears every cell in the range (title and formulas kept)', async ({ page }) => {
    await cell(page, 0, 2).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Delete');
    const r = await rows(page);
    expect([r[0].price, r[0].qty, r[1].price, r[1].qty]).toEqual([undefined, undefined, undefined, undefined]);
    expect(r[0].item).toBe('Apples');
  });

  test('Cmd/Ctrl+A selects everything', async ({ page }) => {
    await cell(page, 0, 0).click();
    await page.keyboard.press('ControlOrMeta+a');
    await isActive(page, 4, 7);
    await expect(page.locator('.rb-cell-range')).toHaveCount(5 * 8 - 1);
  });

  test('F2 and Enter open the editor on the active cell', async ({ page }) => {
    await cell(page, 0, 2).click();
    await page.keyboard.press('F2');
    await expect(cell(page, 0, 2).locator('input')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await expect(cell(page, 0, 2).locator('input')).toBeFocused();
  });

  test('the selection follows its row when sorting reorders rows', async ({ page }) => {
    await cell(page, 1, 2).click(); // Gas, Price
    await page.locator('.rb-th', { hasText: 'Price' }).click(); // sort asc
    await page.locator('.rb-th', { hasText: 'Price' }).click(); // sort desc: Gas first
    await expect(page.locator('.rb-cell-active')).toHaveAttribute('data-pos', '0:2');
  });
});

test.describe('clipboard', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openShop(page);
  });

  const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
  const setClipboard = (page: Page, text: string) => page.evaluate((t) => navigator.clipboard.writeText(t), text);

  test('copy writes the range as tab-separated text, with option labels', async ({ page }) => {
    await cell(page, 0, 0).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ControlOrMeta+c');
    await expect.poll(() => clipboard(page)).toBe('Apples\tFood\t2\nGas\tFuel\t50');
  });

  test('paste writes a block from the active cell', async ({ page }) => {
    await setClipboard(page, '1\t2\n3\t4');
    await cell(page, 0, 2).click();
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(async () => (await rows(page)).slice(0, 2).map((r) => [r.price, r.qty])).toEqual([[1, 2], [3, 4]]);
  });

  test('a single value fills the whole selected range', async ({ page }) => {
    await setClipboard(page, '9');
    await cell(page, 0, 3).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(async () => (await rows(page)).slice(0, 3).map((r) => r.qty)).toEqual([9, 9, 9]);
  });

  test('pasting labels into a select stores the option values', async ({ page }) => {
    await setClipboard(page, 'Fun\nfuel');
    await cell(page, 0, 1).click();
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(async () => (await rows(page)).slice(0, 2).map((r) => r.kind)).toEqual(['fun', 'fuel']);
  });

  test('cut copies then clears', async ({ page }) => {
    await cell(page, 0, 2).click();
    await page.keyboard.press('ControlOrMeta+x');
    await expect.poll(() => clipboard(page)).toBe('2');
    await expect.poll(async () => (await rows(page))[0].price).toBeUndefined();
  });
});

test.describe('rows', () => {
  test.beforeEach(({ page }) => openShop(page));

  test('New row adds a row in edit mode on its title', async ({ page }) => {
    await page.locator('.rb-grid-add').click();
    const input = cell(page, 5, 0).locator('input');
    await expect(input).toBeFocused();
    await input.fill('Milk');
    await input.press('Enter');
    const r = await rows(page);
    expect(r).toHaveLength(6);
    expect(r[5].item).toBe('Milk');
  });

  test('the toolbar New row button adds a row too', async ({ page }) => {
    await page.locator('.rb-new-note').click();
    await expect.poll(async () => (await rows(page)).length).toBe(6);
  });

  test('row menu: insert below, duplicate, delete', async ({ page }) => {
    await cell(page, 0, 2).click({ button: 'right' });
    await menu(page, 'Insert row below');
    await expect(cell(page, 1, 0).locator('input')).toBeFocused();
    await page.keyboard.press('Escape');
    expect((await rows(page)).map((r) => r.item)).toEqual(['Apples', undefined, 'Gas', 'Bread', 'Cinema', 'Notebook']);

    await cell(page, 2, 2).click({ button: 'right' });
    await menu(page, 'Duplicate row');
    expect((await rows(page)).filter((r) => r.item === 'Gas')).toHaveLength(2);

    await cell(page, 1, 2).click({ button: 'right' });
    await menu(page, 'Delete row');
    expect((await rows(page)).map((r) => r.item)).toEqual(['Apples', 'Gas', 'Gas', 'Bread', 'Cinema', 'Notebook']);
  });

  test('the row menu over a range deletes every selected row', async ({ page }) => {
    await cell(page, 1, 2).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await cell(page, 2, 2).click({ button: 'right' });
    await menu(page, 'Delete 3 rows');
    expect((await rows(page)).map((r) => r.item)).toEqual(['Apples', 'Notebook']);
  });

  test('Expand row opens the record editor; edits there reach the grid', async ({ page }) => {
    await cell(page, 0, 0).hover();
    await cell(page, 0, 0).getByLabel('Expand row').click();
    const modal = page.locator('.dev-modal');
    await expect(modal.locator('.rb-record-row')).toHaveCount(8);
    const price = modal.locator('.rb-record-row', { hasText: 'Price' }).locator('input');
    await price.fill('42');
    await price.press('Enter');
    await expect(cell(page, 0, 2)).toHaveText('42');
    await expect(modal.locator('.rb-record-result')).toHaveText('= 126');
  });

  test('the record editor deletes and duplicates', async ({ page }) => {
    await cell(page, 1, 0).hover();
    await cell(page, 1, 0).getByLabel('Expand row').click();
    await page.locator('.dev-modal button', { hasText: 'Duplicate' }).click();
    await expect(page.locator('.dev-modal')).toHaveCount(0);
    expect((await rows(page)).filter((r) => r.item === 'Gas')).toHaveLength(2);
    await cell(page, 1, 0).hover();
    await cell(page, 1, 0).getByLabel('Expand row').click();
    await page.locator('.dev-modal button', { hasText: 'Delete row' }).click();
    expect((await rows(page)).filter((r) => r.item === 'Gas')).toHaveLength(1);
  });
});

test.describe('headers', () => {
  test.beforeEach(({ page }) => openShop(page));

  test('clicking a header sorts asc, then desc', async ({ page }) => {
    const price = page.locator('.rb-th', { hasText: 'Price' });
    await price.click();
    expect(await titles(page)).toEqual(['Apples', 'Bread', 'Notebook', 'Cinema', 'Gas']);
    await expect(price.locator('.rb-sort-ind')).toHaveText(/▲/);
    await price.click();
    expect(await titles(page)).toEqual(['Gas', 'Cinema', 'Notebook', 'Bread', 'Apples']);
    await expect(price.locator('.rb-sort-ind')).toHaveText(/▼/);
  });

  test('sorting by a formula column uses computed values', async ({ page }) => {
    await page.locator('.rb-th', { hasText: 'Total' }).click({ button: 'right' });
    await menu(page, 'Sort descending');
    expect(await titles(page)).toEqual(['Gas', 'Cinema', 'Apples', 'Bread', 'Notebook']);
  });

  test('the header menu hides a column', async ({ page }) => {
    await page.locator('.rb-th', { hasText: 'Tags' }).click({ button: 'right' });
    await menu(page, 'Hide in this view');
    expect(await headers(page)).toEqual(['Item', 'Kind', 'Price', 'Qty', 'Total', 'Paid', 'Date']);
    expect((await activeView(page)).properties).not.toContain('tags');
  });

  test('dragging a header reorders columns', async ({ page }) => {
    const qty = await page.locator('.rb-th', { hasText: 'Qty' }).boundingBox();
    const kind = await page.locator('.rb-th', { hasText: 'Kind' }).boundingBox();
    await page.mouse.move(qty!.x + qty!.width / 2, qty!.y + qty!.height / 2);
    await page.mouse.down();
    await page.mouse.move(qty!.x + qty!.width / 2 - 20, qty!.y + 10, { steps: 4 });
    await page.mouse.move(kind!.x + 10, kind!.y + kind!.height / 2, { steps: 10 });
    await page.mouse.up();
    expect(await headers(page)).toEqual(['Item', 'Qty', 'Kind', 'Price', 'Total', 'Paid', 'Tags', 'Date']);
  });

  test('a plain header click after a drag does not sort', async ({ page }) => {
    const before = (await activeView(page)).sort;
    const handle = page.locator('.rb-th', { hasText: 'Price' }).locator('.rb-th-resize');
    const box = await handle.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + 40, box!.y + box!.height / 2, { steps: 5 });
    await page.mouse.up();
    expect((await activeView(page)).sort).toEqual(before);
  });
});

test.describe('column resize', () => {
  async function dragResize(page: Page, label: string, dx: number, during?: () => Promise<void>) {
    const handle = page.locator('.rb-grid').first().locator('.rb-th', { hasText: label }).locator('.rb-th-resize');
    const box = await handle.boundingBox();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 8 });
    await during?.();
    await page.mouse.up();
  }

  test('resizing a column changes only that column, live and after release', async ({ page }) => {
    await openShop(page);
    const table = page.locator('.rb-grid table').first();
    const before = await colWidths(table);
    await dragResize(page, 'Price', 80, async () => {
      const live = await colWidths(table);
      expect(live[2]).toBe(before[2] + 80);
      expect(live.filter((_, i) => i !== 2)).toEqual(before.filter((_, i) => i !== 2));
    });
    const after = await colWidths(table);
    expect(after[2]).toBe(before[2] + 80);
    expect(after.filter((_, i) => i !== 2)).toEqual(before.filter((_, i) => i !== 2));
    expect((await activeView(page)).widths).toEqual({ price: before[2] + 80 });
  });

  test('a column cannot shrink below the minimum width', async ({ page }) => {
    await openShop(page);
    await dragResize(page, 'Price', -500);
    expect((await activeView(page)).widths?.price).toBe(60);
  });

  test('saved widths are used on load', async ({ page }) => {
    await openShop(page, [{ name: 'Rows', type: 'table', limit: 'none', widths: { qty: 222 }, sort: { property: '$none', dir: 'asc' } }]);
    expect((await colWidths(page.locator('.rb-grid table').first()))[3]).toBe(222);
  });

  test('in a grouped table every group (and the totals) follows a resize', async ({ page }) => {
    await openShop(page, [{ name: 'Rows', type: 'table', limit: 'none', group: 'kind', summary: true, calculations: { price: 'sum' } }]);
    const tables = page.locator('.rb-grid-groups table.rb-table');
    const count = await tables.count();
    expect(count).toBeGreaterThan(2);
    await dragResize(page, 'Price', 60, async () => {
      const live = await tables.evaluateAll((ts) => ts.map((t) => Math.round(t.querySelectorAll('col')[2].getBoundingClientRect().width)));
      expect(new Set(live).size).toBe(1);
    });
    const widths = await tables.evaluateAll((ts) => ts.map((t) => Math.round(t.getBoundingClientRect().width)));
    expect(new Set(widths).size).toBe(1);
  });
});

test.describe('grouping', () => {
  const grouped = (extra: Record<string, unknown> = {}) => [{ name: 'Rows', type: 'table', limit: 'none', group: 'kind', ...extra }];

  test('rows split into sections in option order, empty values last', async ({ page }) => {
    await openShop(page, grouped());
    await expect(page.locator('.rb-section-title')).toHaveText(['Food', 'Fuel', 'Fun', 'Uncategorized']);
    await expect(page.locator('.rb-section-count')).toHaveText(['2', '1', '1', '1']);
  });

  test('collapsing a section hides its rows and is saved with the view', async ({ page }) => {
    await openShop(page, grouped());
    await page.locator('.rb-section-header', { hasText: 'Food' }).click();
    await expect(page.locator('.rb-tr')).toHaveCount(3);
    expect((await activeView(page)).collapsed).toEqual(['food']);
    await page.locator('.rb-section-header', { hasText: 'Food' }).click();
    await expect(page.locator('.rb-tr')).toHaveCount(5);
  });

  test('a section\'s + adds a row already in that group', async ({ page }) => {
    await openShop(page, grouped());
    await page.locator('.rb-section', { hasText: 'Fuel' }).getByLabel('New item in this group').click();
    await expect.poll(async () => (await rows(page)).at(-1)?.kind).toBe('fuel');
  });

  test('"New row with no Kind" adds an ungrouped row', async ({ page }) => {
    await openShop(page, grouped());
    await page.locator('.rb-grid-add-ungrouped').click();
    await expect.poll(async () => (await rows(page)).length).toBe(6);
    expect((await rows(page)).at(-1)?.kind).toBeUndefined();
  });

  test('changing a row\'s group moves it to the other section', async ({ page }) => {
    await openShop(page, grouped());
    const notebook = page.locator('.rb-section', { hasText: 'Uncategorized' }).locator('.rb-td-select').first();
    await notebook.dblclick();
    await notebook.locator('select').selectOption({ label: 'Fun' });
    await expect(page.locator('.rb-section-count')).toHaveText(['2', '1', '2']);
  });

  test('groups scroll sideways together', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await openShop(page, grouped());
    const wraps = page.locator('.rb-grid-groups .rb-table-wrap');
    await wraps.first().evaluate((el) => (el.scrollLeft = 200));
    await expect.poll(() => wraps.evaluateAll((els) => els.map((e) => e.scrollLeft))).toEqual(Array(4).fill(200));
  });

  test('a group opened later starts at the shared sideways position', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await openShop(page, grouped({ collapsed: ['fun'] }));
    await page.locator('.rb-grid-groups .rb-table-wrap').first().evaluate((el) => (el.scrollLeft = 150));
    await page.locator('.rb-section-header', { hasText: 'Fun' }).click();
    await expect.poll(() => page.locator('.rb-section', { hasText: 'Fun' }).locator('.rb-table-wrap').evaluate((e) => e.scrollLeft)).toBe(150);
  });

  test('opening a collapsed group keeps the vertical scroll position', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await openShop(page, grouped({ collapsed: ['fun'] }), manyRows(60));
    const body = page.locator('.rb-body');
    await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
    const top = await body.evaluate((el) => el.scrollTop);
    expect(top).toBeGreaterThan(300);
    await page.locator('.rb-section-header', { hasText: 'Fun' }).click();
    await page.waitForTimeout(100);
    expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(top - 5);
  });

  test('groups by a hidden property', async ({ page }) => {
    await openShop(page, grouped({ properties: ['price'] }));
    await expect(page.locator('.rb-section-title')).toHaveText(['Food', 'Fuel', 'Fun', 'Uncategorized']);
    expect(await headers(page)).toEqual(['Item', 'Price']);
  });
});

test.describe('summary row', () => {
  test('totals per group and overall; clicking a cell changes the calculation', async ({ page }) => {
    await openShop(page, [{ name: 'Rows', type: 'table', limit: 'none', group: 'kind', summary: true, calculations: { price: 'sum' } }]);
    const grand = page.locator('.rb-grand-total .rb-summary-row');
    await expect(grand.locator('.rb-summary-count')).toHaveText('5 rows');
    await expect(grand.locator('.rb-summary-value')).toHaveText(['71']);
    await expect(grand.locator('.rb-summary-caption')).toHaveText(['Price · Sum']);

    await grand.locator('.rb-summary-cell').nth(3).click(); // Qty column
    await menu(page, 'Average');
    await expect(grand.locator('.rb-summary-value')).toHaveText(['71', '1.8']);
    expect((await activeView(page)).calculations).toEqual({ price: 'sum', qty: 'avg' });
  });

  test('a collapsed group still shows its totals', async ({ page }) => {
    await openShop(page, [{ name: 'Rows', type: 'table', limit: 'none', group: 'kind', summary: true, calculations: { price: 'sum' }, collapsed: ['food'] }]);
    const food = page.locator('.rb-section', { hasText: 'Food' });
    await expect(food.locator('.rb-tr')).toHaveCount(0);
    await expect(food.locator('.rb-summary-value')).toHaveText('5');
  });

  test('checkbox calculations count checked rows', async ({ page }) => {
    await openShop(page, [{ name: 'Rows', type: 'table', limit: 'none', summary: true, calculations: { paid: 'checked' } }]);
    await expect(page.locator('.rb-summary-row .rb-summary-value')).toHaveText('2');
  });
});

test.describe('large tables', () => {
  test('rows are virtualized and scrolling reveals the rest', async ({ page }) => {
    await openShop(page, [{ name: 'Rows', type: 'table', limit: 'none', sort: { property: '$none', dir: 'asc' } }], manyRows(500));
    const shown = await page.locator('.rb-tr').count();
    expect(shown).toBeGreaterThan(5);
    expect(shown).toBeLessThan(200);
    await page.locator('.rb-body').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(page.locator('.rb-tr .rb-title', { hasText: 'Row 499' })).toBeVisible();
  });

  test('keyboard navigation to the last row scrolls it into view', async ({ page }) => {
    await openShop(page, [{ name: 'Rows', type: 'table', limit: 'none', sort: { property: '$none', dir: 'asc' } }], manyRows(300));
    await cell(page, 0, 0).click();
    await page.keyboard.press('ControlOrMeta+ArrowDown');
    await expect(page.locator('[data-pos="299:0"]')).toBeInViewport();
  });

  test('View More loads the next page', async ({ page }) => {
    await openShop(page, [{ name: 'Rows', type: 'table', limit: 50, sort: { property: '$none', dir: 'asc' } }], manyRows(120));
    await page.locator('.rb-body').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(page.locator('.rb-tr').last()).toContainText('Row 049');
    await page.locator('.rb-view-more').click();
    await page.locator('.rb-body').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(page.locator('.rb-tr').last()).toContainText('Row 099');
  });

  test('numbered pages', async ({ page }) => {
    await openShop(page, [{ name: 'Rows', type: 'table', limit: 10, paging: 'pages', sort: { property: '$none', dir: 'asc' } }], manyRows(45));
    await expect(page.locator('.rb-pager-range')).toHaveText('1–10 of 45');
    await page.getByLabel('Next page').click();
    await expect(page.locator('.rb-pager-range')).toHaveText('11–20 of 45');
    await expect(page.locator('.rb-tr .rb-title').first()).toHaveText('Row 010');
    await page.locator('.rb-pager-btn', { hasText: /^5$/ }).click();
    await expect(page.locator('.rb-pager-range')).toHaveText('41–45 of 45');
    await expect(page.getByLabel('Next page')).toBeDisabled();
  });
});
