import { Setting } from 'obsidian';
import type { PropertyConfig, PropertyType } from '../types';

/** Render options offered per property type. */
const RENDER_OPTIONS: Record<PropertyType, string[]> = {
  image: ['fill', 'fit'],
  text: ['plain', 'badge', 'pill'],
  multi: ['pills', 'tags'],
  number: ['text', 'stars', 'bar', 'circle'],
};

/** Whether a number render needs a `max` value. */
function needsMax(prop: PropertyConfig): boolean {
  return prop.type === 'number' && ['stars', 'bar', 'circle'].includes(prop.render ?? '');
}

/**
 * Render an editable list of properties into `container`. Mutates `properties`
 * in place; calls `onChange` after structural edits so callers can refresh
 * dependent UI. Re-renders itself on every edit.
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
    const setting = new Setting(card).setClass('rb-prop-row');

    setting.addText((t) =>
      t.setPlaceholder('name').setValue(prop.name).onChange((v) => {
        prop.name = v;
        onChange();
      }),
    );

    setting.addDropdown((d) => {
      d.addOptions({ image: 'image', text: 'text', multi: 'multi', number: 'number' });
      d.setValue(prop.type);
      d.onChange((v) => {
        prop.type = v as PropertyType;
        prop.render = RENDER_OPTIONS[prop.type][0] as PropertyConfig['render'];
        rerender();
      });
    });

    setting.addDropdown((d) => {
      for (const opt of RENDER_OPTIONS[prop.type]) d.addOption(opt, opt);
      d.setValue(prop.render ?? RENDER_OPTIONS[prop.type][0]);
      d.onChange((v) => {
        prop.render = v as PropertyConfig['render'];
        rerender();
      });
    });

    if (needsMax(prop)) {
      setting.addText((t) => {
        t.inputEl.type = 'number';
        t.inputEl.addClass('rb-prop-max');
        t.setPlaceholder('max').setValue(prop.max != null ? String(prop.max) : '');
        t.onChange((v) => {
          const n = Number(v);
          prop.max = Number.isNaN(n) ? undefined : n;
          onChange();
        });
      });
    }

    setting.addExtraButton((b) =>
      b.setIcon('trash').setTooltip('Remove property').onClick(() => {
        properties.splice(i, 1);
        rerender();
      }),
    );
  });

  new Setting(container).setClass('rb-add-row').addButton((b) =>
    b.setButtonText('+ Add property').onClick(() => {
      properties.push({ name: '', type: 'text', render: 'plain' });
      rerender();
    }),
  );
}
