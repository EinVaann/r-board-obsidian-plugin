/**
 * The factory planner (a `.factory` file in its own tab): the graph on the
 * left, Output / Input / Recipes tabs on the right, a status bar below. Every
 * edit goes through `onChange` (the view saves it) and re-solves at once.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Menu } from 'obsidian';
import { itemKey, PER_SECONDS, type Amount, type Per } from './parse';
import { solveFactory, type InputRule, type Plan, type SolveResult } from './solve';
import { fmt } from './FlowGraph';
import { bookFromData } from './book';
import { NumCommit, TextCommit } from './inputs';
import { FlowGraph, machineUse } from './FlowGraph';
import { buildGraph, type GEdge, type GNode } from './graph';
import { bringIn, craftInstead, setAllTier, setEdgeTier, setInput, setUseUp, toRequest, useRecipe, type FactoryFile, type Priority } from './plan';
import { defaultTier, haul, haulKey, tiersOf, transportTypes, type Haul, type TransportChoice } from './transport';

type Tab = 'output' | 'input' | 'recipes';
const PER_LABEL: Record<Per, string> = { sec: 's', min: 'min', hour: 'h' };

const built = (p: Plan): number => p.recipes.reduce((t, r) => t + machineUse(r.machines).built, 0);

interface Props {
  file: FactoryFile;
  onChange: (next: FactoryFile) => void;
  /** Open the Data tab (from the empty-state hint). */
  openData?: () => void;
}

