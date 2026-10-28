import { expect, test, type Locator, type Page } from '@playwright/test';
import { activeView, log, menu, open, pageErrors, rows } from './harness';
import { boardConfig, GAME_NOTES, tableFile } from './fixtures';

test.afterEach(({ page }) => expect(pageErrors(page)).toEqual([]));

const notes = (page: Page) => page.evaluate(() => window.__notes);
const column = (page: Page, title: string): Locator =>
  page.locator('.rb-kanban-col', { has: page.locator('.rb-kanban-title', { hasText: new RegExp(`^${title}$`) }) });
const cardTitles = (col: Locator) => col.locator('.rb-kanban-card .rb-title').allTextContents();

/** Drag with the mouse in small steps (dnd-kit needs 6px of movement to start). */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 60), { steps: 12 });
  await page.mouse.up();
}

const BOARD = boardConfig([{ name: 'Board', type: 'kanban', group: 'status', sort: { property: 'score', dir: 'desc' }, cardSize: 'small' }]);

test.describe('notes board', () => {
  test.beforeEach(({ page }) => open(page, { kind: 'board', fixture: { board: BOARD, notes: GAME_NOTES } }));

  test('a column per option in order, cards sorted inside each', async ({ page }) => {
    await expect(page.locator('.rb-kanban-header .rb-kanban-title')).toHaveText(['To Play', 'Playing', 'Completed', 'On Hold']);
    expect(await cardTitles(column(page, 'Playing'))).toEqual(['Hollow Knight', 'Hades']);
    await expect(column(page, 'To Play').locator('.rb-kanban-count')).toHaveText('2');
  });

  test('dragging a card to another column writes the note\'s frontmatter', async ({ page }) => {
    await drag(page, column(page, 'To Play').locator('.rb-kanban-card', { hasText: 'Celeste' }), column(page, 'Completed').locator('.rb-kanban-list'));
    await expect.poll(async () => (await notes(page))['Games/Celeste.md'].status).toBe('completed');
    await expect.poll(() => cardTitles(column(page, 'Completed'))).toContain('Celeste');
  });

  test('the card menu moves a card through "Move to group"', async ({ page }) => {
    await column(page, 'On Hold').locator('.rb-kanban-card').hover();
    await column(page, 'On Hold').getByLabel('Card actions').click();
    await menu(page, 'Move to group');
    await menu(page, /^Playing$/);
    await expect.poll(async () => (await notes(page))['Games/Stardew Valley.md'].status).toBe('playing');
  });

  test('clicking a card opens the note editor', async ({ page }) => {
    await page.locator('.rb-kanban-card', { hasText: 'Hades' }).locator('.rb-title').click();
    await expect.poll(() => log(page)).toContainEqual(expect.stringMatching(/Hades/));
  });

  test('collapsing a column is saved with the view', async ({ page }) => {
    await column(page, 'Completed').locator('.rb-kanban-header').click();
    await expect(column(page, 'Completed').locator('.rb-kanban-card')).toHaveCount(0);
    expect((await activeView(page)).collapsed).toEqual(['completed']);
  });

  test('dragging a column header reorders columns', async ({ page }) => {
    const headers = page.locator('.rb-kanban-header');
    await drag(page, headers.nth(3), headers.nth(0));
    await expect(page.locator('.rb-kanban-header .rb-kanban-title')).toHaveText(['On Hold', 'To Play', 'Playing', 'Completed']);
    expect((await activeView(page)).columns).toEqual(['on-hold', 'to-play', 'playing', 'completed']);
  });

  test('"Add group" on a select property adds an option and a column', async ({ page }) => {
    await page.locator('.rb-kanban-add-btn').click();
    await page.locator('.rb-kanban-add-input').fill('wishlist');
    await page.keyboard.press('Enter');
    await expect(page.locator('.rb-kanban-header .rb-kanban-title').last()).toHaveText('wishlist');
    const options = await page.evaluate(() => window.__store.getState().config!.properties[0].options!.map((o) => o.value));
    expect(options).toContain('wishlist');
  });

  test('"New" in a column creates a note with that value', async ({ page }) => {
    await column(page, 'On Hold').locator('.rb-kanban-new').click();
    await expect.poll(() => log(page)).toContainEqual('[new note] {"status":"on-hold"}');
  });

  test('search narrows the cards', async ({ page }) => {
    await page.locator('.rb-search').fill('hollow');
    await expect(page.locator('.rb-kanban-card')).toHaveCount(1);
    await page.locator('.rb-search').fill('');
    await expect(page.locator('.rb-kanban-card')).toHaveCount(6);
  });

  test('a vault change re-renders the board', async ({ page }) => {
    await page.evaluate(() => {
      window.__notes['Games/Hades.md'] = { ...window.__notes['Games/Hades.md'], status: 'completed' };
      window.__store.getState().bumpVault();
    });
    await expect.poll(() => cardTitles(column(page, 'Completed'))).toContain('Hades');
  });
});

