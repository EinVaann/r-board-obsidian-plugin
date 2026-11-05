import { expect, test, type Locator, type Page } from '@playwright/test';
import { menu, open, pageErrors } from './harness';
import { boardConfig, GAME_NOTES, GAME_PROPERTIES } from './fixtures';

test.afterEach(({ page }) => expect(pageErrors(page)).toEqual([]));

const notes = (page: Page) => page.evaluate(() => window.__notes);
const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const column = (page: Page, title: string): Locator =>
  page.locator('.rb-kanban-col', { has: page.locator('.rb-kanban-title', { hasText: new RegExp(`^${title}$`) }) });

async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 60), { steps: 12 });
  await page.mouse.up();
}

test.describe('auto-dates (real watcher, fake metadata cache)', () => {
  const DATED = boardConfig([{ name: 'Board', type: 'kanban', group: 'status', cardSize: 'small' }], {
    properties: [...GAME_PROPERTIES, { name: 'start-date', label: 'Start', type: 'date' }, { name: 'end-date', label: 'End', type: 'date' }],
    autoDates: [
      { property: 'status', values: ['playing'], date: 'start-date' },
      { property: 'status', values: ['completed'], date: 'end-date' },
    ],
  });
  const NOTES = { ...GAME_NOTES, 'Games/Celeste.md': { ...GAME_NOTES['Games/Celeste.md'], 'start-date': undefined } };
  test.beforeEach(({ page }) => open(page, { kind: 'board', fixture: { board: DATED, notes: NOTES } }));

  test('dragging a card to Playing fills the start date, once', async ({ page }) => {
    await drag(page, column(page, 'To Play').locator('.rb-kanban-card', { hasText: 'Celeste' }), column(page, 'Playing').locator('.rb-kanban-list'));
    await expect.poll(async () => (await notes(page))['Games/Celeste.md']).toMatchObject({ status: 'playing', 'start-date': today() });

    // Park it and resume: the first start date stays.
    await page.evaluate(() => (window.__notes['Games/Celeste.md']['start-date'] = '2026-01-02'));
    await drag(page, column(page, 'Playing').locator('.rb-kanban-card', { hasText: 'Celeste' }), column(page, 'On Hold').locator('.rb-kanban-list'));
    await expect.poll(async () => (await notes(page))['Games/Celeste.md'].status).toBe('on-hold');
    await drag(page, column(page, 'On Hold').locator('.rb-kanban-card', { hasText: 'Celeste' }), column(page, 'Playing').locator('.rb-kanban-list'));
    await expect.poll(async () => (await notes(page))['Games/Celeste.md'].status).toBe('playing');
    await page.waitForTimeout(200);
    expect((await notes(page))['Games/Celeste.md']['start-date']).toBe('2026-01-02');
  });

  test('moving to Completed fills the end date; notes already playing are left alone', async ({ page }) => {
    await column(page, 'Playing').locator('.rb-kanban-card', { hasText: 'Hades' }).hover();
    await column(page, 'Playing').locator('.rb-kanban-card', { hasText: 'Hades' }).getByLabel('Card actions').click();
    await menu(page, 'Move to group');
    await menu(page, /^Completed$/);
    await expect.poll(async () => (await notes(page))['Games/Hades.md']['end-date']).toBe(today());
    // Hollow Knight was playing at load and never changed.
    expect((await notes(page))['Games/Hollow Knight.md']['start-date']).toBeUndefined();
  });

  test('a rule added in Board settings → Dates applies to later changes', async ({ page }) => {
    await page.getByLabel('Board settings').click();
    await page.getByRole('tab', { name: 'Dates' }).click();
    await expect(page.locator('.rb-auto-date')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('.rb-auto-date')).toHaveCount(0);
    const card = column(page, 'To Play').locator('.rb-kanban-card', { hasText: 'Disco Elysium' });
    await card.hover();
    await card.getByLabel('Card actions').click();
    await menu(page, 'Move to group');
    await menu(page, /^Playing$/);
    await expect.poll(async () => (await notes(page))['Games/Disco Elysium.md']['start-date']).toBe(today());
  });
});

test.describe('schedule view', () => {
  test.beforeEach(({ page }) => open(page, { kind: 'schedule' }));

  test('shows the week, the live band and both lanes from the log', async ({ page }) => {
    await expect(page.locator('.rb-schedule-week h4')).toHaveText('This week');
    await expect(page.locator('.rb-schedule-live .rb-schedule-chip')).toHaveCount(3);
    await expect(page.locator('.rb-schedule-live')).toContainText('Arknights');
    const lanes = page.locator('.rb-schedule-lane');
    await expect(lanes).toHaveCount(2);
    // The playing games run first, each in its own lane.
    const current = await page.locator('.rb-schedule-entry.is-current .rb-title').allTextContents();
    expect(current.sort()).toEqual(['Ender Magnolia Bloom in the Mist', 'Ex Astris']);
    await expect(page.locator('.rb-schedule-side')).toContainText('Is this Seat Taken');
    await expect(page.locator('.rb-schedule-footer')).toContainText('All planned done around');
  });

  test('every planned game is scheduled exactly once', async ({ page }) => {
    const titles = await page.locator('.rb-schedule-lane .rb-schedule-entry .rb-title').allTextContents();
    expect(new Set(titles).size).toBe(titles.length);
    const planned = await page.evaluate(() => Object.values(window.__notes).filter((n) => n.status === 'planned').length);
    expect(titles.length).toBe(planned + 2);
  });

  test('logged hours shorten what is left', async ({ page }) => {
    // Ex Astris: 18 h estimate, 8 h logged in the sample log.
    const ex = page.locator('.rb-schedule-entry', { hasText: 'Ex Astris' });
    await expect(ex).toContainText('10 h left');
  });

  test('changing lanes in settings redraws the forecast', async ({ page }) => {
    await page.getByLabel('View settings').click();
    await expect(page.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
    const lanes = page.locator('.setting-item', { hasText: /^Lanes/ }).locator('input');
    await lanes.fill('3');
    await page.keyboard.press('Escape');
    await expect(page.locator('.rb-schedule-lane')).toHaveCount(3);
    // The third playing game joins the lanes instead of the side list.
    await expect(page.locator('.rb-schedule-side')).toHaveCount(0);
  });

  test('a pinned game that clashes is placed anyway, with the reason shown', async ({ page }) => {
    // Pin Persona 3 Reload (JRPG) right after Ex Astris (JRPG), in Ex Astris's lane.
    const lane = await page.locator('.rb-schedule-lane').evaluateAll((els) => els.findIndex((e) => e.textContent!.includes('Ex Astris')));
    await page.evaluate((n) => {
      const s = window.__store.getState();
      const i = s.config!.views.findIndex((v) => v.type === 'schedule');
      s.updateView(i, (v) => void (v.schedule!.pins = [{ item: 'Backlog Items/Persona 3 Reload.md', lane: n, position: 0 }]));
    }, lane);
    const entries = page.locator('.rb-schedule-lane').nth(lane).locator('.rb-schedule-entry');
    await expect(entries.nth(1)).toContainText('Persona 3 Reload');
    await expect(entries.nth(1).locator('.rb-schedule-reasons')).toContainText('JRPG, like Ex Astris (just before)');
  });

  test('stacks the lanes on a phone', async ({ page }) => {
    await open(page, { kind: 'schedule', mobile: true });
    const [a, b] = await page.locator('.rb-schedule-lane').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    expect(b).toBeGreaterThan(a);
  });
});
