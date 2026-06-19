import { App, Setting } from 'obsidian';
import type { CardSize, DatabaseConfig, GalleryLayout, SortDir, ViewConfig, ViewType } from '../types';
import { propertyLabel, TITLE_SORT_KEY } from '../config';
import { renderPropertyEditor } from './PropertyEditor';
import { FilterModal } from './FilterModal';

/** Callbacks the settings forms use to persist and refresh. */
export interface FormHooks {
  /** A value changed: persist and refresh the board body. */
  onChange: () => void;
  /** A change that requires re-rendering the form itself (e.g. view type). */
  onStructureChange: () => void;
}

/**
 * Render the editable settings for one view into `container`. Mutates `view`
 * (a live reference into the config) in place.
 */
export function renderViewSettings(
  app: App,
  container: HTMLElement,
  config: DatabaseConfig,
  view: ViewConfig,
  hooks: FormHooks,
  onDelete: () => void,
): void {
  container.empty();

  new Setting(container).setName('Name').addText((t) =>
    t.setValue(view.name).onChange((v) => {
      view.name = v;
      hooks.onChange();
    }),
  );

  new Setting(container).setName('Type').addDropdown((d) => {
    d.addOptions({ gallery: 'Gallery', kanban: 'Kanban', table: 'Table' });
    d.setValue(view.type);
    d.onChange((v) => {
      view.type = v as ViewType;
      hooks.onStructureChange();
    });
  });

  new Setting(container).setName('Load limit').addDropdown((d) => {
    d.addOptions({ '10': '10', '50': '50', '100': '100', none: 'No limit' });
    d.setValue(String(view.limit ?? 50));
    d.onChange((v) => {
      view.limit = v === 'none' ? 'none' : (Number(v) as 10 | 50 | 100);
      hooks.onChange();
    });
  });

  // Sort
  const sort = view.sort ?? { property: TITLE_SORT_KEY, dir: 'asc' as const };
  new Setting(container)
    .setName('Sort by')
    .addDropdown((d) => {
      d.addOption(TITLE_SORT_KEY, 'Title');
      for (const p of config.properties) d.addOption(p.name, propertyLabel(p));
      d.setValue(sort.property);
      d.onChange((v) => {
        view.sort = { property: v, dir: (view.sort ?? sort).dir };
        hooks.onChange();
      });
    })
    .addDropdown((d) => {
      d.addOptions({ asc: 'Ascending', desc: 'Descending' });
      d.setValue(sort.dir);
      d.onChange((v) => {
        view.sort = { property: (view.sort ?? sort).property, dir: v as SortDir };
        hooks.onChange();
      });
    });

  // Group
  new Setting(container)
    .setName('Group by')
    .setDesc(view.type === 'kanban' ? 'Required: defines the columns.' : 'Optional: section headers.')
    .addDropdown((d) => {
      d.addOption('', view.type === 'kanban' ? '(choose a property)' : 'None');
      for (const p of config.properties) d.addOption(p.name, propertyLabel(p));
      d.setValue(view.group ?? '');
      d.onChange((v) => {
        view.group = v || undefined;
        hooks.onChange();
      });
    });

  // Per-type options
  if (view.type === 'gallery' || view.type === 'kanban') {
    new Setting(container).setName('Card size').addDropdown((d) => {
      d.addOptions({ small: 'Small', medium: 'Medium', large: 'Large' });
      d.setValue(view.cardSize ?? 'medium');
      d.onChange((v) => {
        view.cardSize = v as CardSize;
        hooks.onChange();
      });
    });
    new Setting(container)
      .setName('Show note content')
      .setDesc('Render an excerpt of each note on the card.')
      .addToggle((t) =>
        t.setValue(!!view.showContent).onChange((on) => {
          view.showContent = on;
          hooks.onChange();
        }),
      );
  }
  if (view.type === 'gallery') {
    new Setting(container).setName('Gallery layout').addDropdown((d) => {
      d.addOptions({ masonry: 'Masonry', grid: 'Grid' });
      d.setValue(view.layout ?? 'masonry');
      d.onChange((v) => {
        view.layout = v as GalleryLayout;
        hooks.onChange();
      });
    });
  }

  // Filters
  new Setting(container)
    .setName('Filters')
    .setDesc(`${(view.filter ?? []).length} active`)
    .addButton((b) =>
      b.setButtonText('Edit filters…').onClick(() => {
        new FilterModal(app, view.filter ?? [], config.properties, (rules) => {
          view.filter = rules.length ? rules : undefined;
          hooks.onStructureChange();
        }).open();
      }),
    );

  // Visible properties
  container.createEl('h4', { text: 'Visible properties' });
  const visible = new Set(view.properties ?? config.properties.map((p) => p.name));
  for (const p of config.properties) {
    new Setting(container).setName(propertyLabel(p)).setDesc(p.type).addToggle((t) =>
      t.setValue(visible.has(p.name)).onChange((on) => {
        if (on) visible.add(p.name);
        else visible.delete(p.name);
        view.properties = config.properties.map((q) => q.name).filter((n) => visible.has(n));
        hooks.onChange();
      }),
    );
  }

  new Setting(container).addButton((b) =>
    b.setButtonText('Delete view').setWarning().onClick(onDelete),
  );
}

/** Render database-level settings (name, base tag, properties) into `container`. */
export function renderDatabaseSettings(
  container: HTMLElement,
  config: DatabaseConfig,
  hooks: FormHooks,
): void {
  container.empty();

  new Setting(container).setName('Name').addText((t) =>
    t.setValue(config.name ?? '').onChange((v) => {
      config.name = v.trim() || undefined;
      hooks.onChange();
    }),
  );

  new Setting(container)
    .setName('Base tag')
    .setDesc('Without the leading #.')
    .addText((t) =>
      t.setValue(config.sourceTag).onChange((v) => {
        config.sourceTag = v.replace(/^#/, '').trim().toLowerCase();
        hooks.onChange();
      }),
    );

  container.createEl('h4', { text: 'Properties' });
  renderPropertyEditor(container.createDiv(), config.properties, hooks.onChange);
}
