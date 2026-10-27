/**
 * A plan as a flow graph: machines are nodes, items are edges. Each item's
 * production is split across its consumers in proportion (an item made by two
 * recipes and used by two flows to both). Columns run raw → product; edges
 * that close a loop (a recycler feeding back) are marked `back`.
 */

import { itemKey, type Amount, type Per } from './parse';
import type { Plan, PlanRecipe } from './solve';

export type NodeKind = 'recipe' | 'raw' | 'out' | 'extra';

export interface GNode {
  id: string;
  kind: NodeKind;
  /** recipe nodes */
  step?: PlanRecipe;
  /** raw / out / extra nodes: the item and its rate. */
  amount?: Amount;
  col: number;
  row: number;
}

export interface GEdge {
  source: string;
  target: string;
  items: Amount[];
  back: boolean;
}

export interface FactoryGraph {
  nodes: GNode[];
  edges: GEdge[];
  cols: number;
  /** The tallest column's node count. */
  rows: number;
}

const TINY = 1e-7;

export interface GraphOptions {
  /**
   * One input node per consumer ("Clean Water → Crucible" sits by the
   * crucible) instead of one shared node wired across the whole graph.
   */
  splitInputs?: boolean;
}

export function buildGraph(plan: Plan, _per: Per, opts: GraphOptions = {}): FactoryGraph {
  const nodes = new Map<string, GNode>();
  const add = (n: Omit<GNode, 'col' | 'row'>): void => void (nodes.has(n.id) || nodes.set(n.id, { ...n, col: 0, row: 0 }));
  const names = new Map<string, string>();
  const flows = new Map<string, { prod: [string, number][]; cons: [string, number][] }>();
  const flow = (k: string) => flows.get(k) ?? (flows.set(k, { prod: [], cons: [] }), flows.get(k)!);

  for (const a of plan.raw) {
    add({ id: `raw:${itemKey(a.item)}`, kind: 'raw', amount: a });
    flow(itemKey(a.item)).prod.push([`raw:${itemKey(a.item)}`, a.qty]);
  }
  for (const step of plan.recipes) {
    const id = `r:${step.recipe.name}`;
    add({ id, kind: 'recipe', step });
    const net = new Map<string, number>();
    for (const a of step.recipe.outputs) net.set(itemKey(a.item), (net.get(itemKey(a.item)) ?? 0) + a.qty);
    for (const a of step.recipe.inputs) net.set(itemKey(a.item), (net.get(itemKey(a.item)) ?? 0) - a.qty);
    for (const a of [...step.recipe.outputs, ...step.recipe.inputs]) if (!names.has(itemKey(a.item))) names.set(itemKey(a.item), a.item);
    for (const [k, q] of net) {
      const rate = q * step.runs;
      if (rate > TINY) flow(k).prod.push([id, rate]);
      else if (rate < -TINY) flow(k).cons.push([id, -rate]);
    }
  }
  for (const a of plan.outputs) {
    const outId = `out:${itemKey(a.item)}`;
    add({ id: outId, kind: 'out', amount: a });
    flow(itemKey(a.item)).cons.push([outId, a.qty]);
  }
  for (const a of plan.surplus) {
    add({ id: `extra:${itemKey(a.item)}`, kind: 'extra', amount: a });
    flow(itemKey(a.item)).cons.push([`extra:${itemKey(a.item)}`, a.qty]);
  }

  const edges = new Map<string, GEdge>();
  for (const [k, f] of flows) {
    const total = f.prod.reduce((t, [, q]) => t + q, 0);
    if (total <= TINY) continue;
    for (const [src, pq] of f.prod) {
      for (const [dst, cq] of f.cons) {
        const qty = (pq * cq) / total;
        if (qty <= TINY || src === dst) continue;
        const key = `${src}\n${dst}`;
        const e = edges.get(key) ?? (edges.set(key, { source: src, target: dst, items: [], back: false }), edges.get(key)!);
        e.items.push({ item: names.get(k) ?? nodes.get(src)?.amount?.item ?? k, qty });
      }
    }
  }

  let list = [...nodes.values()];
  let edgeList = [...edges.values()];
  if (opts.splitInputs) [list, edgeList] = splitInputs(list, edgeList);
  layout(list, edgeList);
  const perCol = new Map<number, number>();
  for (const n of list) perCol.set(n.col, (perCol.get(n.col) ?? 0) + 1);
  return { nodes: list, edges: edgeList, cols: Math.max(0, ...list.map((n) => n.col)) + 1, rows: Math.max(1, ...perCol.values()) };
}

