import { describe, expect, it } from 'vitest';
import { minimize } from './simplex';
import { itemsFromTable, parseAmounts, parseDuration, parseFactory, recipesFromTable, transportFromTable } from './parse';
import { defaultsFromNames, haul, haulKey, NO_CHOICE } from './transport';
import { requestFromSpec, solveFactory, type FactoryRequest } from './solve';
import { buildGraph } from './graph';

const near = (a: number, b: number): void => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe('minimize', () => {
  it('solves a small LP', () => {
    // min x + y, x + 2y = 4, 3x + y = 6 → x = 1.6, y = 1.2
    const r = minimize([1, 1], [[1, 2], [3, 1]], [4, 6]);
    expect(r.status).toBe('optimal');
    if (r.status !== 'optimal') return;
    near(r.x[0], 1.6);
    near(r.x[1], 1.2);
  });

  it('reports infeasible and unbounded', () => {
    expect(minimize([1], [[1], [1]], [1, 2]).status).toBe('infeasible');
    expect(minimize([-1, 0], [[1, -1]], [0]).status).toBe('unbounded');
  });

  it('handles negative right-hand sides and redundant rows', () => {
    const r = minimize([1, 1], [[-1, -1], [2, 2]], [-3, 6]);
    expect(r.status).toBe('optimal');
    if (r.status === 'optimal') near(r.value, 3);
  });
});

describe('parse', () => {
  it('reads amounts in several spellings', () => {
    expect(parseAmounts('3 Iron Ingot, 1.5 Water')).toEqual([{ item: 'Iron Ingot', qty: 3 }, { item: 'Water', qty: 1.5 }]);
    expect(parseAmounts('2x Plate + Screw x4')).toEqual([{ item: 'Plate', qty: 2 }, { item: 'Screw', qty: 4 }]);
    expect(parseAmounts(['Ore'])).toEqual([{ item: 'Ore', qty: 1 }]);
  });

  it('reads durations', () => {
    expect(parseDuration(6)).toBe(6);
    expect(parseDuration('1.5 min')).toBe(90);
    expect(parseDuration('2s')).toBe(2);
    expect(parseDuration('soon')).toBeNull();
  });

  it('reads a block', () => {
    const s = parseFactory('recipes: [[Satisfactory]]\nmake: 60 Iron Plate/min # comment\nraw: Water\nspeed: Smelter = 2');
    expect(s.errors).toEqual([]);
    expect(s).toMatchObject({ file: 'Satisfactory', make: 'Iron Plate', rate: 60, per: 'min', raw: ['Water'], speed: { smelter: 2 } });
  });

  it('reads input mode and inline recipes', () => {
    const s = parseFactory('make: Plate\ninput: 20 Ore\nrecipe: Press | Press | 2 | 2 Ore | 1 Plate, 1 Scrap');
    expect(s.errors).toEqual([]);
    expect(s.input).toEqual({ item: 'Ore', qty: 20 });
    expect(s.recipes[0]).toMatchObject({ name: 'Press', time: 2, outputs: [{ item: 'Plate', qty: 1 }, { item: 'Scrap', qty: 1 }] });
  });

  it('reads recipes from table rows, by column label', () => {
    const props = [
      { name: 'c1', label: 'Recipe', type: 'text' as const },
      { name: 'c2', label: 'Machine', type: 'select' as const, options: [{ value: 'o1', label: 'Smelter' }] },
      { name: 'c3', label: 'Time', type: 'number' as const },
      { name: 'c4', label: 'Inputs', type: 'text' as const },
      { name: 'c5', label: 'Outputs', type: 'text' as const },
    ];
    const r = recipesFromTable(props, [{ id: 'r1', cells: { c1: 'Ingot', c2: 'o1', c3: 2, c4: '1 Ore', c5: '1 Ingot' } }]);
    expect(r.errors).toEqual([]);
    expect(r.recipes[0]).toEqual({ name: 'Ingot', machine: 'Smelter', time: 2, inputs: [{ item: 'Ore', qty: 1 }], outputs: [{ item: 'Ingot', qty: 1 }] });
  });
});

