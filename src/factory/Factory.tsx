/**
 * A ```factory block: recipes (from a `.table` and/or the block) solved into
 * production plans, each drawn as a node graph with a summary. The rate is
 * editable in place; edits to the tables re-solve live.
 */

import { useEffect, useMemo, useState } from 'react';
import { TFile } from 'obsidian';
import { useApp } from '../react/mount';
import { parseTableFile, type TableFile } from '../table/format';
import { itemsFromTable, recipesFromTable, transportFromTable, type Amount, type FactoryRecipe, type FactorySpec, type Per } from './parse';
import { requestFromSpec, solveFactory, type Plan } from './solve';
import { FlowGraph, fmt, machineSplit, machineUse } from './FlowGraph';
import { defaultsFromNames, type TransportBook } from './transport';
import { bookFromData, type Book } from './book';
import { parseFactoryDoc } from './plan';

export { fmt };

const PER_LABEL: Record<Per, string> = { sec: 's', min: 'min', hour: 'h' };

type Loaded<T> = { value: T; errors: string[] };

/** A `.table` file by link or path, parsed and re-read whenever it changes. null while loading. */
function useTable<T>(file: string | undefined, sourcePath: string, read: (t: TableFile) => Loaded<T>, empty: T): Loaded<T> | null {
  const app = useApp();
  const [loaded, setLoaded] = useState<Loaded<T> | null>(file ? null : { value: empty, errors: [] });
  useEffect(() => {
    if (!file) {
      setLoaded({ value: empty, errors: [] });
      return;
    }
    const find = (p: string): TFile | null => {
      const f = app.metadataCache.getFirstLinkpathDest(p, sourcePath) ?? app.vault.getAbstractFileByPath(p);
      return f instanceof TFile ? f : null;
    };
    const dest = find(file) ?? find(`${file}.table`);
    if (!dest || dest.extension !== 'table') {
      setLoaded({ value: empty, errors: [`No .table file "${file}".`] });
      return;
    }
    let live = true;
    const load = async (): Promise<void> => {
      const r = parseTableFile(await app.vault.read(dest));
      if (!live) return;
      if (!r.ok) setLoaded({ value: empty, errors: [`${dest.basename}: ${r.error}`] });
      else setLoaded(read(r.table));
    };
    void load();
    const ref = app.vault.on('modify', (f) => {
      if (f.path === dest.path) void load();
    });
    return () => {
      live = false;
      app.vault.offref(ref);
    };
    // `read` and `empty` are module-level constants at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, file, sourcePath]);
  return loaded;
}

const readRecipes = (t: TableFile): Loaded<FactoryRecipe[]> => {
  const r = recipesFromTable(t.config.properties, t.rows, t.config.titleProperty);
  return { value: r.recipes, errors: r.errors };
};
const NO_RECIPES: FactoryRecipe[] = [];
const readItems = (t: TableFile): Loaded<Map<string, string>> => {
  const r = itemsFromTable(t.config.properties, t.rows, t.config.titleProperty);
  return { value: r.types, errors: r.errors };
};
const NO_ITEMS = new Map<string, string>();
const readTiers = (t: TableFile): Loaded<TransportBook['tiers']> => {
  const r = transportFromTable(t.config.properties, t.rows, t.config.titleProperty);
  return { value: r.tiers, errors: r.errors };
};
const NO_TIERS: TransportBook['tiers'] = [];

/** The recipe book: recipes, plus the optional items and transport tables. null while the recipes load. */
export function useRecipeBook(files: { recipes?: string; items?: string; transport?: string }, sourcePath: string) {
  const recipes = useTable(files.recipes, sourcePath, readRecipes, NO_RECIPES);
  const items = useTable(files.items, sourcePath, readItems, NO_ITEMS);
  const tiers = useTable(files.transport, sourcePath, readTiers, NO_TIERS);
  const transport: TransportBook | undefined = useMemo(
    () => (tiers?.value.length ? { tiers: tiers.value, types: items?.value ?? new Map() } : undefined),
    [tiers, items],
  );
  return useMemo(
    () => (recipes ? { recipes: recipes.value, transport, errors: [...recipes.errors, ...(items?.errors ?? []), ...(tiers?.errors ?? [])] } : null),
    [recipes, items, tiers, transport],
  );
}

/** The data set of a `.factory` file, re-read whenever it changes. null while loading. */
function useFactoryBook(file: string | undefined, sourcePath: string): Book | null {
  const app = useApp();
  const [book, setBook] = useState<Book | null>(null);
  useEffect(() => {
    if (!file) return;
    const f = app.metadataCache.getFirstLinkpathDest(file, sourcePath) ?? app.vault.getAbstractFileByPath(file);
    if (!(f instanceof TFile)) {
      setBook({ recipes: [], errors: [`No .factory file "${file}".`] });
      return;
    }
    let live = true;
    const load = async (): Promise<void> => {
      const r = parseFactoryDoc(await app.vault.read(f));
      if (live) setBook(r.ok ? bookFromData(r.doc.data) : { recipes: [], errors: [`${f.basename}: ${r.error}`] });
    };
    void load();
    const ref = app.vault.on('modify', (m) => {
      if (m.path === f.path) void load();
    });
    return () => {
      live = false;
      app.vault.offref(ref);
    };
  }, [app, file, sourcePath]);
  return book;
}

export function Factory({ spec, sourcePath }: { spec: FactorySpec; sourcePath: string }) {
  // `recipes:` names a .factory file (its Data tab) or a recipe .table.
  const fromFactory = /\.factory$/i.test(spec.file ?? '');
  const tables = useRecipeBook(fromFactory ? {} : { recipes: spec.file, items: spec.itemsFile, transport: spec.transportFile }, sourcePath);
  const factoryBook = useFactoryBook(fromFactory ? spec.file : undefined, sourcePath);
  const book = fromFactory ? factoryBook : tables;
  const inputMode = !!spec.input;
  const [rate, setRate] = useState<number>(spec.input?.qty ?? spec.rate ?? 0);
  const [draft, setDraft] = useState(String(rate));
  const [picked, setPicked] = useState(0);
  const per = PER_LABEL[spec.per];

  const result = useMemo(() => {
    if (!book || spec.errors.length) return null;
    const s: FactorySpec = inputMode ? { ...spec, input: { item: spec.input!.item, qty: rate } } : { ...spec, rate };
    return solveFactory([...book.recipes, ...spec.recipes], requestFromSpec(s));
  }, [book, spec, rate, inputMode]);
  const choice = useMemo(() => ({ defaults: book?.transport ? defaultsFromNames(book.transport, spec.tiers) : {}, edges: {} }), [book, spec.tiers]);

  const plans = result?.plans ?? [];
  const plan = plans[Math.min(picked, plans.length - 1)] as Plan | undefined;
  const problems = [...spec.errors, ...(book?.errors ?? []), ...(result?.problems ?? [])];

  const commit = (text: string): void => {
    const n = Number(text);
    if (Number.isFinite(n) && n > 0) setRate(n);
    else setDraft(String(rate));
  };

  return (
    <div className="rb-factory">
      <div className="rb-factory-header">
        <span className="rb-factory-title">Factory</span>
        {spec.make && (
          <div className="rb-factory-rate">
            <input
              className="rb-factory-input"
              type="number"
              min={0}
              step="any"
              value={draft}
              aria-label={inputMode ? 'input rate' : 'output rate'}
              onChange={(e) => {
                setDraft(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value !== '' && Number.isFinite(n) && n > 0) setRate(n);
              }}
              onBlur={(e) => commit(e.target.value)}
            />
            {inputMode ? (
              <span>
                {spec.input!.item} /{per} in
                {plan && (
                  <>
                    {' → '}
                    <b>
                      {fmt(plan.outputs[0].qty)} {plan.outputs[0].item}
                    </b>{' '}
                    /{per}
                  </>
                )}
              </span>
            ) : (
              <span>
                {spec.make} /{per}
              </span>
            )}
          </div>
        )}
      </div>

      {plans.length > 1 && (
        <div className="rb-factory-plans" role="tablist">
          {plans.map((p, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={plan === p}
              className={plan === p ? 'rb-factory-plan is-active' : 'rb-factory-plan'}
              onClick={() => setPicked(i)}
              title={planSummary(p, per)}
            >
              <span className="rb-factory-plan-name">{i === 0 ? 'Best' : `Alt ${i + 1}`}</span>
              <span className="rb-factory-plan-meta">{p.choices.join(' · ') || 'base recipes'}</span>
            </button>
          ))}
        </div>
      )}

      {!book && <div className="rb-factory-empty">Loading recipes…</div>}
      {plan && <FlowGraph plan={plan} per={spec.per} transport={book?.transport} choice={choice} height={spec.height} />}
      {plan && <Summary plan={plan} per={per} />}

      {problems.length > 0 && (
        <div className="rb-recipe-errors rb-factory-errors">
          {problems.map((p, i) => (
            <div key={i}>⚠ {p}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function planSummary(p: Plan, per: string): string {
  const raw = p.raw.map((a) => `${fmt(a.qty)} ${a.item}`).join(', ');
  return `${raw || 'no raw input'} /${per} · ${p.recipes.reduce((t, r) => t + machineUse(r.machines).built, 0)} machines`;
}

function Summary({ plan, per }: { plan: Plan; per: string }) {
  const rate = (a: Amount) => (
    <li key={a.item}>
      <span className="rb-factory-qty">{fmt(a.qty)}</span> {a.item} <span className="rb-factory-per">/{per}</span>
    </li>
  );
  return (
    <div className="rb-factory-summary">
      <div>
        <div className="rb-recipe-label">Raw inputs</div>
        <ul>{plan.raw.length ? plan.raw.map(rate) : <li className="rb-factory-none">none</li>}</ul>
      </div>
      <div>
        <div className="rb-recipe-label">Machines</div>
        <ul>
          {plan.recipes.map((p) => (
            <li key={p.recipe.name} title={`${fmt(p.runs)} crafts /${per}`}>
              <span className="rb-factory-qty">{machineUse(p.machines).built}</span> × {p.recipe.machine}{' '}
              <span className="rb-factory-per">({machineSplit(p.machines)}) ·</span>{' '}
              <span className="rb-factory-per">{p.recipe.name}</span>
            </li>
          ))}
        </ul>
      </div>
      {plan.surplus.length > 0 && (
        <div>
          <div className="rb-recipe-label">Surplus</div>
          <ul>{plan.surplus.map(rate)}</ul>
        </div>
      )}
    </div>
  );
}
