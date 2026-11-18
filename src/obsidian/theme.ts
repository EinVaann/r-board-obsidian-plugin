import { App, PluginSettingTab, Setting } from 'obsidian';

export type ThemeName = 'industrial' | 'classic';
export type ThemeMode = 'auto' | 'light' | 'dark';

export interface ThemeSettings {
  theme: ThemeName;
  mode: ThemeMode;
  /**
   * Industrial's highlight colour (switches, tab underline, primary and create buttons, picked items,
   * totals, what's playing): a preset name, 'vault' (Obsidian's accent) or #rrggbb. Classic ignores it.
   */
  accent: string;
}

export const DEFAULT_THEME: ThemeSettings = { theme: 'industrial', mode: 'auto', accent: 'yellow' };

/** Highlight presets; yellow is Industrial's own. */
export const ACCENT_PRESETS: Record<string, { label: string; color: string }> = {
  yellow: { label: 'Yellow', color: '#FFE41A' },
  orange: { label: 'Orange', color: '#F0A35E' },
  red: { label: 'Red', color: '#E06C75' },
  pink: { label: 'Pink', color: '#E58FB5' },
  purple: { label: 'Purple', color: '#9B87E0' },
  blue: { label: 'Blue', color: '#6FA0E8' },
  teal: { label: 'Teal', color: '#4FBFB3' },
  green: { label: 'Green', color: '#7CC47F' },
  graphite: { label: 'Graphite', color: '#3A3A3E' },
};

const THEME_CLASSES = ['rb-theme-industrial', 'rb-theme-classic', 'rb-mode-light', 'rb-mode-dark'];
const HEX = /^#[0-9a-f]{6}$/i;

/** The chosen accent as #rrggbb, or null for the vault's accent. */
export function accentColor(accent: string): string | null {
  if (HEX.test(accent)) return accent;
  return ACCENT_PRESETS[accent]?.color ?? null;
}

/** Black or white text, whichever reads better on `hex`. */
export function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#1C1C1E' : '#FFFFFF';
}

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
  // Industrial only: its highlight colour (read as --rbi-yellow in the theme CSS). Classic follows Obsidian.
  const color = s.theme === 'industrial' ? accentColor(s.accent) : null;
  if (color) {
    body.style.setProperty('--rb-user-accent', color);
    body.style.setProperty('--rb-user-accent-fg', textOn(color));
  } else if (s.theme === 'industrial' && s.accent === 'vault') {
    body.style.setProperty('--rb-user-accent', 'var(--rb-vault-accent)');
    body.style.setProperty('--rb-user-accent-fg', '#FFFFFF');
  } else {
    body.style.removeProperty('--rb-user-accent');
    body.style.removeProperty('--rb-user-accent-fg');
  }
}

export function clearTheme(doc: Document): void {
  doc.body.removeClass(...THEME_CLASSES);
  doc.body.style.removeProperty('--rb-user-accent');
  doc.body.style.removeProperty('--rb-user-accent-fg');
}

export function parseTheme(raw: unknown): ThemeSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ThemeSettings>;
  const accent = typeof o.accent === 'string' && (o.accent === 'vault' || HEX.test(o.accent) || o.accent in ACCENT_PRESETS) ? o.accent : 'yellow';
  return {
    theme: o.theme === 'classic' ? 'classic' : 'industrial',
    mode: o.mode === 'light' || o.mode === 'dark' ? o.mode : 'auto',
    accent,
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
      .setDesc('Industrial: soft gray planes with one accent color (yellow by default). Classic: follows your Obsidian theme and accent color.')
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

      const custom = HEX.test(s.accent);
      const accent = new Setting(containerEl)
        .setName('Accent color')
        .setDesc('Switches, the active tab, the main button in dialogs, New note / New row, picked items, totals and what is playing.')
        .addDropdown((d) => {
          for (const [key, p] of Object.entries(ACCENT_PRESETS)) d.addOption(key, p.label);
          d.addOption('vault', 'Vault accent');
          d.addOption('custom', 'Custom…')
            .setValue(custom ? 'custom' : s.accent)
            .onChange(async (v) => {
              // Custom starts from the color shown now, then the picker refines it.
              const next = v === 'custom' ? accentColor(this.get().accent) ?? ACCENT_PRESETS.yellow.color : v;
              await this.set({ ...this.get(), accent: next });
              this.display();
            });
        });
      if (custom) accent.addColorPicker((c) => c.setValue(s.accent).onChange(async (v) => this.set({ ...this.get(), accent: v })));
    }
  }
}
