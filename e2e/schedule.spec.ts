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

  test('shows the week, the live & side cards above both lanes', async ({ page }) => {
    await expect(page.locator('.rb-schedule-week h4')).toHaveText('This week');
    await expect(page.locator('.rb-schedule-card.is-live')).toHaveCount(3);
    await expect(page.locator('.rb-schedule-card.is-side')).toHaveText([/Is this Seat Taken.*Also playing/]);
    // Live cards come first, then side cards.
    await expect(page.locator('.rb-schedule-card').last()).toHaveClass(/is-side/);
    // The group sits above the lanes.
    await expect(page.locator('.rb-schedule-section-toggle')).toHaveText([/Live & side/, /Lanes/]);
    const lanes = page.locator('.rb-schedule-lane');
    await expect(lanes).toHaveCount(2);
    const current = await page.locator('.rb-schedule-entry.is-current .rb-title').allTextContents();
    expect(current.sort()).toEqual(['Ender Magnolia Bloom in the Mist', 'Ex Astris']);
    await expect(page.locator('.rb-schedule-overflow')).toHaveCount(0);
    // No search or filter: sections decide what shows.
    await expect(page.locator('.rb-search')).toHaveCount(0);
    await expect(page.locator('.rb-controls-row')).toHaveCount(0);
    // Live and side cards keep a Log time button.
    await expect(page.getByRole('button', { name: 'Log time for Reverse 1999' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log time for Is this Seat Taken' })).toBeVisible();
    await expect(page.locator('.rb-schedule-footer')).toContainText('All planned done around');
  });

  test('the schedule follows note properties changed elsewhere', async ({ page }) => {
    const set = (path: string, values: Record<string, unknown>) =>
      page.evaluate(
        ([p, v]) => {
          Object.assign(window.__notes[p as string], v);
          window.__store.getState().bumpVault();
        },
        [path, values] as const,
      );
    // Is this Seat Taken back to planned: it leaves the cards and joins the queue.
    await set('Backlog Items/Is this Seat Taken.md', { status: 'planned' });
    await expect(page.locator('.rb-schedule-card.is-side')).toHaveCount(0);
    await expect(page.locator('.rb-schedule-lane .rb-schedule-draggable', { hasText: 'Is this Seat Taken' })).toHaveCount(1);
    // Ex Astris on hold: its lane frees up.
    await set('Backlog Items/Ex Astris.md', { status: 'on-hold' });
    await expect(page.locator('.rb-schedule-entry.is-current', { hasText: 'Ex Astris' })).toHaveCount(0);
    await expect(page.locator('.rb-schedule-free')).toHaveCount(1);
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
    await page.getByRole('spinbutton', { name: 'Lanes' }).fill('3');
    await page.keyboard.press('Escape');
    await expect(page.locator('.rb-schedule-lane')).toHaveCount(3);
    // The casual game stays a card: lanes are for non-casual games.
    await expect(page.locator('.rb-schedule-card.is-side')).toHaveCount(1);
  });

  test('settings: the seven sections are fixed, and editing one saves them all', async ({ page }) => {
    await page.getByLabel('View settings').click();
    const rows = page.locator('.rb-sched-section');
    await expect(rows.locator('.rb-sched-section-name')).toHaveText(['Live', 'Also playing', 'Lanes', 'Queue', 'On hold', 'Completed', 'Dropped']);
    // No renaming, adding or removing.
    await expect(page.locator('input[aria-label="Section name"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Remove (Lanes|Queue)/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add section' })).toHaveCount(0);
    // to-play joins the queue through the value box: "is" becomes "is any of".
    const queue = rows.nth(3);
    const values = queue.locator('[data-slot="multi-select-trigger"]');
    await values.click();
    await queue.getByRole('option', { name: 'to-play' }).click();
    await expect(values).toHaveText(/planned, to-play/);
    const sections = await page.evaluate(() => window.__store.getState().config!.views[0].schedule!.sections!);
    expect(sections[3].conditions).toEqual([{ property: 'status', op: 'anyOf', value: ['planned', 'to-play'] }]);
    // Removing Lanes' only condition switches it off, with a warning.
    await rows.nth(2).getByRole('button', { name: 'Remove condition' }).click();
    await expect(rows.nth(2).locator('.rb-sched-section-off')).toBeVisible();
    await expect(page.locator('.rb-sched-error')).toContainText('Give Lanes a condition');
    await page.getByRole('button', { name: 'Reset to the guessed sections' }).click();
    await expect(rows).toHaveCount(7);
    await expect(page.locator('.rb-sched-error')).toHaveCount(0);
  });

  test('settings: similar groups are chips you add and remove', async ({ page }) => {
    await page.getByLabel('View settings').click();
    await expect(page.locator('.rb-sched-similar-group')).toHaveText([/^JRPG ≈ Visual novel/]);
    await page.getByLabel('New similar group').fill('Roguelike, Deckbuilder');
    await page.keyboard.press('Enter');
    await expect(page.locator('.rb-sched-similar-group')).toHaveCount(2);
    await page.getByRole('button', { name: 'Remove JRPG, Visual novel' }).click();
    const similar = await page.evaluate(() => window.__store.getState().config!.views[0].schedule!.similar);
    expect(similar).toEqual([['Roguelike', 'Deckbuilder']]);
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

  test('the right-click menu is the same short one everywhere', async ({ page }) => {
    const items = [
      page.locator('.rb-schedule-entry.is-current').first(),
      page.locator('.rb-schedule-draggable .rb-schedule-entry').first(),
      page.locator('.rb-schedule-card.is-live').first(),
      page.locator('.rb-schedule-card.is-side').first(),
    ];
    for (const el of items) {
      await el.click({ button: 'right' });
      await expect(page.locator('.dev-menu .menu-item')).toHaveText(['Move…', 'Log play time…', 'Open note']);
      await page.keyboard.press('Escape');
    }
  });

  test('Move → Completed finishes a running game; its lane offers what is next', async ({ page }) => {
    const index = await page.locator('.rb-schedule-lane').evaluateAll((els) => els.findIndex((e) => e.querySelector('.is-current')?.textContent?.includes('Ex Astris')));
    const lane = page.locator('.rb-schedule-lane').nth(index);
    await page.locator('.rb-schedule-entry.is-current', { hasText: 'Ex Astris' }).click({ button: 'right' });
    await menu(page, 'Move…');
    const modal = page.locator('.rb-schedule-move');
    // Shown sections first, the current one picked; the end sections below, each saying what it writes.
    await expect(modal.locator('.rb-move-dests').first().locator('.rb-move-dest-name')).toHaveText([/^Live/, /^Also playing/, /^Lanes\s*now/, /^Queue/]);
    await expect(modal.getByRole('radio', { name: /^Lanes/ })).toHaveAttribute('aria-checked', 'true');
    await expect(modal.locator('.rb-move-dests.is-end .rb-move-dest-name')).toHaveText(['On hold', 'Completed', 'Dropped']);
    await expect(modal.locator('.rb-move-dest', { hasText: 'Completed' })).toContainText('status → completed');
    // Picking an end only selects it; Move applies it.
    await modal.locator('.rb-move-dest', { hasText: 'Completed' }).click();
    await expect(modal.getByRole('radio', { name: /Completed/ })).toHaveAttribute('aria-checked', 'true');
    await expect(modal.locator('.rb-move-summary')).toHaveText('status → completed');
    expect((await notes(page))['Backlog Items/Ex Astris.md'].status).toBe('playing');
    await modal.getByRole('button', { name: 'Move', exact: true }).click();
    await expect.poll(async () => (await notes(page))['Backlog Items/Ex Astris.md'].status).toBe('completed');
    // The freed lane shows its bar; picking from it starts a game there.
    await lane.locator('.rb-schedule-free').click();
    const next = page.locator('.rb-schedule-modal');
    await expect(next).toContainText("What's next in lane");
    const options = next.locator('.rb-schedule-option');
    await expect(options.first()).toContainText('suggested');
    const pick = (await options.nth(1).locator('.rb-schedule-option-title').textContent())!.trim();
    await options.nth(1).click();
    await expect.poll(async () => (await notes(page))[`Backlog Items/${pick}.md`].status).toBe('playing');
    await expect(lane.locator('.rb-schedule-entry.is-current')).toContainText(pick);
    await expect(page.locator('.rb-schedule-card.is-side')).toContainText('Is this Seat Taken');
  });

  test('Move: also playing → a lane unticks casual; a lane game → also playing ticks it', async ({ page }) => {
    // Free a lane first, so the side game can take it.
    await page.evaluate(() => {
      window.__notes['Backlog Items/Ex Astris.md'].status = 'on-hold';
      window.__store.getState().bumpVault();
    });
    await expect(page.locator('.rb-schedule-free')).toHaveCount(1);
    await page.locator('.rb-schedule-card.is-side').click({ button: 'right' });
    await menu(page, 'Move…');
    const modal = page.locator('.rb-schedule-move');
    await expect(modal.getByRole('radio', { name: /^Lanes/ })).toContainText('casual off');
    await modal.getByRole('radio', { name: /^Lanes/ }).click();
    // A free lane is picked already, and the footer says what will happen.
    await expect(modal.getByRole('radiogroup', { name: 'Lane' }).getByRole('radio', { checked: true })).toContainText('free');
    await expect(modal.locator('.rb-move-summary')).toContainText('casual off');
    await modal.getByRole('button', { name: 'Move', exact: true }).click();
    await expect.poll(async () => (await notes(page))['Backlog Items/Is this Seat Taken.md']).toMatchObject({ status: 'playing', casual: false });
    await expect(page.locator('.rb-schedule-entry.is-current', { hasText: 'Is this Seat Taken' })).toHaveCount(1);

    await page.locator('.rb-schedule-entry.is-current', { hasText: 'Ender Magnolia' }).click({ button: 'right' });
    await menu(page, 'Move…');
    await modal.getByRole('radio', { name: /^Also playing/ }).click();
    await modal.getByRole('button', { name: 'Move', exact: true }).click();
    await expect.poll(async () => (await notes(page))['Backlog Items/Ender Magnolia Bloom in the Mist.md'].casual).toBe(true);
    await expect(page.locator('.rb-schedule-card.is-side', { hasText: 'Ender Magnolia' })).toHaveCount(1);
  });

  test('Move: one modal places a queued game, pins it and sets not-before', async ({ page }) => {
    const laneA = page.locator('.rb-schedule-lane').nth(0);
    const laneB = page.locator('.rb-schedule-lane').nth(1);
    await expect(laneA.locator('.rb-schedule-index').first()).toHaveClass(/is-now/);
    await expect(laneA.locator('.rb-schedule-draggable .rb-schedule-index').nth(0)).toHaveText('1');
    const fifth = laneA.locator('.rb-schedule-draggable').nth(4);
    const title = (await fifth.locator('.rb-title').textContent())!;
    await fifth.locator('.rb-schedule-entry').click({ button: 'right' });
    await menu(page, 'Move…');
    const modal = page.locator('.rb-schedule-move');
    await expect(modal.getByRole('radio', { name: /^Queue/ })).toHaveAttribute('aria-checked', 'true');
    await expect(modal.getByRole('radio', { name: /^Lane A/ })).toHaveAttribute('aria-checked', 'true');
    await expect(modal.getByLabel('Let the schedule decide')).toBeChecked();
    await expect(modal.getByRole('button', { name: 'Move', exact: true })).toBeDisabled();
    // Lane B: placing by hand starts at the end of its queue, shown in the whole list.
    await modal.getByRole('radio', { name: /^Lane B/ }).click();
    await modal.getByLabel('Let the schedule decide').uncheck();
    await expect(modal.locator('.rb-move-row.is-me')).toContainText(title);
    await expect(modal.locator('.rb-move-queue .rb-move-row').last()).toHaveClass(/is-me/);
    // Clicking a game adds this one right after it; the numbers follow.
    const second = (await modal.locator('.rb-move-queue .rb-move-row.is-pick:not(.is-top)').nth(1).locator('.rb-move-row-title').textContent())!;
    await modal.getByRole('button', { name: `Put it after ${second}` }).click();
    await expect(modal.locator('.rb-move-row.is-me .rb-schedule-index')).toHaveText('3');
    await expect(modal.getByRole('button', { name: `Put it after ${second}` })).toBeDisabled();
    // The top row puts it first.
    await modal.getByRole('button', { name: 'Put it first' }).click();
    await expect(modal.locator('.rb-move-queue .rb-move-row').first()).toHaveClass(/is-me/);
    await expect(modal.getByRole('button', { name: 'Put it first' })).toHaveCount(0);
    await expect(modal.locator('.rb-move-summary')).toHaveText('Lane B, 1st');
    await modal.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(laneB.locator('.rb-schedule-draggable').first()).toContainText(title);
    await expect(laneB.locator('.rb-schedule-draggable').first().locator('.rb-schedule-flag')).toHaveCount(1);

    // Back to the schedule's choice, with a not-before date.
    await laneB.locator('.rb-schedule-draggable').first().locator('.rb-schedule-entry').click({ button: 'right' });
    await menu(page, 'Move…');
    await expect(modal.getByLabel('Let the schedule decide')).not.toBeChecked();
    await modal.getByRole('radio', { name: /^Any lane/ }).click();
    await modal.getByRole('button', { name: "Don't start before a date…" }).click();
    await modal.getByLabel('Not before').fill('2028-06-01');
    await modal.getByRole('button', { name: 'Move', exact: true }).click();
    const entry = page.locator('.rb-schedule-entry', { hasText: title });
    await expect(entry).toContainText(/Starts Jun 1\b.*2028/);
    await expect(entry.locator('.rb-schedule-flag')).toHaveCount(0);
    const pins = await page.evaluate(() => window.__store.getState().config!.views[0].schedule!.pins);
    expect(pins).toEqual([{ item: `Backlog Items/${title}.md`, lane: -1, position: -1, notBefore: '2028-06-01' }]);
  });

  test('double-click pins a queued game where it is, and again unpins it', async ({ page }) => {
    const laneA = page.locator('.rb-schedule-lane').nth(0);
    const second = laneA.locator('.rb-schedule-draggable').nth(1);
    const title = (await second.locator('.rb-title').textContent())!;
    await second.locator('.rb-schedule-entry-line').dblclick();
    await expect(second.locator('.rb-schedule-flag')).toHaveCount(1);
    const pins = await page.evaluate(() => window.__store.getState().config!.views[0].schedule!.pins);
    expect(pins).toEqual([{ item: `Backlog Items/${title}.md`, lane: 0, position: 1 }]);
    await second.locator('.rb-schedule-entry-line').dblclick();
    await expect(page.locator('.rb-schedule-flag')).toHaveCount(0);
    // The running game has nothing to pin.
    await laneA.locator('.rb-schedule-entry.is-current .rb-schedule-entry-line').dblclick();
    await expect(page.locator('.rb-schedule-flag')).toHaveCount(0);
  });

  test('Live & side and Lanes collapse, and stay collapsed with the view', async ({ page }) => {
    const heads = page.locator('.rb-schedule-section-toggle');
    await expect(heads).toHaveText([/Live & side/, /Lanes/]);
    await expect(page.locator('[data-section="live-side"] .rb-schedule-section-hint')).toHaveText('3 live · 1 also playing');
    await page.getByRole('button', { name: 'Live & side', exact: true }).click();
    await expect(page.locator('.rb-schedule-card')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Live & side', exact: true })).toHaveAttribute('aria-expanded', 'false');
    // Clicking anywhere on the heading row toggles, keyboard too.
    await page.locator('[data-section="lanes"] .rb-schedule-section-head').click({ position: { x: 400, y: 10 } });
    await expect(page.locator('.rb-schedule-lane')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Re-plan all' })).toHaveCount(0);
    expect((await page.evaluate(() => window.__store.getState().config!.views[0].collapsed))!.sort()).toEqual(['lanes', 'live-side']);
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

  test('the drag preview follows the pointer', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    const from = page.locator('.rb-schedule-lane').nth(1).locator('.rb-schedule-draggable').nth(2);
    const a = (await from.boundingBox())!;
    const [x, y] = [a.x + 60, a.y + a.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 10, y + 10, { steps: 3 });
    await page.mouse.move(x - 300, y + 120, { steps: 12 });
    const preview = page.locator('.rb-schedule-ghost');
    await expect(preview.locator('.rb-title')).toHaveText((await from.locator('.rb-title').textContent())!);
    // Out of the scroll area (fixed there means fixed to the pane), and grabbed where it was picked up.
    expect(await preview.evaluate((el) => !el.closest('.rb-schedule'))).toBe(true);
    // dnd-kit's overlay box; the ghost inside it is tilted, which widens its own box.
    const b = (await preview.locator('..').boundingBox())!;
    expect(Math.abs(b.x - (a.x - 300))).toBeLessThan(2);
    expect(Math.abs(b.y - (a.y + 120))).toBeLessThan(2);
    await page.mouse.up();
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

  test('a live card goes on hold', async ({ page }) => {
    await page.locator('.rb-schedule-card.is-live', { hasText: 'Reverse 1999' }).click({ button: 'right' });
    await menu(page, 'Move…');
    const modal = page.locator('.rb-schedule-move');
    await modal.locator('.rb-move-dest', { hasText: 'On hold' }).click();
    await modal.getByRole('button', { name: 'Move', exact: true }).click();
    await expect.poll(async () => (await notes(page))['Backlog Items/Reverse 1999.md'].status).toBe('on-hold');
    await expect(page.locator('.rb-schedule-card', { hasText: 'Reverse 1999' })).toHaveCount(0);
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
