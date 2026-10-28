/** Helpers for driving the dev harness from Playwright tests. */
import { expect, type Locator, type Page } from '@playwright/test';

type Json = Record<string, unknown>;

export interface Fixture {
  table?: string;
  board?: Json;
  notes?: Record<string, Json>;
}

/** Open the harness with the given data; fails the test on any page error. */
export async function open(page: Page, opts: { kind?: 'table' | 'board' | 'embed'; fixture?: Fixture; mobile?: boolean } = {}): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as Page & { __errors?: string[] }).__errors = errors;
  if (opts.fixture) await page.addInitScript((f) => void ((window as unknown as { __fixture: unknown }).__fixture = f), opts.fixture);
  const q = new URLSearchParams();
  if (opts.kind === 'board') q.set('kind', 'board');
  if (opts.kind === 'embed') q.set('embed', '');
  if (opts.mobile) q.set('mobile', '');
  await page.goto(`/index.html?${q}`);
  await expect(page.locator(opts.kind === 'embed' ? '#root > div' : '.rb-toolbar').first()).toBeVisible();
}

/** Page errors so far (checked after every test by `noErrors`). */
export const pageErrors = (page: Page): string[] => (page as Page & { __errors?: string[] }).__errors ?? [];

/** Stored table rows (cells only), straight from the store. */
export const rows = (page: Page) =>
  page.evaluate(() => window.__store.getState().rows.map((r) => ({ id: r.id, ...r.cells })) as Array<Record<string, unknown>>);

/** The active view's config. */
export const activeView = (page: Page) =>
  page.evaluate(() => {
    const s = window.__store.getState();
    return s.config!.views.find((v) => v.name === s.activeView)!;
  });

/** The last file contents the harness "saved". */
export const saved = (page: Page) => page.evaluate(() => window.__saved);

/** Actions the fake Obsidian received (open note, notices…). */
export const log = (page: Page) => page.evaluate(() => window.__log);

/** A grid cell by row and column index (within the first grid unless `grid` is given). */
export const cell = (scope: Page | Locator, r: number, c: number): Locator => scope.locator(`[data-pos="${r}:${c}"]`).first();

/** Titles of the rendered table rows, top to bottom. */
export const titles = (scope: Page | Locator): Promise<string[]> => scope.locator('.rb-tr .rb-title').allTextContents();

/** Header labels of the first table. */
export const headers = (page: Page): Promise<string[]> => page.locator('.rb-grid').first().locator('.rb-th-label').allTextContents();

/** Click an item in the open (fake Obsidian) context menu. */
export async function menu(page: Page, title: string | RegExp): Promise<void> {
  await page.locator('.dev-menu .menu-item', { hasText: title }).first().click();
}

/** A visible view tab (not the hidden copies used to measure them). */
export const tab = (page: Page, name: string): Locator => page.locator('.rb-view-switch > .rb-view-btn:not(.rb-view-more-btn)', { hasText: name });

/** Names on the visible view tabs, without their icons. */
export const tabNames = (page: Page): Promise<string[]> =>
  page.locator('.rb-view-switch > .rb-view-btn:not(.rb-view-more-btn)').evaluateAll((els) => els.map((e) => e.lastElementChild?.textContent ?? ''));

/** Switch to a view by its tab (or through the "more" dropdown). */
export async function showView(page: Page, name: string): Promise<void> {
  const tab = page.locator('.rb-view-switch > .rb-view-btn', { hasText: name });
  if (await tab.count()) await tab.first().click();
  else {
    await page.locator('.rb-view-more-btn').click();
    await menu(page, name);
  }
  await expect.poll(() => page.evaluate(() => window.__store.getState().activeView)).toBe(name);
}

/** Visible width (px) of each column of the given table. */
export const colWidths = (table: Locator): Promise<number[]> =>
  table.locator('thead th').evaluateAll((ths) => ths.map((th) => Math.round(th.getBoundingClientRect().width)));
