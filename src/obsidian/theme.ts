import { App, PluginSettingTab, Setting } from 'obsidian';

export type ThemeName = 'industrial' | 'classic';
export type ThemeMode = 'auto' | 'light' | 'dark';

export interface ThemeSettings {
  theme: ThemeName;
  mode: ThemeMode;
  /** Colour of the create buttons (New note / New row): 'vault' (Obsidian's accent), a preset name, or #rrggbb. */
  accent: string;
}

export const DEFAULT_THEME: ThemeSettings = { theme: 'industrial', mode: 'auto', accent: 'vault' };

/** Muted presets for the create buttons. */
export const ACCENT_PRESETS: Record<string, { label: string; color: string }> = {
  graphite: { label: 'Graphite', color: '#2E2E32' },
  blue: { label: 'Blue', color: '#4A6FA5' },
  green: { label: 'Green', color: '#4F7F5F' },
  teal: { label: 'Teal', color: '#3F7E80' },
  purple: { label: 'Purple', color: '#6E5A9E' },
  orange: { label: 'Orange', color: '#C27A45' },
  red: { label: 'Red', color: '#B0505A' },
  yellow: { label: 'Yellow', color: '#F2D33C' },
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
  const color = accentColor(s.accent);
  if (color) {
    body.style.setProperty('--rb-user-accent', color);
    body.style.setProperty('--rb-user-accent-fg', textOn(color));
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
  const accent = typeof o.accent === 'string' && (o.accent === 'vault' || HEX.test(o.accent) || o.accent in ACCENT_PRESETS) ? o.accent : 'vault';
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

    const custom = HEX.test(s.accent);
    const accent = new Setting(containerEl)
      .setName('Button color')
      .setDesc('The New note / New row button and other create buttons. Vault accent uses your Obsidian accent color.')
      .addDropdown((d) => {
        d.addOption('vault', 'Vault accent');
        for (const [key, p] of Object.entries(ACCENT_PRESETS)) d.addOption(key, p.label);
        d.addOption('custom', 'Custom…')
          .setValue(custom ? 'custom' : s.accent)
          .onChange(async (v) => {
            // Custom starts from the color shown now, then the picker refines it.
            const next = v === 'custom' ? accentColor(this.get().accent) ?? ACCENT_PRESETS.blue.color : v;
            await this.set({ ...this.get(), accent: next });
            this.display();
          });
      });
    if (custom) accent.addColorPicker((c) => c.setValue(s.accent).onChange(async (v) => this.set({ ...this.get(), accent: v })));
  }
}
