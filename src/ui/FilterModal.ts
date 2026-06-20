import { App, Menu, Modal, setIcon } from 'obsidian';
import {
  isFilterGroup,
  type FilterConjunction,
  type FilterGroup,
  type FilterNode,
  type FilterOp,
  type FilterRule,
  type PropertyConfig,
} from '../types';

const OP_LABELS: Record<FilterOp, string> = {
  eq: 'Is',
  ne: 'Is not',
  contains: 'Contains',
  gt: 'Greater than',
  gte: 'Greater or equal',
  lt: 'Less than',
  lte: 'Less or equal',
  empty: 'Is empty',
  notempty: 'Is not empty',
};

/** Operators that don't take a value. */
const VALUELESS: FilterOp[] = ['empty', 'notempty'];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Notion-style nested filter builder: AND/OR groups, nested groups, per-row
 * menus. Applies changes live via `onSave` (undefined = no filter).
 */
export class FilterModal extends Modal {
  private root: FilterGroup;
  private readonly properties: PropertyConfig[];
  private readonly onSave: (group: FilterGroup | undefined) => void;

  constructor(
    app: App,
    group: FilterGroup | undefined,
    properties: PropertyConfig[],
    onSave: (group: FilterGroup | undefined) => void,
  ) {
    super(app);
    this.root = group ? clone(group) : { conjunction: 'and', conditions: [] };
    this.properties = properties;
    this.onSave = onSave;
  }

  onOpen(): void {
    this.titleEl.setText('Filters');
    this.contentEl.addClass('rb-wizard', 'rb-filter-builder');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Push the current tree to the caller (undefined when empty). */
  private commit(): void {
    this.onSave(this.root.conditions.length ? clone(this.root) : undefined);
  }

  private newRule(): FilterRule {
    return { property: this.properties[0]?.name ?? '', op: 'contains', value: '' };
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    if (this.root.conditions.length === 0) {
      contentEl.createDiv({ cls: 'rb-filter-empty', text: 'No filters yet.' });
    }
    this.renderGroup(contentEl.createDiv({ cls: 'rb-filter-root' }), this.root);

    const footer = contentEl.createDiv({ cls: 'rb-filter-footer' });
    const del = footer.createEl('button', { cls: 'rb-filter-delete' });
    setIcon(del.createSpan({ cls: 'rb-filter-delete-icon' }), 'trash');
    del.createSpan({ text: 'Delete filter' });
    del.onclick = () => {
      this.root = { conjunction: 'and', conditions: [] };
      this.commit();
      this.close();
    };
  }

  /** Render a group's conditions plus its "Add filter rule" control. */
  private renderGroup(container: HTMLElement, group: FilterGroup): void {
    group.conditions.forEach((cond, i) => {
      const line = container.createDiv({ cls: 'rb-filter-line' });

      // Prefix: Where / conjunction selector / static conjunction label.
      const prefix = line.createDiv({ cls: 'rb-filter-prefix' });
      if (i === 0) {
        prefix.createSpan({ cls: 'rb-filter-where', text: 'Where' });
      } else if (i === 1) {
        const sel = prefix.createEl('select', { cls: 'rb-filter-select rb-filter-conj' });
        for (const c of ['and', 'or'] as FilterConjunction[]) {
          const o = sel.createEl('option', { text: c === 'and' ? 'And' : 'Or' });
          o.value = c;
        }
        sel.value = group.conjunction;
        sel.onchange = () => {
          group.conjunction = sel.value as FilterConjunction;
          this.commit();
          this.render();
        };
      } else {
        prefix.createSpan({
          cls: 'rb-filter-conj-static',
          text: group.conjunction === 'or' ? 'Or' : 'And',
        });
      }

      const remove = (): void => {
        group.conditions.splice(i, 1);
        this.commit();
        this.render();
      };

      if (isFilterGroup(cond)) {
        const box = line.createDiv({ cls: 'rb-filter-group-box' });
        this.renderGroup(box, cond);
        this.rowMenu(line, remove);
      } else {
        this.renderRule(line, cond);
        this.rowMenu(line, remove);
      }
    });

    // "+ Add filter rule ▾"
    const add = container.createEl('button', { cls: 'rb-filter-add' });
    setIcon(add.createSpan({ cls: 'rb-filter-add-icon' }), 'plus');
    add.createSpan({ text: 'Add filter rule' });
    setIcon(add.createSpan({ cls: 'rb-filter-add-caret' }), 'chevron-down');
    add.onclick = (e) => {
      const menu = new Menu();
      menu.addItem((it) =>
        it.setTitle('Add rule').setIcon('plus').onClick(() => {
          group.conditions.push(this.newRule());
          this.commit();
          this.render();
        }),
      );
      menu.addItem((it) =>
        it.setTitle('Add filter group').setIcon('folder-plus').onClick(() => {
          group.conditions.push({ conjunction: 'and', conditions: [this.newRule()] });
          this.commit();
          this.render();
        }),
      );
      menu.showAtMouseEvent(e);
    };
  }

  /** A single rule row: property + operator + value. */
  private renderRule(line: HTMLElement, rule: FilterRule): void {
    const body = line.createDiv({ cls: 'rb-filter-rule' });

    const propSel = body.createEl('select', { cls: 'rb-filter-select' });
    for (const p of this.properties) {
      const o = propSel.createEl('option', { text: p.label ?? p.name });
      o.value = p.name;
    }
    if (!this.properties.some((p) => p.name === rule.property) && rule.property) {
      const o = propSel.createEl('option', { text: rule.property });
      o.value = rule.property;
    }
    propSel.value = rule.property || this.properties[0]?.name || '';
    rule.property = propSel.value;
    propSel.onchange = () => {
      rule.property = propSel.value;
      this.commit();
    };

    const opSel = body.createEl('select', { cls: 'rb-filter-select' });
    (Object.keys(OP_LABELS) as FilterOp[]).forEach((op) => {
      const o = opSel.createEl('option', { text: OP_LABELS[op] });
      o.value = op;
    });
    opSel.value = rule.op;
    opSel.onchange = () => {
      rule.op = opSel.value as FilterOp;
      this.commit();
      this.render();
    };

    if (!VALUELESS.includes(rule.op)) {
      const value = body.createEl('input', {
        cls: 'rb-filter-value',
        attr: { type: 'text', placeholder: 'Value' },
      });
      value.value = rule.value != null ? String(rule.value) : '';
      value.oninput = () => {
        rule.value = value.value;
        this.commit();
      };
    }
  }

  /** The "⋯" row menu (delete). */
  private rowMenu(line: HTMLElement, onDelete: () => void): void {
    const btn = line.createEl('button', { cls: 'rb-filter-row-menu', attr: { 'aria-label': 'More' } });
    setIcon(btn, 'more-horizontal');
    btn.onclick = (e) => {
      const menu = new Menu();
      menu.addItem((it) => it.setTitle('Delete').setIcon('trash').onClick(onDelete));
      menu.showAtMouseEvent(e);
    };
  }
}
