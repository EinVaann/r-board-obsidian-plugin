import { App, Setting, debounce } from 'obsidian';
import type { CardSize, DatabaseConfig, GalleryLayout, GroupColumnConfig, SortDir, ViewConfig, ViewType } from '../types';
import { propertyLabel, TITLE_SORT_KEY } from '../config';
import { countFilterRules } from '../data/filter';
import { renderPropertyEditor } from './PropertyEditor';
import { FilterModal } from './FilterModal';

/** Callbacks the settings forms use to persist and refresh. */
export interface FormHooks {
  /** A value changed: persist and refresh the board body. */
  onChange: () => void;
  /** A change that requires re-rendering the form itself (e.g. view type). */
  onStructureChange: () => void;
  /** Re-query notes from the vault (full refresh). */
  onRefresh?: () => void;
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

  // Group — kanban columns can only be plain-text properties.
  const groupProps = view.type === 'kanban'
    ? config.properties.filter((p) => p.type === 'text')
    : config.properties;
  new Setting(container)
    .setName('Group by')
    .setDesc(view.type === 'kanban' ? 'Required: a text property defines the columns.' : 'Optional: section headers.')
    .addDropdown((d) => {
      d.addOption('', view.type === 'kanban' ? '(choose a text property)' : 'None');
      for (const p of groupProps) d.addOption(p.name, propertyLabel(p));
      d.setValue(view.group ?? '');
      d.onChange((v) => {
        view.group = v || undefined;
        hooks.onChange();
      });
    });

  // Kanban column config (order, label, color, visibility).
  if (view.type === 'kanban') {
    renderColumnConfig(container, view, hooks);
  }

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
    .setDesc(`${countFilterRules(view.filter)} active`)
    .addButton((b) =>
      b.setButtonText('Edit filters…').onClick(() => {
        new FilterModal(app, view.filter, config.properties, (group) => {
          view.filter = group;
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

/** Editable list of kanban column overrides: order, label, color, visibility. */
function renderColumnConfig(container: HTMLElement, view: ViewConfig, hooks: FormHooks): void {
  container.createEl('h4', { text: 'Column settings' });

  const cols = view.columns ?? [];
  const cfg = (): Record<string, GroupColumnConfig> => (view.groupConfig ??= {});

  // Color inputs fire continuously while dragging the picker; debounce the
  // persist/re-render so the board only repaints once the user settles.
  const debouncedChange = debounce(() => hooks.onChange(), 250, true);

  const rerender = (): void => renderColumnConfig(container.parentElement!.createDiv(), view, hooks);

  const list = container.createDiv({ cls: 'rb-col-config-list' });

  cols.forEach((key, idx) => {
    const row = list.createDiv({ cls: 'rb-col-config-row' });

    // Order number — editing moves the column to that position.
    const orderWrap = row.createDiv({ cls: 'rb-col-order-wrap' });
    const orderInput = orderWrap.createEl('input', {
      cls: 'rb-col-order-input',
      attr: { type: 'number', min: '1', max: String(cols.length), value: String(idx + 1) },
    });
    orderInput.onchange = () => {
      const target = Math.max(1, Math.min(cols.length, parseInt(orderInput.value) || 1)) - 1;
      if (target === idx) return;
      const next = [...cols];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      view.columns = next;
      hooks.onStructureChange();
    };

    const fields = row.createDiv({ cls: 'rb-col-config-fields' });

    // Raw key as reference label.
    fields.createSpan({ cls: 'rb-col-key-label', text: key });

    // Custom display label.
    const labelInput = fields.createEl('input', {
      cls: 'rb-col-field-input',
      attr: { type: 'text', placeholder: 'Custom label…' },
    });
    labelInput.value = cfg()[key]?.label ?? '';
    labelInput.oninput = () => {
      cfg()[key] = { ...cfg()[key], label: labelInput.value.trim() || undefined };
      hooks.onChange();
    };

    // Color for the label text.
    const colorWrap = fields.createDiv({ cls: 'rb-col-color-wrap' });
    colorWrap.createSpan({ cls: 'rb-col-color-label', text: 'Color' });
    const colorInput = colorWrap.createEl('input', {
      cls: 'rb-col-color-input',
      attr: { type: 'color', value: cfg()[key]?.color ?? '#888888' },
    });
    const clearColor = colorWrap.createEl('button', { cls: 'rb-col-clear-color', text: '✕' });
    if (!cfg()[key]?.color) clearColor.style.visibility = 'hidden';
    colorInput.oninput = () => {
      cfg()[key] = { ...cfg()[key], color: colorInput.value };
      clearColor.style.visibility = 'visible';
      debouncedChange();
    };
    clearColor.onclick = () => {
      cfg()[key] = { ...cfg()[key], color: undefined };
      clearColor.style.visibility = 'hidden';
      hooks.onChange();
    };

    // Hidden toggle.
    const hiddenWrap = fields.createDiv({ cls: 'rb-col-hidden-wrap' });
    hiddenWrap.createSpan({ cls: 'rb-col-hidden-label', text: 'Hide' });
    const hiddenCheck = hiddenWrap.createEl('input', { attr: { type: 'checkbox' } });
    hiddenCheck.checked = cfg()[key]?.hidden ?? false;
    hiddenCheck.onchange = () => {
      cfg()[key] = { ...cfg()[key], hidden: hiddenCheck.checked || undefined };
      hooks.onChange();
    };

    // Remove from explicit order list.
    const removeBtn = row.createEl('button', { cls: 'rb-col-remove-btn', text: '×' });
    removeBtn.onclick = () => {
      view.columns = cols.filter((_, i) => i !== idx);
      hooks.onStructureChange();
    };
  });

  // Add a column value to the explicit order list.
  const addRow = container.createDiv({ cls: 'rb-col-add-row' });
  const addInput = addRow.createEl('input', {
    cls: 'rb-col-add-input',
    attr: { type: 'text', placeholder: 'Column value…' },
  });
  const addBtn = addRow.createEl('button', { cls: 'rb-col-add-btn', text: '+ Add' });
  const doAdd = (): void => {
    const val = addInput.value.trim();
    if (val && !cols.includes(val)) {
      view.columns = [...cols, val];
      hooks.onStructureChange();
    }
    addInput.value = '';
  };
  addBtn.onclick = doAdd;
  addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  void rerender; // referenced to keep TS happy; re-render happens via onStructureChange
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

  new Setting(container)
    .setName('New note location')
    .setDesc('Folder where the "New note" button creates notes. Required for that button.')
    .addText((t) =>
      t.setPlaceholder('e.g. Games/Backlog').setValue(config.newNoteFolder ?? '').onChange((v) => {
        config.newNoteFolder = v.trim() || undefined;
        hooks.onChange();
      }),
    );

  container.createEl('h4', { text: 'Properties' });
  renderPropertyEditor(container.createDiv(), config.properties, hooks.onChange);

  if (hooks.onRefresh) {
    const refresh = hooks.onRefresh;
    new Setting(container)
      .setName('Refresh index')
      .setDesc('Re-query notes from the vault.')
      .addButton((b) =>
        b.setButtonText('Refresh').onClick(() => refresh()),
      );
  }
}
