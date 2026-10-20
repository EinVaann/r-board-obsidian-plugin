/**
 * The Data tab of a `.factory` file: Recipes (inputs/outputs as item chips),
 * Items (registered from the recipes; each needs a transport type — missing
 * ones are flagged) and Transport (tiers grouped by type).
 */

import { useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Menu, type App } from 'obsidian';
import { ReactModal, useApp } from '../react/mount';
import { itemKey, type Amount } from './parse';
import { fmt } from './FlowGraph';
import { NumCommit, TextCommit } from './inputs';
import {
  itemList,
  machineNames,
  newRecipe,
  newTier,
  renameItem,
  setItemTransport,
  typeNames,
  type DataTab,
  type FactoryData,
  type RecipeRow,
  type TierRow,
} from './book';

interface PaneProps {
  data: FactoryData;
  onChange: (d: FactoryData) => void;
}

export function DataEditor({ tab, data, onChange }: PaneProps & { tab: DataTab }) {
  const items = useMemo(() => itemList(data), [data]);
  return (
    <div className="rb-dx">
      <datalist id="rb-dx-items">
        {items.map((i) => (
          <option key={i.name} value={i.name} />
        ))}
      </datalist>
      <datalist id="rb-dx-machines">
        {machineNames(data).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {tab === 'recipes' && <RecipesPane data={data} onChange={onChange} />}
      {tab === 'items' && <ItemsPane data={data} onChange={onChange} />}
      {tab === 'transport' && <TransportPane data={data} onChange={onChange} />}
    </div>
  );
}

/** Items that have no transport type, for the tab badge. */
export function missingTransport(data: FactoryData): number {
  return itemList(data).filter((i) => i.made + i.used > 0 && !i.transport).length;
}

// ------------------------------------------------------------------ Recipes

function RecipesPane({ data, onChange }: PaneProps) {
  const [query, setQuery] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const shown = q
    ? data.recipes.filter((r) => [r.name, r.machine, ...r.inputs.map((a) => a.item), ...r.outputs.map((a) => a.item)].some((t) => t.toLowerCase().includes(q)))
    : data.recipes;

  const setRecipe = (id: string, patch: Partial<RecipeRow>): void => onChange({ ...data, recipes: data.recipes.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const add = (): void => {
    const r = newRecipe(data);
    setFresh(r.id);
    setQuery('');
    onChange({ ...data, recipes: [...data.recipes, r] });
  };
  const menu = (r: RecipeRow, evt: MouseEvent): void => {
    const m = new Menu();
    m.addItem((it) =>
      it
        .setTitle('Duplicate')
        .setIcon('copy')
        .onClick(() => {
          const copy = { ...newRecipe(data), name: r.name ? `${r.name} (copy)` : '', machine: r.machine, time: r.time, inputs: [...r.inputs], outputs: [...r.outputs] };
          const recipes = [...data.recipes];
          recipes.splice(data.recipes.indexOf(r) + 1, 0, copy);
          onChange({ ...data, recipes });
        }),
    );
    m.addItem((it) =>
      it
        .setTitle('Delete')
        .setIcon('trash')
        .setWarning(true)
        .onClick(() => onChange({ ...data, recipes: data.recipes.filter((x) => x.id !== r.id) })),
    );
    m.showAtMouseEvent(evt);
  };

  return (
    <div className="rb-dx-pane">
      <div className="rb-dx-toolbar">
        <button className="mod-cta" onClick={add}>
          + Recipe
        </button>
        <input type="search" className="rb-dx-search" placeholder="Search recipes, machines, items…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="rb-dx-count">{data.recipes.length} recipes</span>
      </div>
      {data.recipes.length === 0 ? (
        <div className="rb-dx-empty">
          No recipes yet. A recipe is a machine turning inputs into outputs over a time; every item you type is added to Items.
        </div>
      ) : (
        <div className="rb-dx-scroll">
          <table className="rb-dx-table">
            <thead>
              <tr>
                <th>Recipe</th>
                <th>Machine</th>
                <th className="rb-dx-num">Time (s)</th>
                <th>Inputs</th>
                <th>Outputs</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <TextCommit value={r.name} placeholder={r.outputs[0]?.item ?? 'Name'} onCommit={(name) => setRecipe(r.id, { name })} />
                  </td>
                  <td>
                    <TextCommit value={r.machine} placeholder="Machine" list="rb-dx-machines" onCommit={(machine) => setRecipe(r.id, { machine })} />
                  </td>
                  <td className="rb-dx-num">
                    <NumCommit value={r.time} label="time in seconds" onCommit={(time) => setRecipe(r.id, { time })} />
                  </td>
                  <td>
                    <AmountList amounts={r.inputs} onChange={(inputs) => setRecipe(r.id, { inputs })} />
                  </td>
                  <td>
                    <AmountList amounts={r.outputs} autoAdd={fresh === r.id} onChange={(outputs) => setRecipe(r.id, { outputs })} main />
                  </td>
                  <td>
                    <button className="rb-dx-icon" aria-label="Recipe actions" onClick={(e) => menu(r, e.nativeEvent)}>
                      ⋯
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Item chips ("3 × Iron Ingot"); click one to edit, + to add. */
function AmountList({ amounts, onChange, main, autoAdd }: { amounts: Amount[]; onChange: (a: Amount[]) => void; main?: boolean; autoAdd?: boolean }) {
  const [editing, setEditing] = useState<number | null>(autoAdd && !amounts.length ? 0 : null);
  const list = editing === amounts.length ? [...amounts, { item: '', qty: 1 }] : amounts;
  const commit = (i: number, a: Amount | null): void => {
    setEditing(null);
    const next = [...amounts];
    if (!a || !a.item.trim()) {
      if (i < amounts.length) next.splice(i, 1);
    } else if (i < amounts.length) next[i] = a;
    else next.push(a);
    if (JSON.stringify(next) !== JSON.stringify(amounts)) onChange(next);
  };
  return (
    <div className="rb-dx-chips">
      {list.map((a, i) =>
        editing === i ? (
          <ChipEditor key={i} amount={a} onDone={(v) => commit(i, v)} />
        ) : (
          <span key={i} className={main && i === 0 ? 'rb-dx-chip is-main' : 'rb-dx-chip'} title={main && i === 0 ? 'Main product' : 'Click to edit'} onClick={() => setEditing(i)}>
            <b>{fmt(a.qty)}</b> {a.item}
          </span>
        ),
      )}
      {editing === null && (
        <button className="rb-dx-add" aria-label="Add item" onClick={() => setEditing(amounts.length)}>
          +
        </button>
      )}
    </div>
  );
}

function ChipEditor({ amount, onDone }: { amount: Amount; onDone: (a: Amount | null) => void }) {
  const [qty, setQty] = useState(String(amount.qty));
  const [item, setItem] = useState(amount.item);
  const done = useRef(false);
  const finish = (cancel = false): void => {
    if (done.current) return;
    done.current = true;
    if (cancel) return onDone(amount.item ? amount : null);
    const n = Number(qty);
    onDone(item.trim() ? { item: item.trim(), qty: Number.isFinite(n) && n > 0 ? n : 1 } : null);
  };
  const onBlur = (e: FocusEvent<HTMLSpanElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finish();
  };
  const keys = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') finish();
    if (e.key === 'Escape') finish(true);
  };
  return (
    <span className="rb-dx-chip is-editing" onBlur={onBlur}>
      <input type="number" min={0} step="any" className="rb-dx-qty" value={qty} aria-label="amount" onChange={(e) => setQty(e.target.value)} onKeyDown={keys} />
      <input type="text" className="rb-dx-item" value={item} list="rb-dx-items" placeholder="Item" autoFocus aria-label="item" onChange={(e) => setItem(e.target.value)} onKeyDown={keys} />
    </span>
  );
}

// ------------------------------------------------------------------ Items

const NEW_TYPE = '\u0000new';

function ItemsPane({ data, onChange }: PaneProps) {
  const app = useApp();
  const [onlyMissing, setOnlyMissing] = useState(false);
  const items = itemList(data);
  const types = typeNames(data);
  const missing = items.filter((i) => i.made + i.used > 0 && !i.transport);
  const shown = onlyMissing ? missing : items;

  const pick = (item: string, value: string): void => {
    if (value === NEW_TYPE) return newTypeDialog(app, data, (d, type) => onChange(setItemTransport(d, item, type)));
    onChange(setItemTransport(data, item, value || null));
  };
  const setAllMissing = (type: string): void => {
    if (type === NEW_TYPE) return newTypeDialog(app, data, (d, t) => onChange(missing.reduce((acc, i) => setItemTransport(acc, i.name, t), d)));
    if (type) onChange(missing.reduce((acc, i) => setItemTransport(acc, i.name, type), data));
  };

  return (
    <div className="rb-dx-pane">
      <div className="rb-dx-toolbar">
        <label className="rb-dx-toggle">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          Only missing transport
        </label>
        {missing.length > 0 && (
          <span className="rb-dx-warn">
            ⚠ {missing.length} item{missing.length === 1 ? '' : 's'} without transport ·{' '}
            <select value="" onChange={(e) => setAllMissing(e.target.value)} aria-label="Set all missing">
              <option value="">set all to…</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value={NEW_TYPE}>New transport type…</option>
            </select>
          </span>
        )}
        <span className="rb-dx-count">{items.length} items</span>
      </div>
      {items.length === 0 ? (
        <div className="rb-dx-empty">Items appear here as you add them to recipes.</div>
      ) : (
        <div className="rb-dx-scroll">
          <table className="rb-dx-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Transport</th>
                <th className="rb-dx-num">Made by</th>
                <th className="rb-dx-num">Used by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => {
                const unused = i.made + i.used === 0;
                const flag = !unused && !i.transport;
                return (
                  <tr key={itemKey(i.name)} className={unused ? 'is-unused' : flag ? 'is-flagged' : undefined}>
                    <td>
                      <TextCommit value={i.name} onCommit={(to) => to && onChange(renameItem(data, i.name, to))} />
                    </td>
                    <td>
                      <select value={i.transport ?? ''} onChange={(e) => pick(i.name, e.target.value)} className={flag ? 'is-missing' : undefined}>
                        <option value="">{flag ? '⚠ none' : '— none —'}</option>
                        {types.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                        {i.transport && !types.some((t) => itemKey(t) === itemKey(i.transport!)) && <option value={i.transport}>{i.transport} (no tiers)</option>}
                        <option value={NEW_TYPE}>New transport type…</option>
                      </select>
                    </td>
                    <td className="rb-dx-num">{i.made || '—'}</td>
                    <td className="rb-dx-num">{i.used || '—'}</td>
                    <td>
                      {unused && (
                        <button className="rb-dx-icon" title="Not in any recipe: remove" aria-label="Remove item" onClick={() => onChange(setItemTransport(data, i.name, null))}>
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Transport

function TransportPane({ data, onChange }: PaneProps) {
  const app = useApp();
  const types = typeNames(data);
  const setTier = (id: string, patch: Partial<TierRow>): void => onChange({ ...data, transport: data.transport.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const renameType = (from: string, to: string): void => {
    if (!to || to === from) return;
    onChange({
      ...data,
      transport: data.transport.map((t) => (itemKey(t.type) === itemKey(from) ? { ...t, type: to } : t)),
      items: data.items.map((i) => (i.transport && itemKey(i.transport) === itemKey(from) ? { ...i, transport: to } : i)),
    });
  };
  const deleteType = (type: string): void =>
    onChange({
      ...data,
      transport: data.transport.filter((t) => itemKey(t.type) !== itemKey(type)),
      items: data.items.filter((i) => !i.transport || itemKey(i.transport) !== itemKey(type)),
    });
  const users = (type: string): number => data.items.filter((i) => i.transport && itemKey(i.transport) === itemKey(type)).length;

  return (
    <div className="rb-dx-pane">
      <div className="rb-dx-toolbar">
        <button className="mod-cta" onClick={() => newTypeDialog(app, data, (d) => onChange(d))}>
          + Transport type
        </button>
        <span className="rb-dx-hint">Each type (belt, pipe, cart…) has tiers; a rate is items per minute on one lane.</span>
      </div>
      {types.length === 0 ? (
        <div className="rb-dx-empty">No transport yet. Add a type, then give items that type in the Items tab.</div>
      ) : (
        <div className="rb-dx-scroll rb-dx-types">
          {types.map((type) => (
            <div key={type} className="rb-dx-type">
              <div className="rb-dx-type-head">
                <TextCommit value={type} onCommit={(to) => renameType(type, to)} />
                <span className="rb-dx-count">
                  {users(type)} item{users(type) === 1 ? '' : 's'}
                </span>
                <button onClick={() => onChange({ ...data, transport: [...data.transport, newTier(data, type)] })}>+ Tier</button>
                <button className="rb-dx-icon" aria-label={`Delete ${type}`} title={`Delete ${type} and its tiers`} onClick={() => deleteType(type)}>
                  ×
                </button>
              </div>
              {data.transport
                .filter((t) => itemKey(t.type) === itemKey(type))
                .map((t) => (
                  <div key={t.id} className="rb-dx-tier">
                    <TextCommit value={t.name} onCommit={(name) => name && setTier(t.id, { name })} />
                    <NumCommit value={t.rate} label={`${t.name} rate`} onCommit={(rate) => setTier(t.id, { rate })} />
                    <span className="rb-dx-hint">/min</span>
                    <button className="rb-dx-icon" aria-label={`Delete ${t.name}`} onClick={() => onChange({ ...data, transport: data.transport.filter((x) => x.id !== t.id) })}>
                      ×
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ask for a new transport type and its first tier; `done` gets the data with it added and the type name. */
function newTypeDialog(app: App, data: FactoryData, done: (d: FactoryData, type: string) => void): void {
  new ReactModal(
    app,
    (modal) => (
      <form
        className="rb-fx-dialog rb-dx-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget.elements;
          const type = (f.namedItem('type') as HTMLInputElement).value.trim();
          const tier = (f.namedItem('tier') as HTMLInputElement).value.trim();
          const rate = Number((f.namedItem('rate') as HTMLInputElement).value);
          if (!type) return;
          const row = newTier(data, type, tier || `${type} Mk1`, rate > 0 ? rate : 60);
          done({ ...data, transport: [...data.transport, row] }, type);
          modal.close();
        }}
      >
        <label>
          Type
          <input name="type" type="text" placeholder="Belt, Pipe, Cart…" autoFocus />
        </label>
        <label>
          First tier
          <input name="tier" type="text" placeholder="e.g. Belt Mk1" />
        </label>
        <label>
          Rate per lane (/min)
          <input name="rate" type="number" min={0} step="any" defaultValue={60} />
        </label>
        <div className="rb-fx-dialog-buttons">
          <button type="button" onClick={() => modal.close()}>
            Cancel
          </button>
          <button type="submit" className="mod-cta">
            Add
          </button>
        </div>
      </form>
    ),
    { title: 'New transport type' },
  ).open();
}
