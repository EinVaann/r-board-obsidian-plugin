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
} from '../../../types/database';
import { LIST_OPS, VALUELESS_OPS, countFilterRules, opsForProperty } from '../../../lib/data/filter';
import { asArray, optionFor } from '../../../lib/render/values';
import { showMenu } from '../../../obsidian/menu';
import { Button, IconButton, Input, MultiSelect, Select } from './_components/controls';

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
        <Button
          variant="danger"
          icon="trash-2"
          disabled={root.conditions.length === 0}
          onClick={() => {
            onSave(undefined);
            onClose();
          }}
        >
          Delete filter
        </Button>
        <span className="rb-filter-summary">
          {root.conditions.length === 0
            ? 'Showing everything'
            : `${countFilterRules(root)} rule${countFilterRules(root) === 1 ? '' : 's'} · ${root.conjunction === 'or' ? 'any' : 'all'} must match`}
        </span>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
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
    showMenu(menu, e.nativeEvent);
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
                <Select<FilterConjunction>
                  size="sm"
                  className="rb-filter-conj rb:w-full"
                  aria-label="Match"
                  value={group.conjunction}
                  options={[
                    { value: 'and', label: 'And' },
                    { value: 'or', label: 'Or' },
                  ]}
                  onChange={(v) => edit((g) => void (g.conjunction = v))}
                />
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

            <IconButton icon="trash-2" size="sm" tone="danger" label={isFilterGroup(cond) ? 'Remove group' : 'Remove rule'} onClick={remove} />
          </div>
        );
      })}

      <Button variant="ghost" size="sm" icon="plus" className="rb-filter-add" onClick={openAddMenu}>
        Add filter rule…
      </Button>
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
      <Select
        size="sm"
        aria-label="Property"
        value={rule.property}
        options={[...properties.map((p) => ({ value: p.name, label: p.label ?? p.name })), ...(!prop && rule.property ? [{ value: rule.property, label: rule.property }] : [])]}
        onChange={(name) => {
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
      />
      <Select<FilterOp>
        size="sm"
        aria-label="Condition"
        value={rule.op}
        options={offered.map((op) => ({ value: op, label: label(op) }))}
        onChange={(op) =>
          edit((r) => {
            const wasList = LIST_OPS.includes(r.op);
            r.op = op;
            if (VALUELESS_OPS.includes(op)) delete r.value;
            else if (LIST_OPS.includes(op) !== wasList) r.value = LIST_OPS.includes(op) ? asArray(r.value) : asArray(r.value)[0] ?? '';
          })
        }
      />
      {!VALUELESS_OPS.includes(rule.op) && <RuleValue rule={rule} prop={prop} edit={edit} />}
    </div>
  );
}

/** The value part of a rule: option picker, date, number or text. */
function RuleValue({ rule, prop, edit }: { rule: FilterRule; prop: PropertyConfig | undefined; edit: (recipe: (r: FilterRule) => void) => void }) {
  const options = prop?.type === 'select' || prop?.type === 'multi' ? prop.options ?? [] : [];

  if (LIST_OPS.includes(rule.op) && prop && options.length) {
    // "Is any of" / "Is none of": the same dropdown checklist as schedule conditions.
    return (
      <MultiSelect
        size="sm"
        className="rb-filter-value rb:max-w-none"
        label={`Values of ${prop.label ?? prop.name}`}
        placeholder="Choose values…"
        value={asArray(rule.value).map(String)}
        options={options.map((o) => ({ value: o.value, label: optionFor(prop, o.value).label, color: optionFor(prop, o.value).color }))}
        onChange={(next) => edit((r) => void (r.value = next))}
      />
    );
  }

  if (prop?.type === 'select' && options.length && (rule.op === 'eq' || rule.op === 'ne')) {
    return (
      <Select
        size="sm"
        className="rb-filter-value"
        aria-label="Value"
        value={String(rule.value ?? '')}
        options={[{ value: '', label: 'Choose…' }, ...options.map((o) => ({ value: o.value, label: o.label ?? o.value }))]}
        onChange={(v) => edit((r) => void (r.value = v))}
      />
    );
  }

  const list = LIST_OPS.includes(rule.op);
  return (
    <Input
      size="sm"
      className="rb-filter-value"
      aria-label="Value"
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
