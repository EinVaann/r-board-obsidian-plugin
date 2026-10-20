/**
 * A plan as a node graph (React Flow), laid out left → right by dagre.
 * Machines, inputs, outputs and surplus are HTML nodes styled with Obsidian's
 * variables; edges carry the item, its rate and, with a transport table, the
 * lanes it needs. Loop edges (recycling back) are dashed.
 */

import { memo, useEffect, useMemo } from 'react';
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

interface NodeData extends Record<string, unknown> {
  g: GNode;
  per: string;
}

interface EdgeData extends Record<string, unknown> {
  g: GEdge;
  hauls: (Haul | null)[];
  per: string;
  width: number;
  click?: (evt: MouseEvent) => void;
  /** A transport table exists (so a missing transport is flagged). */
  transport: boolean;
}

// ------------------------------------------------------------------ nodes

const MachineNode = memo(function MachineNode({ data }: NodeProps<Node<NodeData>>) {
  const s = data.g.step!;
  const { built: builtCount, part } = machineUse(s.machines);
  return (
    <div className="rb-fg-node rb-fg-recipe" title={`${fmt(s.machines)} machines' worth of work · ${fmt(s.runs)} crafts /${data.per}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="rb-fg-head">
        <span className="rb-fg-count">{builtCount}×</span> {s.recipe.machine}
      </div>
      <div className="rb-fg-sub">{s.recipe.name}</div>
      <div className={part ? 'rb-fg-busy is-partial' : 'rb-fg-busy'}>{machineSplit(s.machines)}</div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

const TAG: Record<string, string> = { raw: 'Input', out: 'Output', extra: 'Surplus' };

const ItemNode = memo(function ItemNode({ data }: NodeProps<Node<NodeData>>) {
  const { g } = data;
  const a = g.amount!;
  return (
    <div className={`rb-fg-node rb-fg-${g.kind}`}>
      {g.kind !== 'raw' && <Handle type="target" position={Position.Left} isConnectable={false} />}
      <div className="rb-fg-tag">{TAG[g.kind]}</div>
      <div className="rb-fg-head">{a.item}</div>
      <div className="rb-fg-sub">
        {fmt(a.qty)} /{data.per}
      </div>
      {g.kind === 'raw' && <Handle type="source" position={Position.Right} isConnectable={false} />}
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
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    targetX: p.targetX,
    targetY: p.targetY,
    sourcePosition: p.sourcePosition,
    targetPosition: p.targetPosition,
    borderRadius: 14,
    offset: d.g.back ? 28 : 20,
  });
  const busy = d.hauls.some((h) => h && h.lanes > 1) || (d.transport && d.hauls.some((h) => !h));
  const cls = ['rb-fg-edge', d.g.back ? 'is-back' : '', busy ? 'is-busy' : ''].filter(Boolean).join(' ');
  return (
    <>
      <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} className={cls} style={{ strokeWidth: d.width }} interactionWidth={16} />
      <EdgeLabelRenderer>
        <div
          className={`rb-fg-label nodrag nopan${busy ? ' is-busy' : ''}${d.click ? ' is-clickable' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
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

// ------------------------------------------------------------------ layout

function layout(nodes: GNode[], edges: GEdge[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 26, ranksep: 120, edgesep: 18, marginx: 12, marginy: 12 });
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
  return pos;
}

export interface FlowGraphProps {
  plan: Plan;
  per: Per;
  transport?: TransportBook;
  choice?: TransportChoice;
  /** Fill the parent (the planner tab): wheel zoom, controls, minimap. Otherwise sized to the graph, for notes. */
  fill?: boolean;
  height?: number;
  onNodeClick?: (node: GNode, evt: MouseEvent) => void;
  onEdgeClick?: (edge: GEdge, hauls: (Haul | null)[], evt: MouseEvent) => void;
}

export function FlowGraph({ plan, per, transport, choice = NO_CHOICE, fill, height, onNodeClick, onEdgeClick }: FlowGraphProps) {
  const graph = useMemo(() => buildGraph(plan, per), [plan, per]);
  const pos = useMemo(() => layout(graph.nodes, graph.edges), [graph]);
  const perLabel = PER_LABEL[per];

  const nodes: Node<NodeData>[] = useMemo(
    () => graph.nodes.map((g) => ({ id: g.id, type: g.kind, position: pos.get(g.id)!, data: { g, per: perLabel }, draggable: true, connectable: false })),
    [graph, pos, perLabel],
  );
  // Nodes can be dragged around; a new layout (any change to the plan) puts them back.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(nodes);
  useEffect(() => setRfNodes(nodes), [nodes, setRfNodes]);
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
          width: 1.5 + 3.5 * Math.sqrt(Math.min(1, total / max)),
          click: onEdgeClick && transport ? (evt: MouseEvent) => onEdgeClick(g, hauls, evt) : undefined,
        },
      };
    });
  }, [graph, transport, choice, per, perLabel, onEdgeClick]);

  // Notes: height from the layout (so the block isn't a fixed box), capped.
  const bottom = Math.max(0, ...graph.nodes.map((n) => pos.get(n.id)!.y + SIZE[n.kind]));
  const h = fill ? undefined : height ?? Math.min(560, Math.max(160, bottom + 40));
  const byNode = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  return (
    <div className={fill ? 'rb-fg rb-fg-fill' : 'rb-fg'} style={h ? { height: h } : undefined}>
      <ReactFlow
        key={graph.nodes.map((n) => n.id).join('|')}
        nodes={rfNodes}
        onNodesChange={onNodesChange}
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
