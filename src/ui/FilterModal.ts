import { App, Modal, Setting } from 'obsidian';
import type { FilterOp, FilterRule, PropertyConfig } from '../types';

const OP_LABELS: Record<FilterOp, string> = {
  eq: 'equals',
  ne: 'not equals',
  contains: 'contains',
  gt: 'greater than',
  gte: 'greater or equal',
  lt: 'less than',
  lte: 'less or equal',
  empty: 'is empty',
  notempty: 'is not empty',
};

/** Operators that don't take a value. */
const VALUELESS: FilterOp[] = ['empty', 'notempty'];

/** Edit a view's filter rules. Calls `onSave` with the new rule list. */
export class FilterModal extends Modal {
  private rules: FilterRule[];
  private readonly properties: PropertyConfig[];
  private readonly onSave: (rules: FilterRule[]) => void;

  constructor(
    app: App,
    rules: FilterRule[],
    properties: PropertyConfig[],
    onSave: (rules: FilterRule[]) => void,
  ) {
    super(app);
    this.rules = rules.map((r) => ({ ...r }));
    this.properties = properties;
    this.onSave = onSave;
  }

  onOpen(): void {
    this.titleEl.setText('Filters (all must match)');
    this.contentEl.addClass('rb-wizard');
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    const list = contentEl.createDiv();
    this.rules.forEach((rule, i) => {
      const setting = new Setting(list).setClass('rb-filter-row');

      setting.addDropdown((d) => {
        for (const p of this.properties) d.addOption(p.name, p.name);
        if (!this.properties.some((p) => p.name === rule.property) && rule.property) {
          d.addOption(rule.property, rule.property);
        }
        d.setValue(rule.property || this.properties[0]?.name || '');
        rule.property = d.getValue();
        d.onChange((v) => {
          rule.property = v;
        });
      });

      setting.addDropdown((d) => {
        d.addOptions(OP_LABELS);
        d.setValue(rule.op);
        d.onChange((v) => {
          rule.op = v as FilterOp;
          this.render();
        });
      });

      if (!VALUELESS.includes(rule.op)) {
        setting.addText((t) =>
          t.setPlaceholder('value').setValue(rule.value != null ? String(rule.value) : '').onChange((v) => {
            rule.value = v;
          }),
        );
      }

      setting.addExtraButton((b) =>
        b.setIcon('trash').setTooltip('Remove').onClick(() => {
          this.rules.splice(i, 1);
          this.render();
        }),
      );
    });

    new Setting(contentEl).addButton((b) =>
      b.setButtonText('Add filter').onClick(() => {
        this.rules.push({ property: this.properties[0]?.name ?? '', op: 'eq', value: '' });
        this.render();
      }),
    );

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText('Save').setCta().onClick(() => {
          this.onSave(this.rules.filter((r) => r.property));
          this.close();
        }),
      )
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
