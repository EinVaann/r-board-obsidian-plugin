import { Platform, Scope, type App, type Modifier } from 'obsidian';

/** A hotkey as Obsidian stores it in `hotkeys.json`. */
export interface Hotkey {
  modifiers: Modifier[];
  key: string;
}

/** Obsidian's internal hotkey manager (not in the public API); absent if it ever changes. */
interface HotkeyManager {
  getHotkeys(id: string): Hotkey[] | undefined;
  getDefaultHotkeys(id: string): Hotkey[] | undefined;
  setHotkeys(id: string, keys: Hotkey[]): void;
  removeHotkeys(id: string): void;
  printHotkeyForCommand(id: string): string;
  save(): Promise<void>;
}

function manager(app: App): HotkeyManager | null {
  const hm = (app as App & { hotkeyManager?: Partial<HotkeyManager> }).hotkeyManager;
  return hm && typeof hm.setHotkeys === 'function' && typeof hm.save === 'function' ? (hm as HotkeyManager) : null;
}

/** Whether hotkeys can be set from R Board (else use Obsidian's Hotkeys settings). */
export function canSetHotkeys(app: App): boolean {
  return manager(app) !== null;
}

/** The command's first hotkey as Obsidian prints it, or ''. */
export function printHotkey(app: App, commandId: string): string {
  return manager(app)?.printHotkeyForCommand(commandId) ?? '';
}

/** A hotkey as comparable text; `Mod` is Cmd on macOS and Ctrl elsewhere. */
function hotkeyKey(h: Hotkey): string {
  const mods = h.modifiers.map((m) => (m === 'Mod' ? (Platform.isMacOS ? 'Meta' : 'Ctrl') : m)).sort();
  return [...mods, h.key.toUpperCase()].join('+');
}

/** Names of the other commands bound to any of this command's hotkeys. */
export function hotkeyConflicts(app: App, commandId: string): string[] {
  const hm = manager(app);
  const commands = (app as App & { commands?: { commands: Record<string, { name: string }> } }).commands?.commands;
  if (!hm || !commands || typeof hm.getDefaultHotkeys !== 'function') return [];
  const effective = (id: string): Hotkey[] => hm.getHotkeys(id) ?? hm.getDefaultHotkeys(id) ?? [];
  const mine = new Set(effective(commandId).map(hotkeyKey));
  if (!mine.size) return [];
  return Object.keys(commands)
    .filter((id) => id !== commandId && effective(id).some((h) => mine.has(hotkeyKey(h))))
    .map((id) => commands[id].name);
}

/** Replace the command's hotkeys with `key` (null clears them). */
export async function setHotkey(app: App, commandId: string, key: Hotkey | null): Promise<void> {
  const hm = manager(app);
  if (!hm) return;
  if (key) hm.setHotkeys(commandId, [key]);
  else hm.removeHotkeys(commandId);
  await hm.save();
}

/** Open Settings → Hotkeys filtered to `query`. */
export function openHotkeySettings(app: App, query: string): void {
  const setting = (app as App & { setting?: { open(): void; openTabById(id: string): unknown } }).setting;
  if (!setting) return;
  setting.open();
  const tab = setting.openTabById('hotkeys') as { setQuery?: (q: string) => void } | undefined;
  tab?.setQuery?.(query);
}

/**
 * Capture the next key combination above every other scope, as Obsidian's own
 * recorder does: a modifier is required (except F-keys), Escape cancels.
 * Returns a function that stops listening.
 */
export function recordHotkey(app: App, onKey: (key: Hotkey | null) => void): () => void {
  const scope = new Scope();
  let active = true;
  const stop = (): void => {
    if (!active) return;
    active = false;
    app.keymap.popScope(scope);
  };
  scope.register(null, null, (evt, ctx) => {
    evt.preventDefault();
    const key = ctx.vkey;
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return false;
    const modifiers = (ctx.modifiers ? ctx.modifiers.split(',') : []).filter(Boolean) as Modifier[];
    if (key === 'Escape' && modifiers.length === 0) {
      stop();
      onKey(null);
      return false;
    }
    const plainShift = modifiers.length === 1 && modifiers[0] === 'Shift' && /^[a-z]$/i.test(key);
    if ((modifiers.length === 0 && !/^F[0-9]+$/i.test(key)) || plainShift) return false;
    stop();
    onKey({ modifiers, key });
    return false;
  });
  app.keymap.pushScope(scope);
  return stop;
}
