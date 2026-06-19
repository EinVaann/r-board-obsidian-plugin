import { App, Modal, Setting } from 'obsidian';
import type { DatabaseConfig, ViewConfig, ViewType } from '../types';
import { propertyLabel, TITLE_SORT_KEY } from '../config';
import { FilterModal } from './FilterModal';

/**
 * Edit one view's configuration: layout type, visible properties, limit,
 * grouping, sort, filters, and per-type options (card size, content, gallery
 * layout). Calls `onSave` with the updated view, or `onDelete` to remove it.
 */
export class ViewSettingsModal extends Modal {
  private view: ViewConfig;
  private readonly config: DatabaseConfig;
  private readonly onSave: (view: ViewConfig) => void;
  private readonly onDelete: () => void;

  constructor(
    app: App,
    view: ViewConfig,
    config: DatabaseConfig,
    onSave: (view: ViewConfig) => void,
    onDelete: () => void,
  ) {
    super(app);
    this.view = JSON.parse(JSON.stringify(view)) as ViewConfig;
    this.config = config;
    this.onSave = onSave;
    this.onDelete = onDelete;
  }

  onOpen(): void {
    this.titleEl.setText('View settings');
    this.contentEl.addClass('rb-wizard');
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    const v = this.view;

    new Setting(contentEl)
      .setName('Name')
      .addText((t) => t.setValue(v.name).onChange((val) => (v.name = val)));

    new Setting(contentEl).setName('Type').addDropdown((d) => {
      d.addOptions({ gallery: 'Gallery', kanban: 'Kanban', table: 'Table' });
      d.setValue(v.type);
      d.onChange((val) => {
        v.type = val as ViewType;
        this.render();
      });
    });

    new Setting(contentEl).setName('Load limit').addDropdown((d) => {
      d.addOptions({ '10': '10', '50': '50', '100': '100', none: 'No limit' });
      d.setValue(String(v.limit ?? 50));
      d.onChange((val) => {
        v.limit = val === 'none' ? 'none' : (Number(val) as 10 | 50 | 100);
      });
    });

    // --- Sort ---
    const sort = v.sort ?? { property: TITLE_SORT_KEY, dir: 'asc' as const };
    new Setting(contentEl)
      .setName('Sort by')
      .addDropdown((d) => {
        d.addOption(TITLE_SORT_KEY, 'Title');
        for (const p of this.config.properties) d.addOption(p.name, propertyLabel(p));
        d.setValue(sort.property);
        d.onChange((val) => (v.sort = { property: val, dir: (v.sort ?? sort).dir }));
      })
      .addDropdown((d) => {
        d.addOptions({ asc: 'Ascending', desc: 'Descending' });
        d.setValue(sort.dir);
        d.onChange((val) => (v.sort = { property: (v.sort ?? sort).property, dir: val as 'asc' | 'desc' }));
      });

    // --- Group ---
    new Setting(contentEl)
      .setName('Group by')
      .setDesc(v.type === 'kanban' ? 'Required: defines the kanban columns.' : 'Optional: splits items into sections.')
      .addDropdown((d) => {
        d.addOption('', v.type === 'kanban' ? '(choose a property)' : 'None');
        for (const p of this.config.properties) d.addOption(p.name, propertyLabel(p));
        d.setValue(v.group ?? '');
        d.onChange((val) => (v.group = val || undefined));
      });

    // --- Visible properties ---
    contentEl.createEl('h4', { text: 'Visible properties' });
    const visible = new Set(v.properties ?? this.config.properties.map((p) => p.name));
    for (const p of this.config.properties) {
      new Setting(contentEl).setName(propertyLabel(p)).setDesc(p.type).addToggle((t) =>
        t.setValue(visible.has(p.name)).onChange((on) => {
          if (on) visible.add(p.name);
          else visible.delete(p.name);
          // Preserve declaration order.
          v.properties = this.config.properties.map((q) => q.name).filter((n) => visible.has(n));
        }),
      );
    }

    // --- Per-type options ---
    if (v.type === 'gallery' || v.type === 'kanban') {
      new Setting(contentEl).setName('Card size').addDropdown((d) => {
        d.addOptions({ small: 'Small', medium: 'Medium', large: 'Large' });
        d.setValue(v.cardSize ?? 'medium');
        d.onChange((val) => (v.cardSize = val as 'small' | 'medium' | 'large'));
      });
      new Setting(contentEl)
        .setName('Show note content')
        .setDesc('Render an excerpt of each note on the card.')
        .addToggle((t) => t.setValue(!!v.showContent).onChange((on) => (v.showContent = on)));
    }
    if (v.type === 'gallery') {
      new Setting(contentEl).setName('Gallery layout').addDropdown((d) => {
        d.addOptions({ masonry: 'Masonry', grid: 'Grid' });
        d.setValue(v.layout ?? 'masonry');
        d.onChange((val) => (v.layout = val as 'masonry' | 'grid'));
      });
    }

    // --- Filters ---
    new Setting(contentEl)
      .setName('Filters')
      .setDesc(`${(v.filter ?? []).length} active`)
      .addButton((b) =>
        b.setButtonText('Edit filters…').onClick(() => {
          new FilterModal(this.app, v.filter ?? [], this.config.properties, (rules) => {
            v.filter = rules.length ? rules : undefined;
            this.render();
          }).open();
        }),
      );

    // --- Actions ---
    new Setting(contentEl)
      .addButton((b) => b.setButtonText('Save').setCta().onClick(() => {
        this.onSave(this.view);
        this.close();
      }))
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addExtraButton((b) =>
        b.setIcon('trash').setTooltip('Delete this view').onClick(() => {
          this.onDelete();
          this.close();
        }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