const LOOP = `
recipe: Press | Press | 2 | 2 Ore | 1 Plate, 1 Scrap
recipe: Recycler | Recycler | 4 | 2 Scrap | 1 Ore
`;

describe('solveFactory', () => {
  it('scales a simple chain and counts machines', () => {
    const s = parseFactory('make: 60 Iron Plate\nrecipe: Iron Plate | Constructor | 6 | 3 Iron Ingot | 2 Iron Plate\nrecipe: Iron Ingot | Smelter | 2 | 1 Iron Ore | 1 Iron Ingot');
    const { plans, problems } = solveFactory(s.recipes, requestFromSpec(s));
    expect(problems).toEqual([]);
    const p = plans[0];
    near(p.raw[0].qty, 90);
    const m = Object.fromEntries(p.recipes.map((r) => [r.recipe.name, r.machines]));
    near(m['Iron Plate'], 3); // 30 crafts/min × 6 s = 3 machines
    near(m['Iron Ingot'], 3); // 90 crafts/min × 2 s
  });

  it('recycles a byproduct back into the chain (output mode)', () => {
    const s = parseFactory(`make: 10 Plate\n${LOOP}`);
    const p = solveFactory(s.recipes, requestFromSpec(s)).plans[0];
    near(p.raw.find((a) => a.item === 'Ore')!.qty, 15);
    expect(p.surplus).toEqual([]);
  });

  it('recycles a byproduct back into the chain (input mode)', () => {
    const s = parseFactory(`make: Plate\ninput: 20 Ore\n${LOOP}`);
    const { plans, problems } = solveFactory(s.recipes, requestFromSpec(s));
    expect(problems).toEqual([]);
    near(plans[0].outputs[0].qty, 40 / 3);
  });

  it('gives one plan per alternative recipe, best first', () => {
    const s = parseFactory(`make: 30 Ingot
recipe: Ingot | Smelter | 2 | 1 Ore | 1 Ingot
recipe: Pure Ingot | Refinery | 12 | 7 Ore, 4 Water | 13 Ingot`);
    const { plans } = solveFactory(s.recipes, requestFromSpec(s));
    expect(plans.length).toBe(2);
    // Pure: 30/13 crafts × (7 ore + 4 water) ≈ 25.4 raw vs 30 ore.
    expect(plans[0].choices).toEqual(['Pure Ingot']);
    expect(plans[1].choices).toEqual(['Ingot']);
  });

  it('honours use:, avoid: and raw:', () => {
    const base = `make: 30 Ingot
recipe: Ingot | Smelter | 2 | 1 Ore | 1 Ingot
recipe: Pure Ingot | Refinery | 12 | 7 Ore, 4 Water | 13 Ingot`;
    const used = parseFactory(`${base}\nuse: Ingot`);
    const names = (s: ReturnType<typeof parseFactory>): string[][] => solveFactory(s.recipes, requestFromSpec(s)).plans.map((p) => p.recipes.map((r) => r.recipe.name));
    expect(names(used)).toEqual([['Ingot']]);
    expect(names(parseFactory(`${base}\navoid: Ingot`))).toEqual([['Pure Ingot']]);
    const bought = parseFactory('make: 10 Plate\nraw: Ingot\nrecipe: Plate | Press | 1 | 2 Ingot | 1 Plate\nrecipe: Ingot | Smelter | 2 | 1 Ore | 1 Ingot');
    const p = solveFactory(bought.recipes, requestFromSpec(bought)).plans[0];
    expect(p.raw).toEqual([{ item: 'Ingot', qty: 20 }]);
  });

  it('reports unused byproducts as surplus', () => {
    const s = parseFactory('make: 10 Plate\nrecipe: Press | Press | 2 | 2 Ore | 1 Plate, 1 Scrap');
    expect(solveFactory(s.recipes, requestFromSpec(s)).plans[0].surplus).toEqual([{ item: 'Scrap', qty: 10 }]);
  });

  it('explains what it cannot do', () => {
    const s = parseFactory('make: 10 Gold\nrecipe: Press | Press | 2 | 2 Ore | 1 Plate');
    expect(solveFactory(s.recipes, requestFromSpec(s)).problems[0]).toMatch(/No recipe makes "Gold"/);
  });
});

