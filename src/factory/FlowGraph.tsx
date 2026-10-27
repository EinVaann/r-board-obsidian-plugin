/**
 * A plan as a node graph (React Flow), laid out left → right by dagre.
 * Machines, inputs, outputs and surplus are HTML nodes styled with Obsidian's
 * variables; edges carry the item, its rate and, with a transport table, the
 * lanes it needs. Loop edges (recycling back) are dashed.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  getSmoothStepPath,
  useNodesState,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import * as dagre from '@dagrejs/dagre';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge } from 'elkjs/lib/elk-api';
import { buildGraph, type GEdge, type GNode } from './graph';
import type { Per } from './parse';
import type { Plan } from './solve';
import { haul, NO_CHOICE, type Haul, type TransportBook, type TransportChoice } from './transport';

const PER_LABEL: Record<Per, string> = { sec: 's', min: 'min', hour: 'h' };

/**
 * Machines to build: full-speed ones plus one slower machine for the
 * remainder (2.5 machines → 2 at 100% + 1 at 50%).
 */
export function machineUse(exact: number): { built: number; full: number; part: number | null; busy: number } {
  let full = Math.floor(exact + 1e-6);
  let part: number | null = Math.round((exact - full) * 100);
  if (part >= 100) {
    full++;
    part = null;
  } else if (part <= 0) part = full ? null : 1;
  const built = full + (part ? 1 : 0);
  return { built, full, part, busy: Math.min(100, Math.round((exact / Math.max(1, built)) * 100)) };
}

/** "2 × 100% + 1 × 50%" */
export function machineSplit(exact: number): string {
  const u = machineUse(exact);
  return [u.full ? `${u.full} × 100%` : '', u.part ? `1 × ${u.part}%` : ''].filter(Boolean).join(' + ');
}

/** Up to 2 decimals (2 significant digits below 1), trailing zeros dropped. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const d = Math.abs(n) >= 1 || n === 0 ? 2 : 1 - Math.floor(Math.log10(Math.abs(n)));
  return String(Number(n.toFixed(Math.min(d, 6))));
}

const NODE_W = 196;
const SIZE: Record<GNode['kind'], number> = { recipe: 76, raw: 52, out: 52, extra: 52 };

/** Which way the graph flows: inputs at the top (`down`) or at the left (`right`). */
export type Direction = 'down' | 'right';

interface NodeData extends Record<string, unknown> {
  g: GNode;
  per: string;
  down: boolean;
}

interface EdgeData extends Record<string, unknown> {
  g: GEdge;
  hauls: (Haul | null)[];
  per: string;
  width: number;
  click?: (evt: MouseEvent) => void;
  /** Where the layout put this edge's label (clear of the others); null once nodes were dragged. */
  labelAt: { x: number; y: number } | null;
  /** The routed path (orthogonal, around the machines); null before ELK or once nodes were dragged. */
  route: Pt[] | null;
  /** The box ELK kept for the label, beside its route (top-left + size). */
  labelBox: Box | null;
  /** A transport table exists (so a missing transport is flagged). */
  transport: boolean;
}

// ------------------------------------------------------------------ nodes

const MachineNode = memo(function MachineNode({ data }: NodeProps<Node<NodeData>>) {
  const s = data.g.step!;
  const { built: builtCount, part } = machineUse(s.machines);
  return (
    <div className="rb-fg-node rb-fg-recipe" title={`${fmt(s.machines)} machines' worth of work · ${fmt(s.runs)} crafts /${data.per}`}>
      <Handle type="target" position={data.down ? Position.Top : Position.Left} isConnectable={false} />
      <div className="rb-fg-head">
        <span className="rb-fg-count">{builtCount}×</span> {s.recipe.machine}
        {s.recipe.env && (
          <span className="rb-fg-env" title={`Must stand in ${s.recipe.env}`}>
            {s.recipe.env}
          </span>
        )}
      </div>
      <div className="rb-fg-sub">{s.recipe.name}</div>
      <div className={part ? 'rb-fg-busy is-partial' : 'rb-fg-busy'}>{machineSplit(s.machines)}</div>
      <Handle type="source" position={data.down ? Position.Bottom : Position.Right} isConnectable={false} />
    </div>
  );
});

const TAG: Record<string, string> = { raw: 'Input', out: 'Output', extra: 'Surplus' };

const ItemNode = memo(function ItemNode({ data }: NodeProps<Node<NodeData>>) {
  const { g } = data;
  const a = g.amount!;
  return (
    <div className={`rb-fg-node rb-fg-${g.kind}`}>
      {g.kind !== 'raw' && <Handle type="target" position={data.down ? Position.Top : Position.Left} isConnectable={false} />}
      <div className="rb-fg-tag">{TAG[g.kind]}</div>
      <div className="rb-fg-head">{a.item}</div>
      <div className="rb-fg-sub">
        {fmt(a.qty)} /{data.per}
      </div>
      {g.kind === 'raw' && <Handle type="source" position={data.down ? Position.Bottom : Position.Right} isConnectable={false} />}
    </div>
  );
});

