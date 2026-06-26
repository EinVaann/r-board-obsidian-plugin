import type { PropertyConfig, PropertyType } from '../types';

/** Render options offered per property type. */
const RENDER_OPTIONS: Record<PropertyType, string[]> = {
  image: ['fill', 'fit'],
  text: ['plain', 'badge', 'pill'],
  multi: ['pills', 'tags'],
  number: ['text', 'stars', 'bar', 'circle'],
  checkbox: ['check', 'box', 'toggle'],
  links: ['list', 'pills'],
};

/** Whether a number render needs a `max` value. */
function needsMax(prop: PropertyConfig): boolean {
  return prop.type === 'number' && ['stars', 'bar', 'circle'].includes(prop.render ?? '');
}

/** A labelled `<select>` populated from `options`. */
function makeSelect(parent: HTMLElement, options: string[], value: string): HTMLSelectElement {
  const sel = parent.createEl('select', { cls: 'rb-prop-select' });
  for (const opt of options) {
    const o = sel.createEl('option', { text: opt });
    o.value = opt;
  }
  sel.value = value;
  return sel;
}

/**
 * Render an editable list of properties into `container`. Mutates `properties`
 * in place and calls `onChange` after every edit; re-renders itself on changes
 * that affect available options (type/render) or the list (add/remove).
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

  properties.forEach((prop, i) => {
    const card = container.createDiv({ cls: 'rb-prop-card' });

    // Header: name input + remove button.
    const head = card.createDiv({ cls: 'rb-prop-head' });
    const name = head.createEl('input', {
      cls: 'rb-prop-name',
      attr: { type: 'text', placeholder: 'field name' },
    });
    name.value = prop.name;
    name.oninput = () => {
      prop.name = name.value;
      onChange();
    };
    const remove = head.createEl('button', { cls: 'rb-prop-remove', text: 'Remove' });
    remove.onclick = () => {
      properties.splice(i, 1);
      rerender();
    };

    card.createDiv({ cls: 'rb-prop-config-label', text: 'CONFIG' });

    // Type.
    const typeSel = makeSelect(card, ['image', 'text', 'multi', 'number', 'checkbox', 'links'], prop.type);
    typeSel.onchange = () => {
      prop.type = typeSel.value as PropertyType;
      prop.render = RENDER_OPTIONS[prop.type][0] as PropertyConfig['render'];
      rerender();
    };

    // Render style.
    const renderSel = makeSelect(card, RENDER_OPTIONS[prop.type], prop.render ?? RENDER_OPTIONS[prop.type][0]);
    renderSel.onchange = () => {
      prop.render = renderSel.value as PropertyConfig['render'];
      rerender();
    };

    // Max (only for stars / bar / circle).
    if (needsMax(prop)) {
      const max = card.createEl('input', {
        cls: 'rb-prop-input',
        attr: { type: 'number', placeholder: 'max' },
      });
      max.value = prop.max != null ? String(prop.max) : '';
      max.oninput = () => {
        const n = Number(max.value);
        prop.max = Number.isNaN(n) ? undefined : n;
        onChange();
      };
    }

    // Prefix / suffix text shown around the value on cards (not for images).
    if (prop.type !== 'image') {
      card.createDiv({ cls: 'rb-prop-affix-label', text: 'Prefix / Suffix' });
      const affixRow = card.createDiv({ cls: 'rb-prop-affix' });
      const prefix = affixRow.createEl('input', {
        cls: 'rb-prop-input',
        attr: { type: 'text', placeholder: 'prefix (e.g. "Score: ")' },
      });
      prefix.value = prop.prefix ?? '';
      prefix.oninput = () => {
        prop.prefix = prefix.value || undefined;
        onChange();
      };
      const suffix = affixRow.createEl('input', {
        cls: 'rb-prop-input',
        attr: { type: 'text', placeholder: 'suffix (e.g. "%")' },
      });
      suffix.value = prop.suffix ?? '';
      suffix.oninput = () => {
        prop.suffix = suffix.value || undefined;
        onChange();
      };
    }
  });

  const add = container.createEl('button', { cls: 'rb-prop-add', text: '+ Add property' });
  add.onclick = () => {
    properties.push({ name: '', type: 'text', render: 'plain' });
    rerender();
  };
}