test.describe('swimlanes', () => {
  const LANES = boardConfig([{ name: 'Lanes', type: 'kanban', group: 'status', subGroup: 'owned', cardSize: 'small' }]);

  test('a row per sub-group value, every column in every row', async ({ page }) => {
    await open(page, { kind: 'board', fixture: { board: LANES, notes: GAME_NOTES } });
    const lanes = page.locator('.rb-lane');
    await expect(lanes).toHaveCount(2);
    await expect(page.locator('.rb-lane-header .rb-kanban-title')).toHaveText(['Checked', 'Unchecked']);
    await expect(lanes.first().locator('.rb-kanban-cell')).toHaveCount(4);
  });

  test('collapsing a lane hides its cells', async ({ page }) => {
    await open(page, { kind: 'board', fixture: { board: LANES, notes: GAME_NOTES } });
    await page.locator('.rb-lane-header').first().click();
    await expect(page.locator('.rb-lane').first()).toHaveClass(/rb-collapsed/);
    await expect(page.locator('.rb-lane').first().locator('.rb-kanban-card')).toHaveCount(0);
  });

  test('dragging a card across lanes changes both values', async ({ page }) => {
    await open(page, { kind: 'board', fixture: { board: LANES, notes: GAME_NOTES } });
    const card = page.locator('.rb-lane').nth(1).locator('.rb-kanban-card', { hasText: 'Outer Wilds' });
    const target = page.locator('.rb-lane').nth(0).locator('.rb-kanban-cell').nth(1); // owned=true, Playing
    await drag(page, card, target);
    await expect.poll(async () => {
      const n = (await notes(page))['Games/Outer Wilds.md'];
      return [n.status, n.owned];
    }).toEqual(['playing', true]);
  });
});

test.describe('table kanban', () => {
  test('rows group by a select; dragging a card writes the row', async ({ page }) => {
    await open(page, { fixture: { table: tableFile({ views: [{ name: 'Lanes', type: 'kanban', group: 'kind' }] }) } });
    await expect(page.locator('.rb-kanban-header .rb-kanban-title')).toHaveText(['Food', 'Fuel', 'Fun', 'Uncategorized']);
    await drag(page, column(page, 'Uncategorized').locator('.rb-kanban-card'), column(page, 'Fun').locator('.rb-kanban-list'));
    await expect.poll(async () => (await rows(page)).find((r) => r.item === 'Notebook')?.kind).toBe('fun');
  });

  test('"Expand row" from the card menu opens the record editor', async ({ page }) => {
    await open(page, { fixture: { table: tableFile({ views: [{ name: 'Lanes', type: 'kanban', group: 'kind' }] }) } });
    await page.locator('.rb-kanban-card', { hasText: 'Gas' }).hover();
    await page.locator('.rb-kanban-card', { hasText: 'Gas' }).getByLabel('Card actions').click();
    await menu(page, 'Expand row');
    await expect(page.locator('.dev-modal .rb-record')).toBeVisible();
  });

  test('a date column bucketed by month', async ({ page }) => {
    await open(page, { fixture: { table: tableFile({ views: [{ name: 'By month', type: 'kanban', group: 'date', groupBucket: 'month' }] }) } });
    await expect(page.locator('.rb-kanban-header .rb-kanban-title').first()).toContainText('2026');
    await expect(page.locator('.rb-kanban-add')).toHaveCount(0); // bucketed: can't add by name
  });
});