const nodeTypes = { recipe: MachineNode, raw: ItemNode, out: ItemNode, extra: ItemNode };

// ------------------------------------------------------------------ edges

function lane(h: Haul | null, flagMissing: boolean) {
  if (h) return <span className="rb-fg-lane">{` · ${h.lanes}× ${h.tier.name}`}</span>;
  return flagMissing ? <span className="rb-fg-lane is-missing"> · ⚠ no transport</span> : null;
}

const FlowEdge = memo(function FlowEdge(p: EdgeProps<Edge<EdgeData>>) {
  const d = p.data!;
  const [stepPath, labelX, labelY] = getSmoothStepPath({
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    targetX: p.targetX,
    targetY: p.targetY,
    sourcePosition: p.sourcePosition,
    targetPosition: p.targetPosition,
    borderRadius: 14,
    offset: d.g.back ? 28 : 20,
  });
  const path = d.route ? roundedPath(d.route) : stepPath;
  // Forward edges: the laid-out spot, else the middle of the edge's own path.
  // Loops: the far side of the detour, clear of the forward edge between the same machines.
  const own = useMemo(
    () => (d.g.back ? pathFarPoint(path, p.sourceX, p.sourceY, p.targetX, p.targetY) : pathMidpoint(path)),
    [path, d.g.back, p.sourceX, p.sourceY, p.targetX, p.targetY],
  );
  const at = ((d.route || !d.g.back) && d.labelAt) || own || { x: labelX, y: labelY };
  // With an ELK route the label fills the box ELK kept for it, right against the line.
  const box = d.route ? d.labelBox : null;
  const style = box
    ? { transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, minHeight: box.h }
    : { transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` };
  const busy = d.hauls.some((h) => h && h.lanes > 1) || (d.transport && d.hauls.some((h) => !h));
  const cls = ['rb-fg-edge', d.g.back ? 'is-back' : '', busy ? 'is-busy' : ''].filter(Boolean).join(' ');
  return (
    <>
      <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} className={cls} style={{ strokeWidth: d.width }} interactionWidth={16} />
      <EdgeLabelRenderer>
        <div
          className={`rb-fg-label nodrag nopan${busy ? ' is-busy' : ''}${d.click ? ' is-clickable' : ''}`}
          style={style}
          onClick={d.click ? (e) => d.click!(e.nativeEvent) : undefined}
        >
          {d.g.items.map((a, i) => (
            <div key={a.item}>
              {a.item} <b>{fmt(a.qty)}</b>
              {lane(d.hauls[i], d.transport)}
            </div>
          ))}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

const edgeTypes = { flow: FlowEdge };

type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

/** An orthogonal polyline with rounded corners. */
function roundedPath(pts: Pt[], r = 10): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const k = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const p1 = towards(b, a, k);
    const p2 = towards(b, c, k);
    d += ` L${p1.x},${p1.y} Q${b.x},${b.y} ${p2.x},${p2.y}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last.x},${last.y}`;
}

function towards(from: Pt, to: Pt, dist: number): Pt {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) / len) * dist, y: from.y + ((to.y - from.y) / len) * dist };
}

/** The point of a path farthest from the straight line between its ends (the outside of a loop). */
function pathFarPoint(d: string, x1: number, y1: number, x2: number, y2: number): { x: number; y: number } | null {
  try {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('d', d);
    const len = el.getTotalLength();
    const dx = x2 - x1;
    const dy = y2 - y1;
    const norm = Math.hypot(dx, dy) || 1;
    let best: { x: number; y: number } | null = null;
    let far = -1;
    // Sample the middle 60% only, so the label stays off the machines at either end.
    for (let s = len * 0.2; s <= len * 0.8; s += Math.max(2, len / 80)) {
      const p = el.getPointAtLength(s);
      const dist = Math.abs(dy * p.x - dx * p.y + x2 * y1 - y2 * x1) / norm;
      if (dist > far + 0.5) {
        far = dist;
        best = { x: p.x, y: p.y };
      }
    }
    return best;
  } catch {
    return null;
  }
}

/** The point halfway along an SVG path, or null where the browser can't measure it. */
function pathMidpoint(d: string): { x: number; y: number } | null {
  try {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('d', d);
    const p = el.getPointAtLength(el.getTotalLength() / 2);
    return Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ layout

interface Layout {
  nodes: Map<string, { x: number; y: number }>;
  /** Edge label centres, by `source>target`. */
  labels: Map<string, { x: number; y: number }>;
  /** Edge routes, by `source>target` (ELK only). */
  routes: Map<string, Pt[]>;
  /** Label boxes, by `source>target` (ELK only). */
  boxes: Map<string, Box>;
}

/** Room an edge label needs (one line per item). */
function labelSize(e: GEdge, transport: boolean): { width: number; height: number } {
  const longest = Math.max(...e.items.map((a) => a.item.length + 8 + (transport ? 16 : 0)));
  return { width: Math.round(longest * 6.2 + 14), height: 15 * e.items.length + 6 };
}

const elk = new ELK();

/**
 * Layered layout by ELK: fewer crossings than dagre, and every edge routed
 * orthogonally around the machines, with room kept for its label.
 */
async function elkLayout(nodes: GNode[], edges: GEdge[], direction: Direction, transport: boolean): Promise<Layout> {
  const res = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'down' ? 'DOWN' : 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.spacing.nodeNodeBetweenLayers': '56',
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
      'elk.spacing.nodeNode': '36',
      'elk.spacing.edgeNode': '18',
      'elk.spacing.edgeEdge': '10',
      'elk.spacing.edgeLabel': '4',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.padding': '[top=12,left=12,bottom=12,right=12]',
      // Every coordinate (nodes, routes, labels) in the root frame.
      'elk.json.shapeCoords': 'ROOT',
      'elk.json.edgeCoords': 'ROOT',
    },
    children: nodes.map((n) => ({ id: n.id, width: NODE_W, height: SIZE[n.kind] })),
    edges: edges.map((e) => ({
      id: `${e.source}>${e.target}`,
      sources: [e.source],
      targets: [e.target],
      labels: [{ id: `${e.source}>${e.target}#l`, text: e.items.map((a) => a.item).join(' / '), ...labelSize(e, transport) }],
    })),
  });
  const pos = new Map<string, Pt>();
  for (const c of res.children ?? []) pos.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
  const routes = new Map<string, Pt[]>();
  const labels = new Map<string, Pt>();
  const boxes = new Map<string, Box>();
  for (const e of (res.edges ?? []) as ElkExtendedEdge[]) {
    const sec = e.sections?.[0];
    if (sec) routes.set(e.id, [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]);
    const l = e.labels?.[0];
    if (l && l.x !== undefined && l.y !== undefined) {
      labels.set(e.id, { x: l.x + (l.width ?? 0) / 2, y: l.y + (l.height ?? 0) / 2 });
      boxes.set(e.id, { x: l.x, y: l.y, w: l.width ?? 0, h: l.height ?? 0 });
    }
  }
  return { nodes: pos, labels, routes, boxes };
}