describe('solveFactory requests', () => {
  const recipes = parseFactory(`
recipe: Ingot | Smelter | 2 | 1 Ore | 1 Ingot
recipe: Plate | Constructor | 6 | 3 Ingot | 2 Plate
recipe: Rod | Constructor | 4 | 1 Ingot | 1 Rod
recipe: Press | Press | 2 | 2 Ore | 1 Plate, 1 Scrap
recipe: Recycler | Recycler | 4 | 2 Scrap | 1 Ore`).recipes;
  const req = (r: Partial<FactoryRequest>): FactoryRequest => ({ outputs: [], inputs: [], per: 'min', use: [], avoid: [], useUp: [], speed: {}, cost: {}, ...r });
  const qty = (p: { outputs: { item: string; qty: number }[] }, item: string): number => p.outputs.find((o) => o.item === item)!.qty;

  it('makes several outputs at once', () => {
    const { plans } = solveFactory(recipes, req({ outputs: [{ item: 'Plate', rate: 20 }, { item: 'Rod', rate: 10 }], use: ['Plate'] }));
    near(qty(plans[0], 'Plate'), 20);
    near(qty(plans[0], 'Rod'), 10);
    near(plans[0].raw.find((a) => a.item === 'Ore')!.qty, 40); // 30 ingot for plates + 10 for rods
  });

  it('keeps the ratio between max outputs, after the fixed ones', () => {
    const { plans, problems } = solveFactory(recipes, req({
      outputs: [{ item: 'Plate', max: 2 }, { item: 'Rod', max: 1 }],
      inputs: [{ item: 'Ore', mode: 'max', qty: 40 }],
      use: ['Plate'],
    }));
    expect(problems).toEqual([]);
    // 2z plates need 3z ingot, z rods need z ingot: 4z = 40.
    near(qty(plans[0], 'Plate'), 20);
    near(qty(plans[0], 'Rod'), 10);
  });

  it('says when nothing limits a max output', () => {
    const { problems } = solveFactory(recipes, req({ outputs: [{ item: 'Rod', max: 1 }] }));
    expect(problems[0]).toMatch(/Nothing limits "Rod"/);
  });

  it('uses all of an exact input', () => {
    const { plans } = solveFactory(recipes, req({ outputs: [{ item: 'Rod', max: 1 }], inputs: [{ item: 'Ore', mode: 'exact', qty: 25 }] }));
    near(qty(plans[0], 'Rod'), 25);
  });

  it('brings an input in instead of crafting it', () => {
    const { plans } = solveFactory(recipes, req({ outputs: [{ item: 'Rod', rate: 10 }], inputs: [{ item: 'Ingot', mode: 'free' }] }));
    expect(plans[0].recipes.map((r) => r.recipe.name)).toEqual(['Rod']);
    expect(plans[0].raw).toEqual([{ item: 'Ingot', qty: 10 }]);
  });

  it('forces a byproduct to be used up', () => {
    const allowed = solveFactory(recipes, req({ outputs: [{ item: 'Plate', rate: 10 }], use: ['Press'] })).plans[0];
    expect(allowed.surplus).toEqual([]); // recycling is cheaper anyway
    const noRecycler = solveFactory(recipes, req({ outputs: [{ item: 'Plate', rate: 10 }], use: ['Press'], avoid: ['Recycler'], useUp: ['Scrap'] }));
    expect(noRecycler.plans).toEqual([]);
    expect(noRecycler.problems[0]).toMatch(/must be used up/);
  });

  it('lists the items that have alternative recipes, even when one is pinned', () => {
    const { alternatives } = solveFactory(recipes, req({ outputs: [{ item: 'Plate', rate: 10 }], use: ['Plate'] }));
    expect(alternatives.get('plate')).toEqual({ item: 'Plate', recipes: ['Plate', 'Press'] });
  });
});