/** Mark loop-closing edges, put nodes in columns by longest path, order each column by its inputs. */
function layout(nodes: GNode[], edges: GEdge[]): void {
  const out = new Map<string, GEdge[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e]);
  const state = new Map<string, 'open' | 'done'>();
  const order: string[] = [];
  const visit = (id: string): void => {
    state.set(id, 'open');
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.target);
      if (s === 'open') e.back = true;
      else if (!s) visit(e.target);
    }
    state.set(id, 'done');
    order.push(id);
  };
  // Start from raw inputs so loops are cut where they return, not where they start.
  for (const n of nodes) if (n.kind === 'raw' && !state.has(n.id)) visit(n.id);
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const forward = edges.filter((e) => !e.back);
  for (const id of order.reverse()) {
    const n = byId.get(id)!;
    for (const e of forward) if (e.source === id) byId.get(e.target)!.col = Math.max(byId.get(e.target)!.col, n.col + 1);
  }
  // Raw inputs sit just left of their first consumer; the product sits in the last column.
  for (const n of nodes) {
    if (n.kind !== 'raw') continue;
    const cols = forward.filter((e) => e.source === n.id).map((e) => byId.get(e.target)!.col);
    if (cols.length) n.col = Math.max(0, Math.min(...cols) - 1);
  }
  const last = Math.max(0, ...nodes.map((n) => n.col));
  for (const n of nodes) if (n.kind === 'out') n.col = Math.max(n.col, last);

  // Order rows: by the average row of each node's inputs, two sweeps.
  const cols = new Map<number, GNode[]>();
  for (const n of nodes) cols.set(n.col, [...(cols.get(n.col) ?? []), n]);
  const keys = [...cols.keys()].sort((a, b) => a - b);
  keys.forEach((c) => cols.get(c)!.forEach((n, i) => (n.row = i)));
  for (let pass = 0; pass < 2; pass++) {
    for (const c of keys) {
      const col = cols.get(c)!;
      const bary = (n: GNode): number => {
        const ins = forward.filter((e) => e.target === n.id).map((e) => byId.get(e.source)!).filter((s) => s.col < c);
        return ins.length ? ins.reduce((t, s) => t + s.row, 0) / ins.length : n.row;
      };
      const scored = col.map((n) => [bary(n), n] as const).sort((a, b) => a[0] - b[0]);
      scored.forEach(([, n], i) => (n.row = i));
    }
  }
}

/** Give every consumer of a raw input its own copy of the input node. */
function splitInputs(nodes: GNode[], edges: GEdge[]): [GNode[], GEdge[]] {
  const raw = new Map(nodes.filter((n) => n.kind === 'raw').map((n) => [n.id, n]));
  const out: GNode[] = nodes.filter((n) => n.kind !== 'raw');
  const outEdges: GEdge[] = [];
  for (const e of edges) {
    const src = raw.get(e.source);
    if (!src) {
      outEdges.push(e);
      continue;
    }
    const id = `${e.source}@${e.target}`;
    const qty = e.items.reduce((t, a) => t + a.qty, 0);
    out.unshift({ ...src, id, amount: { item: src.amount!.item, qty }, col: 0, row: 0 });
    outEdges.push({ ...e, source: id });
  }
  return [out, outEdges];
}
