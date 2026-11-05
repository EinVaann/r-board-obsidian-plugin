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

/** Drag in small steps; the target's box is re-read before letting go (the pane may auto-scroll). */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  // Both ends must be on screen for the mouse to reach them.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  let b = (await to.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 4, 30), { steps: 12 });
  b = (await to.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 4, 30), { steps: 2 });
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

  test('Log time appends a row to the log table and the forecast follows', async ({ page }) => {
    const ex = page.locator('.rb-schedule-entry', { hasText: 'Ex Astris' });
    await expect(ex).toContainText('10 h left');
    await page.getByRole('button', { name: 'Log time for Ex Astris' }).first().click();
    await page.getByLabel('Hours').fill('4');
    await page.getByRole('button', { name: 'Log', exact: true }).click();
    await expect(ex).toContainText('6 h left');
    const rows = await page.evaluate(() => JSON.parse(window.__files['Backlog timelog.table']).rows as { cells: Record<string, unknown> }[]);
    expect(rows.at(-1)!.cells).toMatchObject({ notes: ['[[Backlog Items/Ex Astris|Ex Astris]]'], hours: 4 });
  });

  test('Finish marks the game completed and offers what is next for its lane', async ({ page }) => {
    const index = await page.locator('.rb-schedule-lane').evaluateAll((els) => els.findIndex((e) => e.querySelector('.is-current')?.textContent?.includes('Ex Astris')));
    const lane = page.locator('.rb-schedule-lane').nth(index);
    await page.getByRole('button', { name: 'Finish Ex Astris' }).click();
    await expect.poll(async () => (await notes(page))['Backlog Items/Ex Astris.md'].status).toBe('completed');
    const modal = page.locator('.rb-schedule-modal');
    await expect(modal).toContainText("What's next in lane");
    const options = modal.locator('.rb-schedule-option');
    await expect(options.first()).toContainText('suggested');
    const pick = (await options.nth(1).locator('.rb-schedule-option-title').textContent())!.trim();
    await options.nth(1).click();
    await expect.poll(async () => (await notes(page))[`Backlog Items/${pick}.md`].status).toBe('playing');
    // The picked game runs in the lane Ex Astris left; the side game stays a side game.
    await expect(lane.locator('.rb-schedule-entry.is-current')).toContainText(pick);
    await expect(page.locator('.rb-schedule-side')).toContainText('Is this Seat Taken');
  });

  test('right-click moves, pins and unpins a queued game', async ({ page }) => {
    const laneA = page.locator('.rb-schedule-lane').nth(0);
    const third = laneA.locator('.rb-schedule-draggable').nth(2);
    const title = (await third.locator('.rb-title').textContent())!;
    await third.locator('.rb-schedule-entry').click({ button: 'right' });
    await menu(page, 'Move up');
    await expect(laneA.locator('.rb-schedule-draggable').nth(1)).toContainText(title);
    await expect(laneA.locator('.rb-schedule-draggable').nth(1).locator('.rb-schedule-flag')).toHaveCount(1);

    await laneA.locator('.rb-schedule-draggable').nth(1).locator('.rb-schedule-entry').click({ button: 'right' });
    await menu(page, 'Move to lane B');
    await menu(page, '#1 (next)');
    const laneB = page.locator('.rb-schedule-lane').nth(1);
    await expect(laneB.locator('.rb-schedule-draggable').first()).toContainText(title);

    await laneB.locator('.rb-schedule-draggable').first().locator('.rb-schedule-entry').click({ button: 'right' });
    await menu(page, 'Unpin');
    await expect(page.locator('.rb-schedule-flag')).toHaveCount(0);
  });

  test('queued games are numbered; "Move to position" puts one at a number', async ({ page }) => {
    const laneA = page.locator('.rb-schedule-lane').nth(0);
    await expect(laneA.locator('.rb-schedule-index').first()).toHaveClass(/is-now/);
    await expect(laneA.locator('.rb-schedule-draggable .rb-schedule-index').nth(0)).toHaveText('1');
    await expect(laneA.locator('.rb-schedule-draggable .rb-schedule-index').nth(4)).toHaveText('5');
    const fifth = laneA.locator('.rb-schedule-draggable').nth(4);
    const title = (await fifth.locator('.rb-title').textContent())!;
    await fifth.locator('.rb-schedule-entry').click({ button: 'right' });
    await menu(page, 'Move to position');
    await menu(page, /^#2 · after/);
    await expect(laneA.locator('.rb-schedule-draggable').nth(1)).toContainText(title);
    await expect(laneA.locator('.rb-schedule-draggable').nth(1).locator('.rb-schedule-index')).toHaveText('2');
  });

  test('Live, Also playing and Lanes collapse, and stay collapsed with the view', async ({ page }) => {
    const heads = page.locator('.rb-schedule-section-toggle');
    await expect(heads).toHaveText([/Live\s*3/, /Lanes/, /Also playing\s*1/]);
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await expect(page.locator('.rb-schedule-live .rb-schedule-chip')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Live', exact: true })).toHaveAttribute('aria-expanded', 'false');
    // Clicking anywhere on the heading row toggles, keyboard too.
    await page.locator('[data-section="lanes"] .rb-schedule-section-head').click({ position: { x: 400, y: 10 } });
    await expect(page.locator('.rb-schedule-lane')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Re-plan all' })).toHaveCount(0);
    expect((await page.evaluate(() => window.__store.getState().config!.views[0].collapsed))!.sort()).toEqual(['lanes', 'live']);
    await page.getByRole('button', { name: 'Lanes', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.rb-schedule-lane')).toHaveCount(2);
    // Re-plan all in the heading doesn't toggle the section.
    await page.getByRole('button', { name: 'Re-plan all' }).click({ force: true });
    await expect(page.locator('.rb-schedule-lane')).toHaveCount(2);
  });

  test('dragging a queued game to another lane pins it there', async ({ page }) => {
    const laneA = page.locator('.rb-schedule-lane').nth(0);
    const laneB = page.locator('.rb-schedule-lane').nth(1);
    const from = laneA.locator('.rb-schedule-draggable').nth(3);
    const title = (await from.locator('.rb-title').textContent())!;
    await drag(page, from, laneB.locator('.rb-schedule-draggable').nth(0));
    await expect(laneB.locator('.rb-schedule-draggable').first()).toContainText(title);
    const pins = await page.evaluate(() => window.__store.getState().config!.views[0].schedule!.pins);
    expect(pins).toEqual([{ item: `Backlog Items/${title}.md`, lane: 1, position: 0 }]);
  });

  test('Insert puts any game into a lane, adding it to the plan', async ({ page }) => {
    await page.getByRole('button', { name: 'Insert a game into lane A' }).click();
    const modal = page.locator('.rb-schedule-modal');
    await modal.getByLabel('Search games').fill('Hades');
    await modal.locator('.rb-schedule-option', { hasText: 'Hades' }).click();
    await expect.poll(async () => (await notes(page))['Backlog Items/Hades.md'].status).toBe('planned');
    await expect(page.locator('.rb-schedule-lane').nth(0).locator('.rb-schedule-draggable').last()).toContainText('Hades');
  });

  test('Not before holds a game back until a date', async ({ page }) => {
    const laneA = page.locator('.rb-schedule-lane').nth(0);
    const first = laneA.locator('.rb-schedule-draggable').first();
    const title = (await first.locator('.rb-title').textContent())!;
    await first.locator('.rb-schedule-entry').click({ button: 'right' });
    await menu(page, 'Not before…');
    await page.locator('.rb-schedule-modal').getByLabel('Date').fill('2028-06-01');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.rb-schedule-entry', { hasText: title })).toContainText(/Starts Jun 1\b.*2028/);
  });

  test('Re-plan undoes manual moves in one lane or all, keeping not-before holds', async ({ page }) => {
    const order = (n: number) => page.locator('.rb-schedule-lane').nth(n).locator('.rb-schedule-draggable .rb-title').allTextContents();
    const before = [await order(0), await order(1)];
    await expect(page.getByRole('button', { name: 'Re-plan all' })).toBeDisabled();
    const set = (pins: unknown[]) =>
      page.evaluate((p) => {
        const s = window.__store.getState();
        s.updateView(0, (v) => void (v.schedule!.pins = p as never));
      }, pins);
    const id = (t: string) => `Backlog Items/${t}.md`;
    await set([
      { item: id(before[0][3]), lane: 0, position: 0 },
      { item: id(before[1][3]), lane: 1, position: 0 },
      { item: id(before[1][5]), lane: 1, position: 1, notBefore: '2027-09-01' },
    ]);
    await expect.poll(async () => (await order(0))[0]).toBe(before[0][3]);

    // Lane A goes back to automatic; lane B keeps its pins (so lane A may still differ from before).
    await page.getByRole('button', { name: 'Re-plan lane A' }).click();
    await expect(page.locator('.rb-schedule-lane').nth(0).locator('.rb-schedule-flag')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Lane A is in its automatic order' })).toBeDisabled();
    expect((await order(1))[0]).toBe(before[1][3]);

    await page.getByRole('button', { name: 'Re-plan all' }).click();
    // With only the not-before hold left, lane A is back to its automatic order.
    await expect.poll(async () => (await order(0)).slice(0, 3)).toEqual(before[0].slice(0, 3));
    const pins = await page.evaluate(() => window.__store.getState().config!.views[0].schedule!.pins);
    expect(pins).toEqual([{ item: id(before[1][5]), lane: 1, position: 1, notBefore: '2027-09-01' }]);
    // A not-before hold alone isn't "moved by hand", so the buttons are off again.
    await expect(page.getByRole('button', { name: 'Re-plan all' })).toBeDisabled();
  });

  test('live and side games have a right-click menu too', async ({ page }) => {
    await page.locator('.rb-schedule-live .rb-schedule-chip', { hasText: 'Reverse 1999' }).click({ button: 'right' });
    await expect(page.locator('.dev-menu .menu-item')).toHaveText(['Log play time…', 'Put on hold', 'Finish', 'Drop', 'Open note']);
    await menu(page, 'Put on hold');
    await expect.poll(async () => (await notes(page))['Backlog Items/Reverse 1999.md'].status).toBe('on-hold');
    await expect(page.locator('.rb-schedule-live')).not.toContainText('Reverse 1999');

    await page.locator('.rb-schedule-side .rb-schedule-chip').click({ button: 'right' });
    await expect(page.locator('.dev-menu .menu-item')).toContainText(['Log play time…', 'Put on hold', 'Finish', 'Drop', 'Open note']);
  });

  test('a narrow pane shows one lane at a time behind tabs', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 });
    await expect(page.locator('.rb-schedule')).toHaveClass(/is-compact/);
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toContainText('Lane A');
    await expect(page.locator('.rb-schedule-lane')).toHaveCount(1);
    await expect(page.locator('.rb-schedule-entry.is-current')).toHaveCount(1);
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.rb-schedule-lane')).toHaveAttribute('data-lane', '1');
    // Entries are one line each: title, then hours and done range.
    const entry = page.locator('.rb-schedule-draggable .rb-schedule-entry').first();
    await expect(entry.locator('.rb-schedule-entry-line')).toContainText(/h · done /);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    // Wide again: both lanes side by side.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('.rb-schedule-lane')).toHaveCount(2);
  });
});