export function Planner({ file, onChange, openData }: Props) {
  const book = useMemo(() => bookFromData(file.data), [file.data]);
  const [tab, setTab] = useState<Tab>('output');
  const [picked, setPicked] = useState(0);
  const per = PER_LABEL[file.per];

  const result: SolveResult | null = useMemo(() => (book && book.recipes.length ? solveFactory(book.recipes, toRequest(file)) : null), [book, file]);
  const plans = result?.plans ?? [];
  const plan = plans[Math.min(picked, plans.length - 1)] as Plan | undefined;
  useEffect(() => setPicked(0), [file]);

  // Every item the recipe book knows, for the item pickers.
  const allItems = useMemo(() => {
    const names = new Map<string, string>();
    for (const r of book?.recipes ?? []) for (const a of [...r.outputs, ...r.inputs]) if (!names.has(itemKey(a.item))) names.set(itemKey(a.item), a.item);
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [book]);
  const craftable = useMemo(() => new Set<string>((book?.recipes ?? []).flatMap((r) => r.outputs.map((o) => itemKey(o.item)))), [book]);
  const transport = book?.transport;
  const choice: TransportChoice = useMemo(() => ({ defaults: file.transport, edges: file.edges }), [file.transport, file.edges]);
  // Connections that need more than one lane, and items moving with no transport type.
  const { busy, untyped } = useMemo(() => {
    if (!plan || !transport) return { busy: [] as Haul[], untyped: [] as string[] };
    const all = buildGraph(plan, file.per).edges.flatMap((e) => e.items.map((a) => ({ a, h: haul(transport, choice, file.per, e.source, e.target, a) })));
    return {
      busy: all.map((x) => x.h).filter((h): h is Haul => !!h && h.lanes > 1),
      untyped: [...new Set(all.filter((x) => !x.h).map((x) => x.a.item))],
    };
  }, [plan, transport, choice, file.per]);

  const problems = [...book.errors, ...(result?.problems ?? [])];
  const noRecipes = !book.recipes.length;
  if (noRecipes) problems.unshift('No recipes yet: add them in the Data tab.');

  const onNodeClick = (node: GNode, evt: MouseEvent): void => {
    const menu = new Menu();
    if (node.step) {
      const main = node.step.recipe.outputs[0].item;
      menu.addItem((i) => i.setTitle(`Bring ${main} in instead`).setIcon('log-in').onClick(() => onChange(bringIn(file, main))));
      const alts = result?.alternatives.get(itemKey(main));
      for (const r of alts?.recipes ?? []) {
        if (r === node.step.recipe.name) continue;
        menu.addItem((i) => i.setTitle(`Use recipe: ${r}`).setIcon('repeat').onClick(() => onChange(useRecipe(file, main, r))));
      }
      if (file.recipes[itemKey(main)]) menu.addItem((i) => i.setTitle('Pick the recipe automatically').setIcon('wand').onClick(() => onChange(useRecipe(file, main, null))));
      if (alts) menu.addItem((i) => i.setTitle('Show in Recipes').setIcon('list').onClick(() => setTab('recipes')));
    } else if (node.kind === 'raw' && node.amount) {
      const item = node.amount.item;
      if (craftable.has(itemKey(item))) menu.addItem((i) => i.setTitle(`Craft ${item} instead`).setIcon('hammer').onClick(() => onChange(craftInstead(file, item))));
      menu.addItem((i) => i.setTitle('Set a limit…').setIcon('gauge').onClick(() => setTab('input')));
    } else if (node.kind === 'out' && node.amount) {
      const item = node.amount.item;
      menu.addItem((i) => i.setTitle('Edit outputs').setIcon('list').onClick(() => setTab('output')));
      menu.addItem((i) => i.setTitle(`Remove ${item}`).setIcon('trash').onClick(() => onChange({ ...file, outputs: file.outputs.filter((o) => itemKey(o.item) !== itemKey(item)) })));
    } else if (node.kind === 'extra' && node.amount) {
      const item = node.amount.item;
      menu.addItem((i) => i.setTitle(`${item} must be used up`).setIcon('recycle').onClick(() => onChange(setUseUp(file, item, true))));
    }
    menu.showAtMouseEvent(evt);
  };

  const onEdgeClick = (edge: GEdge, hauls: (Haul | null)[], evt: MouseEvent): void => {
    if (!transport) return;
    const menu = new Menu();
    hauls.forEach((h, i) => {
      if (!h) return;
      const key = haulKey(edge.source, edge.target, edge.items[i].item);
      if (i > 0) menu.addSeparator();
      menu.addItem((it) => it.setTitle(`${h.item} · ${fmt(h.qty)} /${per}`).setIcon('package').setDisabled(true));
      for (const t of tiersOf(transport, h.type)) {
        const lanes = Math.max(1, Math.ceil((h.qty * 60) / PER_SECONDS[file.per] / t.rate - 1e-9));
        menu.addItem((it) =>
          it
            .setTitle(`${t.name} — ${lanes} lane${lanes === 1 ? '' : 's'}`)
            .setChecked(t.name === h.tier.name)
            .onClick(() => onChange(setEdgeTier(file, key, t.name === defaultTier(transport, choice, h.type)?.name ? null : t.name))),
        );
      }
      if (h.custom) menu.addItem((it) => it.setTitle('Use the plan default').setIcon('rotate-ccw').onClick(() => onChange(setEdgeTier(file, key, null))));
      menu.addItem((it) =>
        it
          .setTitle(`Use ${h.tier.name} for every ${h.type} connection`)
          .setIcon('layers')
          .onClick(() => onChange(setAllTier(file, transport, h.type, h.tier.name === tiersOf(transport, h.type)[0]?.name ? null : h.tier.name))),
      );
    });
    menu.showAtMouseEvent(evt);
  };

  return (
    <div className="rb-planner">
      <div className="rb-pl-header">
        <label className="rb-pl-field" title="Which rules drive the plan">
          Priority
          <select value={file.priority} onChange={(e) => onChange({ ...file, priority: e.target.value as Priority })}>
            <option value="output">Output</option>
            <option value="input">Input</option>
            <option value="both">Both</option>
          </select>
        </label>
        {transport &&
          transportTypes(transport).map((type) => (
            <label key={type} className="rb-pl-field">
              {type}
              <select
                value={defaultTier(transport, choice, type)?.name ?? ''}
                title={`Every ${type} connection`}
                onChange={(e) => onChange(setAllTier(file, transport, type, e.target.value === tiersOf(transport, type)[0]?.name ? null : e.target.value))}
              >
                {tiersOf(transport, type).map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} ({fmt(t.rate)}/min)
                  </option>
                ))}
              </select>
            </label>
          ))}
        <label className="rb-pl-field">
          per
          <select value={file.per} onChange={(e) => onChange({ ...file, per: e.target.value as Per })}>
            {(Object.keys(PER_SECONDS) as Per[]).map((p) => (
              <option key={p} value={p}>
                {PER_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rb-pl-body">
        <div className="rb-pl-graph">
          {plans.length > 1 && (
            <div className="rb-factory-plans rb-pl-plans" role="tablist">
              {plans.map((p, i) => (
                <button key={i} role="tab" aria-selected={plan === p} className={plan === p ? 'rb-factory-plan is-active' : 'rb-factory-plan'} onClick={() => setPicked(i)}>
                  <span className="rb-factory-plan-name">
                    {i === 0 ? 'Best' : `Alt ${i + 1}`} · {built(p)} machines
                  </span>
                  <span className="rb-factory-plan-meta">{p.choices.join(' · ') || 'base recipes'}</span>
                </button>
              ))}
            </div>
          )}
          {plan ? (
            <FlowGraph key={plans.indexOf(plan)} plan={plan} per={file.per} transport={transport} choice={choice} fill onNodeClick={onNodeClick} onEdgeClick={onEdgeClick} />
          ) : (
            <div className="rb-pl-empty">
              {problems[0] ?? 'Add an output to start.'}
              {noRecipes && openData && (
                <button className="mod-cta" onClick={openData}>
                  Open Data
                </button>
              )}
            </div>
          )}
        </div>

        <aside className="rb-pl-side">
          <div className="rb-pl-tabs" role="tablist">
            {(['output', 'input', 'recipes'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'rb-pl-tab is-active' : 'rb-pl-tab'} onClick={() => setTab(t)}>
                {t === 'output' ? 'Output' : t === 'input' ? 'Input' : 'Recipes'}
                {t === 'recipes' && result?.alternatives.size ? <span className="rb-pl-count">{result.alternatives.size}</span> : null}
              </button>
            ))}
          </div>
          <datalist id="rb-pl-items">
            {allItems.map((i) => (
              <option key={i} value={i} />
            ))}
          </datalist>
          <div className="rb-pl-pane">
            {tab === 'output' && <OutputTab file={file} plan={plan} per={per} onChange={onChange} />}
            {tab === 'input' && <InputTab file={file} plan={plan} per={per} craftable={craftable} onChange={onChange} />}
            {tab === 'recipes' && <RecipesTab file={file} plan={plan} result={result} onChange={onChange} />}
          </div>
        </aside>
      </div>

      <div className="rb-pl-status">
        {plan && (
          <span>
            <b>{built(plan)}</b> machines <span className="rb-pl-muted">at {Math.round((plan.machines / Math.max(1, built(plan))) * 100)}% average</span> · {plan.raw.length} input{plan.raw.length === 1 ? '' : 's'}
            {plan.surplus.length > 0 && ` · ${plan.surplus.length} surplus`}
          </span>
        )}
        {busy.length > 0 && (
          <span className="rb-pl-busy" title={busy.map((h) => `${h.item}: ${h.lanes}× ${h.tier.name}`).join('\n')}>
            {busy.length} connection{busy.length === 1 ? ' needs' : 's need'} more than one lane
          </span>
        )}
        {untyped.length > 0 && (
          <span className="rb-pl-busy" title={untyped.join('\n')}>
            ⚠ {untyped.length} item{untyped.length === 1 ? ' has' : 's have'} no transport{' '}
            {openData && (
              <a className="rb-pl-link" onClick={openData}>
                set in Data → Items
              </a>
            )}
          </span>
        )}
        {problems.length > 0 && (
          <span className="rb-pl-problem" title={problems.join('\n')}>
            ⚠ {problems[0]}
            {problems.length > 1 && ` (+${problems.length - 1})`}
          </span>
        )}
      </div>
    </div>
  );
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <div className="rb-pl-section">
      <div className="rb-recipe-label">{title}</div>
      {hint && <div className="rb-pl-hint">{hint}</div>}
      {children}
    </div>
  );
}

