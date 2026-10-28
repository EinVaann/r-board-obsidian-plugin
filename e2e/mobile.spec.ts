import { expect, test } from '@playwright/test';
import { cell, open, pageErrors, rows } from './harness';
import { boardConfig, GAME_NOTES, tableFile } from './fixtures';

test.afterEach(({ page }) => expect(pageErrors(page)).toEqual([]));

test.describe('phone layout', () => {
  test('compact toolbar with one view dropdown', async ({ page }) => {
    await open(page, { mobile: true, fixture: { table: tableFile() } });
    await expect(page.locator('.rb-toolbar')).toHaveClass(/rb-compact/);
    await expect(page.locator('.rb-view-more-btn')).toBeVisible();
  });

  test('tap a cell, tap again to edit', async ({ page }) => {
    await open(page, { mobile: true, fixture: { table: tableFile() } });
    await cell(page, 0, 2).tap();
    await expect(cell(page, 0, 2)).toHaveClass(/rb-cell-active/);
    await cell(page, 0, 2).tap();
    const input = cell(page, 0, 2).locator('input');
    await expect(input).toBeFocused();
    await input.fill('11');
    await input.press('Enter');
    expect((await rows(page))[0].price).toBe(11);
  });

  test('the table scrolls sideways inside its box, not the page', async ({ page }) => {
    await open(page, { mobile: true, fixture: { table: tableFile() } });
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(pageOverflow).toBeLessThanOrEqual(1);
    const wrap = page.locator('.rb-table-wrap').first();
    expect(await wrap.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });

  test('kanban on phones: no drag handles, menu button on every card', async ({ page }) => {
    await open(page, { mobile: true, kind: 'board', fixture: { board: boardConfig([{ name: 'Board', type: 'kanban', group: 'status' }]), notes: GAME_NOTES } });
    await expect(page.locator('.rb-kanban-card')).toHaveCount(6);
    await expect(page.locator('.rb-kanban-header.rb-draggable')).toHaveCount(0);
    await expect(page.locator('.rb-card-menu')).toHaveCount(6);
  });

  test('settings open as a bottom sheet', async ({ page }) => {
    await open(page, { mobile: true, fixture: { table: tableFile() } });
    await page.getByLabel('View settings').click();
    await expect(page.locator('.rb-sheet')).toBeVisible();
    await expect(page.locator('.rb-sheet-handle')).toBeVisible();
  });
});