describe('buildGraph', () => {
  it('draws the recycling loop as a back edge', () => {
    const s = parseFactory(`make: 10 Plate\n${LOOP}`);
    const g = buildGraph(solveFactory(s.recipes, requestFromSpec(s)).plans[0], s.per);
    const press = g.nodes.find((n) => n.id === 'r:Press')!;
    const rec = g.nodes.find((n) => n.id === 'r:Recycler')!;
    const back = g.edges.find((e) => e.source === 'r:Recycler' && e.target === 'r:Press')!;
    expect(back.back).toBe(true);
    expect(back.items).toEqual([{ item: 'Ore', qty: 5 }]);
    expect(rec.col).toBeGreaterThan(press.col);
    const fromMine = g.edges.find((e) => e.source === 'raw:ore')!;
    near(fromMine.items[0].qty, 15);
  });
});

describe('transport', () => {
  const tiersTable = sampleTiers();
  function sampleTiers() {
    const props = [
      { name: 'n', label: 'Name', type: 'text' as const },
      { name: 't', label: 'Type', type: 'text' as const },
      { name: 'r', label: 'Rate', type: 'text' as const },
    ];
    return transportFromTable(props, [
      { id: '1', cells: { n: 'Belt Mk1', t: 'Belt', r: 60 } },
      { id: '2', cells: { n: 'Belt Mk2', t: 'Belt', r: '2/s' } },
      { id: '3', cells: { n: 'Pipe Mk1', t: 'Pipe', r: '300/min' } },
    ]);
  }

  it('reads tiers with rates per minute', () => {
    expect(tiersTable.errors).toEqual([]);
    expect(tiersTable.tiers.map((t) => [t.name, t.rate])).toEqual([['Belt Mk1', 60], ['Belt Mk2', 120], ['Pipe Mk1', 300]]);
  });

  it('reads item transport types', () => {
    const r = itemsFromTable([{ name: 'i', label: 'Item', type: 'text' }, { name: 't', label: 'Transport', type: 'text' }], [{ id: '1', cells: { i: 'Water', t: 'Pipe' } }]);
    expect(r.types.get('water')).toBe('Pipe');
  });

  const book = { tiers: tiersTable.tiers, types: new Map([['water', 'Pipe'], ['iron ore', 'Belt']]) };

  it('counts lanes per connection, with defaults and overrides', () => {
    const ore = { item: 'Iron Ore', qty: 150 };
    expect(haul(book, NO_CHOICE, 'min', 'a', 'b', ore)).toMatchObject({ type: 'Belt', lanes: 3, custom: false, tier: { name: 'Belt Mk1' } });
    expect(haul(book, NO_CHOICE, 'min', 'a', 'b', { item: 'Mystery', qty: 1 })).toBeNull(); // no transport type: flagged, not guessed
    const mk2 = { defaults: { belt: 'Belt Mk2' }, edges: {} };
    expect(haul(book, mk2, 'min', 'a', 'b', ore)?.lanes).toBe(2);
    const own = { defaults: {}, edges: { [haulKey('a', 'b', 'Iron Ore')]: 'Belt Mk2' } };
    expect(haul(book, own, 'min', 'a', 'b', ore)).toMatchObject({ lanes: 2, custom: true });
    expect(haul(book, NO_CHOICE, 'sec', 'a', 'b', { item: 'Water', qty: 4 })).toMatchObject({ type: 'Pipe', lanes: 1 }); // 240/min
    expect(haul({ tiers: [], types: new Map() }, NO_CHOICE, 'min', 'a', 'b', ore)).toBeNull();
  });

  it('maps tier names to defaults', () => {
    expect(defaultsFromNames(book, ['Belt Mk2', 'nope'])).toEqual({ belt: 'Belt Mk2' });
  });
});

describe('machine split', () => {
  it('splits into full-speed machines plus one slower one', async () => {
    const { machineSplit, machineUse } = await import('./FlowGraph');
    expect(machineSplit(2.5)).toBe('2 × 100% + 1 × 50%');
    expect(machineSplit(3)).toBe('3 × 100%');
    expect(machineSplit(0.25)).toBe('1 × 25%');
    expect(machineSplit(1.999)).toBe('2 × 100%');
    expect(machineUse(2.17)).toMatchObject({ built: 3, full: 2, part: 17 });
  });
});