const amountOf = (list: Amount[] | undefined, item: string): number | undefined => list?.find((a) => itemKey(a.item) === itemKey(item))?.qty;

// ------------------------------------------------------------------ Output

function OutputTab({ file, plan, per, onChange }: { file: FactoryFile; plan?: Plan; per: string; onChange: (f: FactoryFile) => void }) {
  const setRow = (i: number, row: FactoryFile['outputs'][number] | null): void => {
    const outputs = [...file.outputs];
    if (row) outputs[i] = row;
    else outputs.splice(i, 1);
    onChange({ ...file, outputs });
  };
  const byproducts = new Map<string, string>();
  for (const a of plan?.surplus ?? []) byproducts.set(itemKey(a.item), a.item);
  for (const i of file.useUp) byproducts.set(itemKey(i), i);

  return (
    <>
      <Section title="Make">
        {file.outputs.map((o, i) => {
          const isMax = o.max !== undefined;
          const made = amountOf(plan?.outputs, o.item);
          const n = o.max ?? o.rate;
          const setN = (v: number): void => setRow(i, isMax ? { item: o.item, max: v } : { item: o.item, rate: v });
          return (
            <div key={i} className="rb-pl-row">
              <TextCommit value={o.item} list="rb-pl-items" placeholder="Item" onCommit={(item) => setRow(i, item ? { ...o, item } : null)} />
              {file.priority === 'both' && (
                <select value={isMax ? 'max' : 'rate'} onChange={(e) => setRow(i, e.target.value === 'max' ? { item: o.item, max: 1 } : { item: o.item, rate: made ? Number(fmt(made)) : 1 })}>
                  <option value="rate">/{per}</option>
                  <option value="max">max</option>
                </select>
              )}
              <NumCommit value={n} label={file.priority === 'input' || (file.priority === 'both' && isMax) ? 'ratio' : 'rate'} onCommit={setN} />
              {file.priority === 'output' && <span className="rb-pl-made">/{per}</span>}
              {file.priority === 'input' && <span className="rb-pl-made">ratio</span>}
              <span className="rb-pl-made">{made !== undefined && Math.abs(made - (n ?? 0)) > 1e-6 ? `→ ${fmt(made)}` : ''}</span>
              <button className="rb-pl-x" aria-label="Remove output" onClick={() => setRow(i, null)}>
                ×
              </button>
            </div>
          );
        })}
        <AddRow placeholder="Add an output…" onAdd={(item) => onChange({ ...file, outputs: [...file.outputs, { item, rate: 1 }] })} />
        <div className="rb-pl-hint">
          {file.priority === 'output'
            ? 'Output priority: these rates are delivered; input limits are ignored.'
            : file.priority === 'input'
              ? 'Input priority: as much as the input limits allow, in the ratio of these numbers.'
              : 'Both: rates and input limits all apply; "max" outputs share what is left, in ratio.'}
        </div>
      </Section>

      {byproducts.size > 0 && (
        <Section title="Byproducts" hint="Surplus leaves the factory. Tick to make the plan use it all up instead.">
          {[...byproducts.values()].map((item) => {
            const on = file.useUp.some((u) => itemKey(u) === itemKey(item));
            const left = amountOf(plan?.surplus, item);
            return (
              <label key={item} className="rb-pl-row rb-pl-check">
                <input type="checkbox" checked={on} onChange={(e) => onChange(setUseUp(file, item, e.target.checked))} />
                <span className="rb-pl-item">{item}</span>
                <span className="rb-pl-made">{left ? `${fmt(left)} /${per} left` : on ? 'used up' : ''}</span>
              </label>
            );
          })}
        </Section>
      )}
    </>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (item: string) => void }) {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    if (draft.trim()) onAdd(draft.trim());
    setDraft('');
  };
  return (
    <div className="rb-pl-row">
      <input
        type="text"
        className="rb-pl-text"
        list="rb-pl-items"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
      />
      <button onClick={add}>Add</button>
    </div>
  );
}