function layout(nodes: GNode[], edges: GEdge[], direction: Direction): Layout {
  const g = new dagre.graphlib.Graph();
  g.setGraph(
    direction === 'down'
      ? { rankdir: 'TB', nodesep: 40, ranksep: 80, edgesep: 24, marginx: 12, marginy: 12 }
      : { rankdir: 'LR', nodesep: 26, ranksep: 120, edgesep: 18, marginx: 12, marginy: 12 },
  );
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: SIZE[n.kind] });
  // Loop edges go in reversed, so ranks follow the main flow and the loop curls back.
  for (const e of edges) {
    const label = { width: 130, height: 16 * e.items.length + 4, labelpos: 'c' };
    if (e.back) g.setEdge(e.target, e.source, label);
    else g.setEdge(e.source, e.target, label);
  }
  dagre.layout(g);
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id) as { x: number; y: number };
    pos.set(n.id, { x: p.x - NODE_W / 2, y: p.y - SIZE[n.kind] / 2 });
  }
  const labels = new Map<string, { x: number; y: number }>();
  for (const e of edges) {
    // Loop edges were laid out reversed; their label still belongs mid-loop.
    const l = (e.back ? g.edge(e.target, e.source) : g.edge(e.source, e.target)) as { x?: number; y?: number } | undefined;
    if (!e.back && l && Number.isFinite(l.x) && Number.isFinite(l.y)) labels.set(`${e.source}>${e.target}`, { x: l.x!, y: l.y! });
  }
  return { nodes: pos, labels, routes: new Map(), boxes: new Map() };
}

export interface FlowGraphProps {
  plan: Plan;
  per: Per;
  transport?: TransportBook;
  choice?: TransportChoice;
  /** Graph flow (default: top to bottom). */
  direction?: Direction;
  /** One input node per consumer (default) instead of one shared node. */
  splitInputs?: boolean;
  /** Fill the parent (the planner tab): wheel zoom, controls, minimap. Otherwise sized to the graph, for notes. */
  fill?: boolean;
  height?: number;
  onNodeClick?: (node: GNode, evt: MouseEvent) => void;
  onEdgeClick?: (edge: GEdge, hauls: (Haul | null)[], evt: MouseEvent) => void;
}

