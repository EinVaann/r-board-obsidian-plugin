import type { Menu } from 'obsidian';

/**
 * Show one of R Board's context menus at the mouse, tagged `rb-menu` so the
 * theme styles it (Obsidian's own menus are left alone).
 */
export function showMenu(menu: Menu, e: MouseEvent): void {
  menu.showAtMouseEvent(e);
  (menu as Menu & { dom?: HTMLElement }).dom?.addClass('rb-menu');
}
