import { describe, expect, it } from 'vitest';
import { addPlan, applyView, bringIn, craftInstead, deletePlan, docView, duplicatePlan, newFactoryDoc, newFactoryFile, parseFactoryDoc, renamePlan, serializeFactoryDoc, setAllTier, setInput, setUseUp, toRequest, useRecipe, type FactoryDoc } from './plan';

describe('.factory file', () => {
  const sample = (): FactoryDoc => {
    const doc = newFactoryDoc();
    doc.plans[0] = {
      ...doc.plans[0],
      name: 'Iron line',
      priority: 'both',
      outputs: [{ item: 'Plate', rate: 10 }, { item: 'Rod', max: 2 }],
      inputs: [{ item: 'Ore', mode: 'max', qty: 120 }, { item: 'Water', mode: 'free' }],
      recipes: { 'iron ingot': 'Pure Iron Ingot' },
      useUp: ['Scrap'],
      transport: { belt: 'Belt Mk2' },
      edges: { 'raw:ore>r:Smelter>iron ore': 'Belt Mk3' },
    };
    doc.data.recipes.push({ id: 'r1', name: 'Ingot', machine: 'Smelter', time: 2, inputs: [{ item: 'Ore', qty: 1 }], outputs: [{ item: 'Ingot', qty: 1 }] });
    doc.data.items.push({ name: 'Ore', transport: 'Belt' });
    doc.data.transport.push({ id: 't1', name: 'Belt Mk1', type: 'Belt', rate: 60 });
    return addPlan(doc);
  };

  it('round-trips plans and data', () => {
    const doc = sample();
    const r = parseFactoryDoc(serializeFactoryDoc(doc));
    if (!r.ok) throw new Error(r.error);
    expect(r.doc.plans).toEqual(doc.plans);
    expect(r.doc.active).toBe(1);
    expect(r.doc.data).toEqual(doc.data);
    expect(serializeFactoryDoc(r.doc)).toBe(serializeFactoryDoc(doc));
  });

  it('reads an empty file as one empty plan, and reports bad JSON', () => {
    const empty = parseFactoryDoc('');
    expect(empty.ok && empty.doc.plans.map((p) => p.name)).toEqual(['Plan 1']);
    expect(empty.ok && empty.doc.data).toEqual({ recipes: [], items: [], transport: [], environments: [], machines: [] });
    expect(parseFactoryDoc('{ nope').ok).toBe(false);
  });

  it('reads a version-1 file (one plan at the top level)', () => {
    const r = parseFactoryDoc(JSON.stringify({ version: 1, name: 'Old', priority: 'input', outputs: [{ item: 'X', rate: 1 }], data: {} }));
    expect(r.ok && r.doc.plans.map((p) => [p.name, p.priority, p.outputs])).toEqual([['Old', 'input', [{ item: 'X', rate: 1 }]]]);
  });

  it('flags an early file that linked its tables', () => {
    const r = parseFactoryDoc(JSON.stringify({ version: 1, book: { recipes: 'A/Recipes.table' }, outputs: [{ item: 'X', rate: 1 }] }));
    expect(r.ok && r.legacy).toEqual({ recipes: 'A/Recipes.table' });
    const now = parseFactoryDoc(serializeFactoryDoc(newFactoryDoc()));
    expect(now.ok && now.legacy).toBeUndefined();
  });

  it('edits the active plan through its view', () => {
    const doc = sample();
    const view = docView(doc);
    expect(view.name).toBe('Plan 2');
    const next = applyView(doc, { ...view, outputs: [{ item: 'Rod', rate: 3 }] });
    expect(next.plans[1].outputs).toEqual([{ item: 'Rod', rate: 3 }]);
    expect(next.plans[0]).toBe(doc.plans[0]);
  });
  it('turns into a solver request', () => {
    const f = useRecipe(newFactoryFile(), 'Iron Ingot', 'Pure Iron Ingot');
    expect(toRequest(f).use).toEqual(['Pure Iron Ingot']);
  });

  it('applies the priority', () => {
    const f = { ...newFactoryFile(), outputs: [{ item: 'Plate', rate: 10 }, { item: 'Rod', max: 2 }], inputs: [{ item: 'Ore', mode: 'max' as const, qty: 60 }] };
    const out = toRequest({ ...f, priority: 'output' });
    expect(out.outputs).toEqual([{ item: 'Plate', rate: 10 }, { item: 'Rod', rate: 2 }]);
    expect(out.inputs).toEqual([{ item: 'Ore', mode: 'free' }]);
    const inp = toRequest({ ...f, priority: 'input' });
    expect(inp.outputs).toEqual([{ item: 'Plate', max: 10 }, { item: 'Rod', max: 2 }]);
    expect(inp.inputs).toEqual(f.inputs);
    expect(toRequest({ ...f, priority: 'both' })).toMatchObject({ outputs: f.outputs, inputs: f.inputs });
  });
});

