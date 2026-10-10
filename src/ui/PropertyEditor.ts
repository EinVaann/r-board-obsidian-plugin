import { ToggleComponent, setIcon } from 'obsidian';
import type { PropertyConfig, PropertyType } from '../types';
import { makeReorderable, moveItem, segmented } from './reorder';

/** Render options offered per property type. */
const RENDER_OPTIONS: Record<PropertyType, string[]> = {
  image: ['fill', 'fit'],
  text: ['plain', 'badge', 'pill'],
  multi: ['pills', 'tags'],
  number: ['text', 'stars', 'bar', 'circle'],
  checkbox: ['check', 'box', 'toggle'],
  links: ['list', 'pills'],
};

const TYPE_LABELS: Record<PropertyType, string> = {
  image: 'Image',
  text: 'Text',
  multi: 'List',
  number: 'Number',
  checkbox: 'Checkbox',
  links: 'Links',
};

/** Icon per property type, shared by the property lists in settings. */
export const PROPERTY_TYPE_ICON: Record<PropertyType, string> = {
  image: 'image',
  text: 'type',
  multi: 'tags',
  number: 'hash',
  checkbox: 'check-square',
  links: 'link',
};

/** Whether a number render needs a `max` value. */
function needsMax(prop: PropertyConfig): boolean {
  return prop.type === 'number' && ['stars', 'bar', 'circle'].includes(prop.render ?? '');
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Properties whose details are expanded. Keyed by object so it survives re-renders. */
const expanded = new WeakSet<PropertyConfig>();

/** A labelled field cell inside an expanded property. */
function field(parent: HTMLElement, label: string, wide = false): HTMLElement {
  const cell = parent.createDiv({ cls: wide ? 'rb-prop-field rb-prop-field-wide' : 'rb-prop-field' });
  cell.createDiv({ cls: 'rb-prop-field-label', text: label });
  return cell;
}

function textInput(parent: HTMLElement, value: string, placeholder: string, onInput: (v: string) => void): HTMLInputElement {
  const input = parent.createEl('input', { cls: 'rb-prop-input', attr: { type: 'text', placeholder } });
  input.value = value;
  input.oninput = () => onInput(input.value);
  return input;
}

/**
 * Render an editable, reorderable list of properties into `container`. Each
 * property is a compact row (name + type) that expands to its display options.
 * Mutates `properties` in place and calls `onChange` after every edit;
 * re-renders itself on changes that affect available options or the list.
 */
export function renderPropertyEditor(
  container: HTMLElement,
  properties: PropertyConfig[],
  onChange: () => void,
): void {
  const rerender = (): void => {
    renderPropertyEditor(container, properties, onChange);
    onChange();
  };

  container.empty();
  const list = container.createDiv({ cls: 'rb-prop-list' });

  properties.forEach((prop, i) => {
    const isOpen = expanded.has(prop);
    const card = list.createDiv({ cls: isOpen ? 'rb-prop-card rb-open' : 'rb-prop-card' });

    // --- Header row: grip, type icon, name, type, expand, delete ---
    const head = card.createDiv({ cls: 'rb-prop-head' });
    setIcon(head.createSpan({ cls: 'rb-drag-handle', attr: { 'aria-label': 'Drag to reorder' } }), 'grip-vertical');
    setIcon(head.createSpan({ cls: 'rb-prop-type-icon' }), PROPERTY_TYPE_ICON[prop.type]);

    const name = head.createEl('input', {
      cls: 'rb-prop-name',
      attr: { type: 'text', placeholder: 'frontmatter key', 'aria-label': 'Frontmatter key' },
    });
    name.value = prop.name;
    name.toggleClass('rb-invalid', !prop.name.trim());
    name.oninput = () => {
      prop.name = name.value;
      name.toggleClass('rb-invalid', !prop.name.trim());
      onChange();
    };

    const typeSel = head.createEl('select', { cls: 'rb-prop-select rb-prop-type' });
    for (const t of Object.keys(RENDER_OPTIONS) as PropertyType[]) {
      typeSel.createEl('option', { text: TYPE_LABELS[t], value: t });
    }
    typeSel.value = prop.type;
    typeSel.onchange = () => {
      prop.type = typeSel.value as PropertyType;
      prop.render = RENDER_OPTIONS[prop.type][0] as PropertyConfig['render'];
      rerender();
    };

    const toggle = head.createEl('button', {
      cls: 'rb-icon-btn rb-prop-expand',
      attr: { 'aria-label': isOpen ? 'Hide options' : 'Show options' },
    });
    setIcon(toggle, 'chevron-down');
    toggle.onclick = () => {
      if (expanded.has(prop)) expanded.delete(prop);
      else expanded.add(prop);
      renderPropertyEditor(container, properties, onChange);
    };

    const remove = head.createEl('button', { cls: 'rb-icon-btn rb-prop-remove', attr: { 'aria-label': 'Remove property' } });
    setIcon(remove, 'trash-2');
    remove.onclick = () => {
      properties.splice(i, 1);
      rerender();
    };

    if (!isOpen) return;

    // --- Details: display options ---
    const body = card.createDiv({ cls: 'rb-prop-body' });

    segmented(
      field(body, 'Style', true),
      RENDER_OPTIONS[prop.type].map((r) => ({ value: r, label: capitalize(r) })),
      prop.render ?? RENDER_OPTIONS[prop.type][0],
      (v) => {
        prop.render = v as PropertyConfig['render'];
        rerender();
      },
    );

    textInput(field(body, 'Label'), prop.label ?? '', prop.name || 'Same as key', (v) => {
      prop.label = v.trim() || undefined;
      onChange();
    });

    if (needsMax(prop)) {
      const max = field(body, 'Max').createEl('input', {
        cls: 'rb-prop-input',
        attr: { type: 'number', placeholder: 'e.g. 5 or 100' },
      });
      max.value = prop.max != null ? String(prop.max) : '';
      max.oninput = () => {
        const n = Number(max.value);
        prop.max = max.value === '' || Number.isNaN(n) ? undefined : n;
        onChange();
      };
    }

    // Prefix / suffix text shown around the value on cards (not for images).
    if (prop.type !== 'image') {
      textInput(field(body, 'Prefix'), prop.prefix ?? '', 'e.g. "Score: "', (v) => {
        prop.prefix = v || undefined;
        onChange();
      });
      textInput(field(body, 'Suffix'), prop.suffix ?? '', 'e.g. "%"', (v) => {
        prop.suffix = v || undefined;
        onChange();
      });
    }

    const search = field(body, 'Searchable', true).createDiv({ cls: 'rb-prop-toggle-row' });
    search.createSpan({
      cls: 'rb-prop-toggle-desc',
      text: 'Match this property in the search bar, even when it isn’t shown.',
    });
    new ToggleComponent(search).setValue(!!prop.searchable).onChange((on) => {
      prop.searchable = on || undefined;
      onChange();
    });
  });

  makeReorderable(list, '.rb-prop-card', '.rb-drag-handle', (from, to) => {
    moveItem(properties, from, to);
    rerender();
  });

  const add = container.createEl('button', { cls: 'rb-prop-add' });
  setIcon(add.createSpan({ cls: 'rb-prop-add-icon' }), 'plus');
  add.createSpan({ text: 'Add property' });
  add.onclick = () => {
    const prop: PropertyConfig = { name: '', type: 'text', render: 'plain' };
    properties.push(prop);
    expanded.add(prop);
    rerender();
    container.querySelector<HTMLInputElement>('.rb-prop-card:last-child .rb-prop-name')?.focus();
  };
}
