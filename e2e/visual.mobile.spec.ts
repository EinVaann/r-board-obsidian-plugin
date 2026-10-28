/** Phone screenshots (run in the "phone" project). */
import { expect, test, type Page } from '@playwright/test';
import { open, pageErrors } from './harness';
import { boardConfig, GAME_NOTES, tableFile } from './fixtures';

test.afterEach(({ page }) => expect(pageErrors(page)).toEqual([]));

const shot = async (page: Page, name: string): Promise<void> => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot(name);
};

test('phone: table', async ({ page }) => {
  await open(page, { mobile: true, fixture: { table: tableFile() } });
  await shot(page, 'phone-table.png');
});

test('phone: kanban', async ({ page }) => {
  await open(page, { mobile: true, kind: 'board', fixture: { board: boardConfig([{ name: 'Board', type: 'kanban', group: 'status' }]), notes: GAME_NOTES } });
  await shot(page, 'phone-kanban.png');
});

test('phone: settings bottom sheet', async ({ page }) => {
  await open(page, { mobile: true, fixture: { table: tableFile() } });
  await page.getByLabel('View settings').click();
  await shot(page, 'phone-settings-sheet.png');
});
