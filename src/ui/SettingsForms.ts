import { App, DropdownComponent, Setting, debounce, setIcon } from 'obsidian';
import type {
  CardSize,
  DatabaseConfig,
  GalleryLayout,
  GroupColumnConfig,
  SortDir,
  ViewConfig,
  ViewType,
} from '../types';
import { NO_SORT_KEY, propertyLabel, TITLE_SORT_KEY } from '../config';
import { countFilterRules } from '../data/filter';
import { PROPERTY_TYPE_ICON, renderPropertyEditor } from './PropertyEditor';
import { FilterModal } from './FilterModal';
import { makeReorderable, moveItem, segmented } from './reorder';

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
 * View settings "General" tab: name, type, paging, sort, grouping, filters.
 * Mutates `view` (a live reference into the config) in place.
 */
export function renderViewGeneral(
  app: App,
  container: HTMLElement,
  config: DatabaseConfig,
  view: ViewConfig,
  hooks: FormHooks,
  onDelete: () => void,
): void {
  new Setting(container).setName('Name').addText((t) =>
    t.setValue(view.name).onChange((v) => {
      view.name = v;
      hooks.onChange();
    }),
  );

  new Setting(container).setName('Type').addDropdown((d) => {
    d.addOptions({ gallery: 'Gallery', kanban: 'Kanban', table: 'Table', recipe: 'Recipe' });
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
  let dirDropdown: DropdownComponent | undefined;
  new Setting(container)
    .setName('Sort by')
    .addDropdown((d) => {
      d.addOption(NO_SORT_KEY, 'None');
      d.addOption(TITLE_SORT_KEY, 'Title');
      for (const p of config.properties) d.addOption(p.name, propertyLabel(p));
      d.setValue(sort.property);
      d.onChange((v) => {
        view.sort = { property: v, dir: (view.sort ?? sort).dir };
        dirDropdown?.setDisabled(v === NO_SORT_KEY);
        hooks.onChange();
      });
    })
    .addDropdown((d) => {
      dirDropdown = d;
      d.addOptions({ asc: 'Ascending', desc: 'Descending' });
      d.setValue(sort.dir);
      d.setDisabled(sort.property === NO_SORT_KEY);
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

  new Setting(container).addButton((b) =>
    b.setButtonText('Delete view').setWarning().onClick(onDelete),
  );
}

/** View settings "Display" tab: card layout and which properties show, in what order. */
export function renderViewDisplay(
  container: HTMLElement,
  config: DatabaseConfig,
  view: ViewConfig,
  hooks: FormHooks,
): void {
  // --- Layout (gallery / kanban only) ---
  if (view.type === 'gallery' || view.type === 'kanban') {
    container.createEl('h4', { text: 'Cards' });
    if (view.type === 'gallery') {
      segmented(
        new Setting(container).setName('Layout').setDesc('Masonry flows cards of any height; grid uses fixed tiles.').controlEl,
        [{ value: 'masonry', label: 'Masonry' }, { value: 'grid', label: 'Grid' }],
        view.layout ?? 'masonry',
        (v: GalleryLayout) => {
          view.layout = v;
          hooks.onChange();
        },
      );
    }
    segmented(
      new Setting(container).setName('Card size').controlEl,
      [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }],
      view.cardSize ?? 'medium',
      (v: CardSize) => {
        view.cardSize = v;
        hooks.onChange();
      },
    );
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

  // --- Properties: visibility + order ---
  // Shown properties first (in the view's order), then hidden ones (in database order).
  const shown = (view.properties ?? config.properties.map((p) => p.name))
    .filter((n) => config.properties.some((p) => p.name === n));
  const visible = new Set(shown);
  const order = [...shown, ...config.properties.map((p) => p.name).filter((n) => !visible.has(n))];
  const commit = (): void => {
    view.properties = order.filter((n) => visible.has(n));
    hooks.onChange();
  };

  const head = container.createDiv({ cls: 'rb-section-head' });
  head.createEl('h4', { text: view.type === 'table' ? 'Columns' : 'Properties' });
  const count = head.createSpan({ cls: 'rb-section-count' });
  const updateCount = (): void => count.setText(`${visible.size} of ${order.length} shown`);
  updateCount();
  head.createDiv({ cls: 'rb-spacer' });
  const bulk = (label: string, show: boolean): void => {
    head.createEl('button', { cls: 'rb-link-btn', text: label }).onclick = () => {
      order.forEach((n) => (show ? visible.add(n) : visible.delete(n)));
      commit();
      hooks.onStructureChange();
    };
  };
  bulk('Show all', true);
  bulk('Hide all', false);

  if (order.length === 0) {
    container.createDiv({ cls: 'rb-wizard-hint', text: 'This board has no properties yet — add some in Board settings.' });
    return;
  }
  container.createDiv({ cls: 'rb-wizard-hint', text: 'Drag to reorder. The title is always shown.' });

  const list = container.createDiv({ cls: 'rb-vis-list' });
  for (const name of order) {
    const prop = config.properties.find((p) => p.name === name)!;
    const row = list.createDiv({ cls: visible.has(name) ? 'rb-vis-row' : 'rb-vis-row rb-hidden' });
    setIcon(row.createSpan({ cls: 'rb-drag-handle', attr: { 'aria-label': 'Drag to reorder' } }), 'grip-vertical');
    setIcon(row.createSpan({ cls: 'rb-vis-type' }), PROPERTY_TYPE_ICON[prop.type]);
    const text = row.createDiv({ cls: 'rb-vis-text' });
    text.createSpan({ cls: 'rb-vis-name', text: propertyLabel(prop) });
    text.createSpan({ cls: 'rb-vis-meta', text: [prop.type, prop.render].filter(Boolean).join(' · ') });
    const eye = row.createEl('button', { cls: 'rb-icon-btn rb-vis-toggle' });
    const paint = (): void => {
      const on = visible.has(name);
      row.toggleClass('rb-hidden', !on);
      setIcon(eye, on ? 'eye' : 'eye-off');
      eye.setAttr('aria-label', on ? 'Hide' : 'Show');
    };
    paint();
    eye.onclick = () => {
      if (visible.has(name)) visible.delete(name);
      else visible.add(name);
      paint();
      updateCount();
      commit();
    };
  }
  makeReorderable(list, '.rb-vis-row', '.rb-drag-handle', (from, to) => {
    moveItem(order, from, to);
    commit();
  });
}

/** View settings "Columns" tab (kanban): order, label, color, visibility. */
export function renderColumnConfig(container: HTMLElement, view: ViewConfig, hooks: FormHooks): void {
  container.createDiv({
    cls: 'rb-wizard-hint',
    text: 'Pin the order of columns and give them a label, color, or hide them. '
      + 'Values not listed here follow, sorted; Uncategorized is always last.',
  });
  if (!view.group) {
    container.createDiv({ cls: 'rb-wizard-hint', text: 'Choose a "Group by" property in General first.' });
  }

  const cols = view.columns ?? [];
  const cfg = (): Record<string, GroupColumnConfig> => (view.groupConfig ??= {});

  // Color inputs fire continuously while dragging the picker; debounce the
  // persist/re-render so the board only repaints once the user settles.
  const debouncedChange = debounce(() => hooks.onChange(), 250, true);

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
}

/** Board settings "General" tab: name, base tag, new-note folder, refresh. */
export function renderBoardGeneral(
  container: HTMLElement,
  config: DatabaseConfig,
  hooks: FormHooks,
): void {
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

/** Board settings "Properties" tab: the database's property definitions. */
export function renderBoardProperties(container: HTMLElement, config: DatabaseConfig, hooks: FormHooks): void {
  renderPropertyEditor(container.createDiv(), config.properties, hooks.onChange);
}