describe('plan edits', () => {
  const base = { ...newFactoryFile(), outputs: [{ item: 'Plate', rate: 10 }, { item: 'Ingot', rate: 5 }] };

  it('brings an item in (and stops making it as an output), then crafts it again', () => {
    const f = bringIn(base, 'Ingot');
    expect(f.inputs).toEqual([{ item: 'Ingot', mode: 'free' }]);
    expect(f.outputs).toEqual([{ item: 'Plate', rate: 10 }]);
    expect(bringIn(f, 'ingot')).toBe(f);
    expect(craftInstead(f, 'INGOT').inputs).toEqual([]);
  });

  it('sets an input rule in place, or clears it', () => {
    let f = setInput(base, 'Ore', { item: 'Ore', mode: 'free' });
    f = setInput(f, 'Water', { item: 'Water', mode: 'free' });
    f = setInput(f, 'ore', { item: 'Ore', mode: 'max', qty: 60 });
    expect(f.inputs.map((i) => i.item)).toEqual(['Ore', 'Water']);
    expect(f.inputs[0]).toEqual({ item: 'Ore', mode: 'max', qty: 60 });
    expect(setInput(f, 'Ore', null).inputs.map((i) => i.item)).toEqual(['Water']);
  });

  it('picks and clears recipes and byproduct rules', () => {
    const f = useRecipe(base, 'Screw', 'Cast Screw');
    expect(f.recipes).toEqual({ screw: 'Cast Screw' });
    expect(useRecipe(f, 'screw', null).recipes).toEqual({});
    expect(setUseUp(setUseUp(base, 'Scrap', true), 'scrap', false).useUp).toEqual([]);
  });
});

describe('plan list', () => {
  it('adds, duplicates, renames and deletes plans', () => {
    let doc = newFactoryDoc();
    doc = { ...doc, plans: [{ ...doc.plans[0], per: 'sec', transport: { belt: 'Belt Mk2' }, outputs: [{ item: 'A', rate: 1 }] }] };
    doc = addPlan(doc);
    expect(doc.plans.map((p) => p.name)).toEqual(['Plan 1', 'Plan 2']);
    expect(doc.active).toBe(1);
    expect(doc.plans[1]).toMatchObject({ per: 'sec', transport: { belt: 'Belt Mk2' }, outputs: [] });
    doc = duplicatePlan(doc, 0);
    expect(doc.plans.map((p) => p.name)).toEqual(['Plan 1', 'Plan 1 (2)', 'Plan 2']);
    expect(doc.plans[1].outputs).toEqual([{ item: 'A', rate: 1 }]);
    expect(doc.plans[1].outputs).not.toBe(doc.plans[0].outputs);
    doc = renamePlan(doc, 1, '  Copper  ');
    expect(doc.plans[1].name).toBe('Copper');
    doc = deletePlan({ ...doc, active: 2 }, 0);
    expect(doc.plans.map((p) => p.name)).toEqual(['Copper', 'Plan 2']);
    expect(doc.active).toBe(1);
    doc = deletePlan(deletePlan(doc, 1), 0);
    expect(doc.plans).toHaveLength(1);
    expect(doc.plans[0]).toMatchObject({ name: 'Copper', outputs: [] });
  });
});

describe('transport edits', () => {
  it('puts every connection of a type on one tier', () => {
    const book = { tiers: [{ name: 'Belt Mk1', type: 'Belt', rate: 60 }, { name: 'Belt Mk2', type: 'Belt', rate: 120 }, { name: 'Pipe Mk1', type: 'Pipe', rate: 300 }], types: new Map([['water', 'Pipe'], ['iron ore', 'Belt']]) };
    const f = { ...newFactoryFile(), edges: { 'a>b>iron ore': 'Belt Mk1', 'a>c>water': 'Pipe Mk1' } };
    const next = setAllTier(f, book, 'Belt', 'Belt Mk2');
    expect(next.transport).toEqual({ belt: 'Belt Mk2' });
    expect(next.edges).toEqual({ 'a>c>water': 'Pipe Mk1' });
    expect(setAllTier(next, book, 'belt', null).transport).toEqual({});
  });
});
