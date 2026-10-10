import { useState } from 'react';
import { Menu } from 'obsidian';
import { produce } from 'immer';
import {
  isFilterGroup,
  type FilterConjunction,
  type FilterGroup,
  type FilterNode,
  type FilterOp,
  type FilterRule,
  type PropertyConfig,
} from '../types';
import { Icon } from '../react/Icon';

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

/** A path of condition indexes from the root group down to a node. */
type Path = number[];

function groupAt(root: FilterGroup, path: Path): FilterGroup {
  return path.reduce((g, i) => g.conditions[i] as FilterGroup, root);
}

/**
 * Notion-style nested filter builder: AND/OR groups, nested groups, per-row
 * menus. Every change is applied live through `onSave` (undefined = no filter).
 */
export function FilterBuilder({
  initial,
  properties,
  onSave,
  onClose,
}: {
  initial: FilterGroup | undefined;
  properties: PropertyConfig[];
  onSave: (group: FilterGroup | undefined) => void;
  onClose: () => void;
}) {
  const [root, setRoot] = useState<FilterGroup>(() => initial ?? { conjunction: 'and', conditions: [] });

  const change = (recipe: (draft: FilterGroup) => void): void => {
    const next = produce(root, recipe);
    setRoot(next);
    onSave(next.conditions.length ? next : undefined);
  };

  const newRule = (): FilterRule => ({ property: properties[0]?.name ?? '', op: 'contains', value: '' });

  return (
    <div className="rb-wizard rb-filter-builder">
      {root.conditions.length === 0 && <div className="rb-filter-empty">No filters yet.</div>}
      <div className="rb-filter-root">
        <Group group={root} path={[]} properties={properties} change={change} newRule={newRule} />
      </div>
      <div className="rb-filter-footer">
        <button
          className="rb-filter-delete"
          onClick={() => {
            onSave(undefined);
            onClose();
          }}
        >
          <Icon name="trash" className="rb-filter-delete-icon" />
          <span>Delete filter</span>
        </button>
      </div>
    </div>
  );
}

interface GroupProps {
  group: FilterGroup;
  path: Path;
  properties: PropertyConfig[];
  change: (recipe: (draft: FilterGroup) => void) => void;
  newRule: () => FilterRule;
}

/** A group's conditions plus its "Add filter rule" control. */
function Group({ group, path, properties, change, newRule }: GroupProps) {
  const edit = (recipe: (g: FilterGroup) => void): void => change((root) => recipe(groupAt(root, path)));

  const openAddMenu = (e: React.MouseEvent): void => {
    const menu = new Menu();
    menu.addItem((it) => it.setTitle('Add rule').setIcon('plus').onClick(() => edit((g) => void g.conditions.push(newRule()))));
    menu.addItem((it) =>
      it
        .setTitle('Add filter group')
        .setIcon('folder-plus')
        .onClick(() => edit((g) => void g.conditions.push({ conjunction: 'and', conditions: [newRule()] }))),
    );
    menu.showAtMouseEvent(e.nativeEvent);
  };

  return (
    <>
      {group.conditions.map((cond: FilterNode, i) => {
        const remove = (): void => edit((g) => void g.conditions.splice(i, 1));
        return (
          <div key={i} className="rb-filter-line">
            {/* Prefix: Where / conjunction selector / static conjunction label. */}
            <div className="rb-filter-prefix">
              {i === 0 ? (
                <span className="rb-filter-where">Where</span>
              ) : i === 1 ? (
                <select
                  className="rb-filter-select rb-filter-conj"
                  value={group.conjunction}
                  onChange={(e) => edit((g) => void (g.conjunction = e.target.value as FilterConjunction))}
                >
                  <option value="and">And</option>
                  <option value="or">Or</option>
                </select>
              ) : (
                <span className="rb-filter-conj-static">{group.conjunction === 'or' ? 'Or' : 'And'}</span>
              )}
            </div>

            {isFilterGroup(cond) ? (
              <div className="rb-filter-group-box">
                <Group group={cond} path={[...path, i]} properties={properties} change={change} newRule={newRule} />
              </div>
            ) : (
              <Rule rule={cond} properties={properties} edit={(recipe) => edit((g) => recipe(g.conditions[i] as FilterRule))} />
            )}

            <button
              className="rb-filter-row-menu"
              aria-label="More"
              onClick={(e) => {
                const menu = new Menu();
                menu.addItem((it) => it.setTitle('Delete').setIcon('trash').onClick(remove));
                menu.showAtMouseEvent(e.nativeEvent);
              }}
            >
              <Icon name="more-horizontal" />
            </button>
          </div>
        );
      })}

      <button className="rb-filter-add" onClick={openAddMenu}>
        <Icon name="plus" className="rb-filter-add-icon" />
        <span>Add filter rule</span>
        <Icon name="chevron-down" className="rb-filter-add-caret" />
      </button>
    </>
  );
}

/** A single rule row: property + operator + value. */
function Rule({ rule, properties, edit }: { rule: FilterRule; properties: PropertyConfig[]; edit: (recipe: (r: FilterRule) => void) => void }) {
  const known = properties.some((p) => p.name === rule.property);
  return (
    <div className="rb-filter-rule">
      <select className="rb-filter-select" value={rule.property} onChange={(e) => edit((r) => void (r.property = e.target.value))}>
        {properties.map((p) => (
          <option key={p.name} value={p.name}>
            {p.label ?? p.name}
          </option>
        ))}
        {!known && rule.property && <option value={rule.property}>{rule.property}</option>}
      </select>
      <select className="rb-filter-select" value={rule.op} onChange={(e) => edit((r) => void (r.op = e.target.value as FilterOp))}>
        {(Object.keys(OP_LABELS) as FilterOp[]).map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </select>
      {!VALUELESS.includes(rule.op) && (
        <input
          className="rb-filter-value"
          type="text"
          placeholder="Value"
          value={rule.value != null ? String(rule.value) : ''}
          onChange={(e) => edit((r) => void (r.value = e.target.value))}
        />
      )}
    </div>
  );
}