// ------------------------------------------------------------------ Input

type RuleMode = 'auto' | InputRule['mode'];

function InputTab({ file, plan, per, craftable, onChange }: { file: FactoryFile; plan?: Plan; per: string; craftable: Set<string>; onChange: (f: FactoryFile) => void }) {
  const rows = new Map<string, string>();
  for (const a of plan?.raw ?? []) rows.set(itemKey(a.item), a.item);
  for (const r of file.inputs) rows.set(itemKey(r.item), r.item);

  return (
    <Section
      title="Brought in"
      hint={
        file.priority === 'output'
          ? 'Filled from the plan. Output priority: limits (≤, =) are kept but ignored; "bring in" still stops crafting an item.'
          : 'Filled from the plan. Set a limit, or bring an item in instead of crafting it.'
      }
    >
      {[...rows.values()].map((item) => {
        const rule = file.inputs.find((r) => itemKey(r.item) === itemKey(item));
        const rate = amountOf(plan?.raw, item);
        const unused = !!rule && rate === undefined;
        const mode: RuleMode = rule?.mode ?? 'auto';
        const setMode = (m: RuleMode): void =>
          onChange(setInput(file, item, m === 'auto' ? null : m === 'free' ? { item, mode: 'free' } : { item, mode: m, qty: rule?.qty ?? (rate ? Number(fmt(rate)) : 0) }));
        return (
          <div key={item} className={unused ? 'rb-pl-row is-unused' : 'rb-pl-row'} title={unused ? 'Not used by this plan — the rule is kept.' : undefined}>
            <span className="rb-pl-item">{item}</span>
            <span className="rb-pl-made">{rate !== undefined ? `${fmt(rate)} /${per}` : 'not used'}</span>
            <select value={mode} aria-label={`${item} rule`} onChange={(e) => setMode(e.target.value as RuleMode)}>
              <option value="auto">auto ∞</option>
              <option value="free">∞ bring in</option>
              <option value="max">≤ at most</option>
              <option value="exact">= exactly</option>
            </select>
            {rule && rule.mode !== 'free' && file.priority === 'output' ? (
              <span className="rb-pl-num-gap rb-pl-ignored" title="Ignored with Output priority">
                {rule.mode === 'max' ? '≤' : '='} {rule.qty}
              </span>
            ) : rule && rule.mode !== 'free' ? <NumCommit value={rule.qty} label={`${item} amount`} onCommit={(qty) => onChange(setInput(file, item, { ...rule, qty }))} /> : <span className="rb-pl-num-gap" />}
            {rule && craftable.has(itemKey(item)) ? (
              <button className="rb-pl-x" title={`Craft ${item} instead`} aria-label={`Craft ${item} instead`} onClick={() => onChange(craftInstead(file, item))}>
                ×
              </button>
            ) : (
              <span className="rb-pl-x-gap" />
            )}
          </div>
        );
      })}
      <AddRow placeholder="Bring in an item…" onAdd={(item) => onChange(bringIn(file, item))} />
    </Section>
  );
}

// ------------------------------------------------------------------ Recipes

function RecipesTab({ file, plan, result, onChange }: { file: FactoryFile; plan?: Plan; result: SolveResult | null; onChange: (f: FactoryFile) => void }) {
  const alts = [...(result?.alternatives.values() ?? [])].sort((a, b) => a.item.localeCompare(b.item));
  const used = new Set(plan?.recipes.map((r) => r.recipe.name));
  if (!alts.length) return <div className="rb-pl-hint">Every item here has only one recipe.</div>;
  return (
    <Section title="Recipe per item" hint="Auto tries every combination; each becomes a plan above the graph.">
      {alts.map((a) => {
        const chosen = file.recipes[itemKey(a.item)] ?? '';
        const current = a.recipes.find((r) => used.has(r));
        return (
          <div key={a.item} className="rb-pl-row">
            <span className="rb-pl-item">{a.item}</span>
            <select value={chosen} onChange={(e) => onChange(useRecipe(file, a.item, e.target.value || null))}>
              <option value="">Auto{!chosen && current ? ` (${current})` : ''}</option>
              {a.recipes.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </Section>
  );
}