export function FlowGraph({ plan, per, transport, choice = NO_CHOICE, direction = 'down', splitInputs = true, fill, height, onNodeClick, onEdgeClick }: FlowGraphProps) {
  const graph = useMemo(() => buildGraph(plan, per, { splitInputs }), [plan, per, splitInputs]);
  // dagre draws at once; ELK's better layout replaces it a moment later (or dagre stays, if ELK fails).
  const quick = useMemo(() => layout(graph.nodes, graph.edges, direction), [graph, direction]);
  const [routed, setRouted] = useState<{ graph: unknown; direction: Direction; lay: Layout } | null>(null);
  useEffect(() => {
    let live = true;
    elkLayout(graph.nodes, graph.edges, direction, !!transport)
      .then((lay) => {
        if (live) setRouted({ graph, direction, lay });
      })
      .catch((e) => console.warn('R Board: ELK layout failed; keeping the quick layout', e));
    return () => {
      live = false;
    };
  }, [graph, direction, transport]);
  const elkReady = !!routed && routed.graph === graph && routed.direction === direction;
  const lay = elkReady ? routed!.lay : quick;
  const pos = lay.nodes;
  const down = direction === 'down';
  const perLabel = PER_LABEL[per];

  const nodes: Node<NodeData>[] = useMemo(
    () => graph.nodes.map((g) => ({ id: g.id, type: g.kind, position: pos.get(g.id)!, data: { g, per: perLabel, down }, draggable: true, connectable: false })),
    [graph, pos, perLabel, down],
  );
  // Nodes can be dragged around; a new layout (any change to the plan) puts them back.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(nodes);
  // Dragging a node moves its edges, so the laid-out label spots no longer apply.
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    setRfNodes(nodes);
    setMoved(false);
  }, [nodes, setRfNodes]);
  const edges: Edge<EdgeData>[] = useMemo(() => {
    const max = Math.max(1e-9, ...graph.edges.map((e) => e.items.reduce((t, a) => t + a.qty, 0)));
    return graph.edges.map((g) => {
      const total = g.items.reduce((t, a) => t + a.qty, 0);
      const hauls = transport ? g.items.map((a) => haul(transport, choice, per, g.source, g.target, a)) : g.items.map(() => null);
      return {
        id: `${g.source}>${g.target}`,
        source: g.source,
        target: g.target,
        type: 'flow',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, markerUnits: 'userSpaceOnUse', color: g.back ? 'var(--interactive-accent)' : 'var(--text-faint)' },
        data: {
          g,
          hauls,
          per: perLabel,
          transport: !!transport,
          labelAt: moved ? null : lay.labels.get(`${g.source}>${g.target}`) ?? null,
          route: moved ? null : lay.routes.get(`${g.source}>${g.target}`) ?? null,
          labelBox: moved ? null : lay.boxes.get(`${g.source}>${g.target}`) ?? null,
          width: 1.5 + 3.5 * Math.sqrt(Math.min(1, total / max)),
          click: onEdgeClick && transport ? (evt: MouseEvent) => onEdgeClick(g, hauls, evt) : undefined,
        },
      };
    });
  }, [graph, transport, choice, per, perLabel, onEdgeClick, lay, moved]);

  // Notes: height from the layout (so the block isn't a fixed box), capped.
  const bottom = Math.max(0, ...graph.nodes.map((n) => pos.get(n.id)!.y + SIZE[n.kind]));
  const h = fill ? undefined : height ?? Math.min(560, Math.max(160, bottom + 40));
  const byNode = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  return (
    <div className={fill ? 'rb-fg rb-fg-fill' : 'rb-fg'} style={h ? { height: h } : undefined}>
      <ReactFlow
        key={`${direction}|${elkReady ? 'elk' : 'quick'}|${graph.nodes.map((n) => n.id).join('|')}`}
        nodes={rfNodes}
        onNodesChange={onNodesChange}
        onNodeDragStart={() => setMoved(true)}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={!!fill}
        preventScrolling={!!fill}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(evt, n) => {
          const g = byNode.get(n.id);
          if (g) onNodeClick?.(g, evt.nativeEvent);
        }}
        onEdgeClick={(evt, e) => {
          const d = e.data as EdgeData | undefined;
          if (d) onEdgeClick?.(d.g, d.hauls, evt.nativeEvent);
        }}
      >
        <Background gap={20} size={1} />
        {fill && <Controls showInteractive={false} />}
        {fill && graph.nodes.length > 8 && <MiniMap pannable zoomable nodeStrokeWidth={2} />}
      </ReactFlow>
    </div>
  );
}
