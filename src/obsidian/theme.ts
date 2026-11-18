import { App, PluginSettingTab, Setting } from 'obsidian';

export type ThemeName = 'industrial' | 'classic';
export type ThemeMode = 'auto' | 'light' | 'dark';

export interface ThemeSettings {
  theme: ThemeName;
  mode: ThemeMode;
}

export const DEFAULT_THEME: ThemeSettings = { theme: 'industrial', mode: 'auto' };

const THEME_CLASSES = ['rb-theme-industrial', 'rb-theme-classic', 'rb-mode-light', 'rb-mode-dark'];

/**
 * Put the theme classes on <body>, so menus and modals (which live outside the
 * board view) get them too. `auto` follows Obsidian's own light/dark mode.
 */
export function applyTheme(doc: Document, s: ThemeSettings): void {
  const body = doc.body;
  body.removeClass(...THEME_CLASSES);
  body.addClass(`rb-theme-${s.theme}`);
  const dark = s.mode === 'auto' ? body.hasClass('theme-dark') : s.mode === 'dark';
  body.addClass(dark ? 'rb-mode-dark' : 'rb-mode-light');
}

export function clearTheme(doc: Document): void {
  doc.body.removeClass(...THEME_CLASSES);
}

export function parseTheme(raw: unknown): ThemeSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ThemeSettings>;
  return {
    theme: o.theme === 'classic' ? 'classic' : 'industrial',
    mode: o.mode === 'light' || o.mode === 'dark' ? o.mode : 'auto',
  };
}

/** Plugin settings: the look of every board and table. */
export class RBoardSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: ConstructorParameters<typeof PluginSettingTab>[1],
    private readonly get: () => ThemeSettings,
    private readonly set: (s: ThemeSettings) => Promise<void>,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.get();
    new Setting(containerEl).setName('Appearance').setHeading();
    new Setting(containerEl)
      .setName('Theme')
      .setDesc('Industrial: soft gray planes with yellow highlights. Classic: follows your Obsidian theme and accent color.')
      .addDropdown((d) =>
        d
          .addOption('industrial', 'Industrial')
          .addOption('classic', 'Classic')
          .setValue(s.theme)
          .onChange(async (v) => {
            await this.set({ ...this.get(), theme: v as ThemeName });
            this.display();
          }),
      );
    if (s.theme === 'industrial') {
      new Setting(containerEl)
        .setName('Light or dark')
        .setDesc('Auto follows Obsidian. Light or Dark applies to R Board only.')
        .addDropdown((d) =>
          d
            .addOption('auto', 'Auto')
            .addOption('light', 'Light')
            .addOption('dark', 'Dark')
            .setValue(s.mode)
            .onChange(async (v) => this.set({ ...this.get(), mode: v as ThemeMode })),
        );
    }
  }
}
