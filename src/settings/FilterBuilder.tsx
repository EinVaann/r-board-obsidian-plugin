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
import { LIST_OPS, VALUELESS_OPS, opsForProperty } from '../data/filter';
import { asArray, optionFor } from '../render/values';

const OP_LABELS: Record<FilterOp, string> = {
  eq: 'Is',
  ne: 'Is not',
  contains: 'Contains',
  notContains: 'Does not contain',
  startsWith: 'Starts with',
  endsWith: 'Ends with',
  gt: 'Greater than',
  gte: 'Greater or equal',
  lt: 'Less than',
  lte: 'Less or equal',
  before: 'Is before',
  after: 'Is after',
  onOrBefore: 'Is on or before',
  onOrAfter: 'Is on or after',
  anyOf: 'Is any of',
  noneOf: 'Is none of',
  checked: 'Is checked',
  unchecked: 'Is unchecked',
  empty: 'Is empty',
  notempty: 'Is not empty',
};

/** Op labels that read better for multi-value properties. */
const MULTI_LABELS: Partial<Record<FilterOp, string>> = { eq: 'Has', ne: 'Does not have', anyOf: 'Has any of', noneOf: 'Has none of' };

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

  const newRule = (): FilterRule => ({ property: properties[0]?.name ?? '', op: opsForProperty(properties[0])[0], value: '' });

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

/** A single rule row: property + operator (offered by type) + a value input that fits both. */
function Rule({ rule, properties, edit }: { rule: FilterRule; properties: PropertyConfig[]; edit: (recipe: (r: FilterRule) => void) => void }) {
  const prop = properties.find((p) => p.name === rule.property);
  const ops = opsForProperty(prop);
  const offered = ops.includes(rule.op) ? ops : [...ops, rule.op];
  const label = (op: FilterOp): string => (prop?.type === 'multi' && MULTI_LABELS[op]) || OP_LABELS[op];

  return (
    <div className="rb-filter-rule">
      <select
        className="rb-filter-select"
        value={rule.property}
        onChange={(e) => {
          const name = e.target.value;
          const next = properties.find((p) => p.name === name);
          edit((r) => {
            r.property = name;
            // A type change keeps the operator only when it still applies.
            if (next?.type !== prop?.type) {
              const allowed = opsForProperty(next);
              if (!allowed.includes(r.op)) r.op = allowed[0];
              r.value = LIST_OPS.includes(r.op) ? [] : '';
            }
          });
        }}
      >
        {properties.map((p) => (
          <option key={p.name} value={p.name}>
            {p.label ?? p.name}
          </option>
        ))}
        {!prop && rule.property && <option value={rule.property}>{rule.property}</option>}
      </select>
      <select
        className="rb-filter-select"
        value={rule.op}
        onChange={(e) => {
          const op = e.target.value as FilterOp;
          edit((r) => {
            const wasList = LIST_OPS.includes(r.op);
            r.op = op;
            if (VALUELESS_OPS.includes(op)) delete r.value;
            else if (LIST_OPS.includes(op) !== wasList) r.value = LIST_OPS.includes(op) ? asArray(r.value) : asArray(r.value)[0] ?? '';
          });
        }}
      >
        {offered.map((op) => (
          <option key={op} value={op}>
            {label(op)}
          </option>
        ))}
      </select>
      {!VALUELESS_OPS.includes(rule.op) && <RuleValue rule={rule} prop={prop} edit={edit} />}
    </div>
  );
}

/** The value part of a rule: option picker, date, number or text. */
function RuleValue({ rule, prop, edit }: { rule: FilterRule; prop: PropertyConfig | undefined; edit: (recipe: (r: FilterRule) => void) => void }) {
  const options = prop?.type === 'select' || prop?.type === 'multi' ? prop.options ?? [] : [];

  if (LIST_OPS.includes(rule.op) && prop && options.length) {
    const chosen = asArray(rule.value);
    return (
      <div className="rb-filter-options">
        {options.map((o) => {
          const on = chosen.includes(o.value);
          const opt = optionFor(prop, o.value);
          return (
            <button
              key={o.value}
              className={on ? 'rb-pill rb-opt rb-filter-option rb-on' : 'rb-pill rb-opt rb-filter-option'}
              style={{ '--oc': opt.color } as React.CSSProperties}
              aria-pressed={on}
              onClick={() => edit((r) => void (r.value = on ? chosen.filter((v) => v !== o.value) : [...chosen, o.value]))}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (prop?.type === 'select' && options.length && (rule.op === 'eq' || rule.op === 'ne')) {
    return (
      <select className="rb-filter-select rb-filter-value" value={String(rule.value ?? '')} onChange={(e) => edit((r) => void (r.value = e.target.value))}>
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label ?? o.value}
          </option>
        ))}
      </select>
    );
  }

  const list = LIST_OPS.includes(rule.op);
  return (
    <input
      className="rb-filter-value"
      type={prop?.type === 'number' && !list ? 'number' : 'text'}
      placeholder={prop?.type === 'date' ? 'YYYY-MM-DD, today, today-7' : list ? 'Values, comma-separated' : 'Value'}
      value={list ? asArray(rule.value).join(', ') : rule.value != null ? String(rule.value) : ''}
      onChange={(e) => {
        const text = e.target.value;
        edit((r) => void (r.value = list ? text.split(',').map((s) => s.trim()).filter(Boolean) : text));
      }}
    />
  );
}
