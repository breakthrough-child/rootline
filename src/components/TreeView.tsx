"use client";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Handle, Position, ReactFlow, Controls, type Edge, type EdgeProps, type Node, type NodeProps, useReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo } from "react";
import { mutationChip } from "@/lib/heuristics";
import { layoutTree } from "@/lib/tree";
import type { LineageEdge, Variant } from "@/lib/types";
import { DateBadge, PageTypeBadge } from "./bits";

type VNodeData = { variant: Variant; earliest: boolean; thumb?: string; sourceKind?: string; selected: boolean; onSelect: (id: string) => void };
type VEdgeData = { edge: LineageEdge };

const COL_W = 330;
const ROW_H = 175;

function VariantNode({ data }: NodeProps<Node<VNodeData>>) {
  const v = data.variant;
  return (
    <button
      onClick={() => data.onSelect(v.id)}
      className={`node-in w-[270px] rounded-xl border-2 bg-surface p-3 text-left shadow-md transition hover:border-accent ${data.selected ? "border-accent ring-2 ring-accent/30" : v.isUserInput ? "border-blue" : data.earliest ? "border-accent/70" : "border-line"}`}
    >
      <Handle type="target" position={Position.Left} className="!border-0 !bg-transparent" />
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {data.earliest && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-ink">Earliest version found</span>}
        {v.isCopy === false && <span title="A dated page about this claim with no clean quoted copy of the message, so no changes are labelled" className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Evidence page</span>}
        {v.isUserInput && <span className="rounded-full bg-blue-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue">Your copy</span>}
        {v.isNew && <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber">New since last run</span>}
      </div>
      <div className="flex gap-2">
        {v.isUserInput && data.thumb && <img src={data.thumb} alt="" className="h-14 w-14 shrink-0 rounded-md border border-line object-cover" />}
        {v.isUserInput && !data.thumb && data.sourceKind && data.sourceKind !== "text" && (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-surface-2 text-[10px] uppercase text-muted">{data.sourceKind}</span>
        )}
        <p className="line-clamp-3 text-[13px] leading-snug text-ink">{v.excerpt}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        <DateBadge date={v.date} provenance={v.dateProvenance} compact />
        <PageTypeBadge type={v.pageType} />
        {v.sources.length > 1 && <span>· {v.sources.length} sources</span>}
      </div>
      <Handle type="source" position={Position.Right} className="!border-0 !bg-transparent" />
    </button>
  );
}

function MutationEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<VEdgeData>>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const e = data!.edge;
  const chips = e.mutations.filter((m) => m.strength === "strong" || (m.strength === undefined && m.type !== "other" && m.type !== "detail_added" && m.type !== "detail_removed")).slice(0, 3);
  const dash = e.evidenceOnly ? "2 5" : e.confidence === "low" ? "6 5" : e.confidence === "medium" ? "2 0" : undefined;
  return (
    <>
      <BaseEdge id={id} path={path} style={{ strokeDasharray: dash, strokeWidth: e.confidence === "high" ? 2.4 : 1.6, stroke: e.spreadJump ? "var(--amber)" : "var(--muted)", opacity: e.evidenceOnly ? 0.55 : e.confidence === "low" ? 0.7 : 1 }} />
      <EdgeLabelRenderer>
        <div style={{ transform: `translate(-50%, -50%) translate(${lx}px,${ly}px)`, pointerEvents: "none" }} className="nodrag nopan absolute flex max-w-[170px] flex-col items-center gap-0.5">
          {e.spreadJump && <span className="rounded-full bg-amber px-1.5 py-0.5 text-[9px] font-bold uppercase text-surface">wider spread</span>}
          {chips.map((m, i) => (
            <span key={i} className={`truncate rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${m.type === "authority_added" || m.type === "number_changed" ? "border-rose/40 bg-rose-soft text-rose" : "border-amber/40 bg-amber-soft text-amber"}`}>
              {mutationChip(m)}
            </span>
          ))}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { variant: VariantNode };
const edgeTypes = { mutation: MutationEdge };

function Fitter({ count }: { count: number }) {
  const rf = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.15, duration: 400, maxZoom: 1 }), 60);
    return () => clearTimeout(t);
  }, [count, rf]);
  return null;
}

export function TreeView(props: { variants: Variant[]; edges: LineageEdge[]; earliestId: string | null; selectedId: string | null; onSelect: (id: string) => void; thumb?: string; sourceKind?: string }) {
  const { variants, edges, earliestId, selectedId, onSelect, thumb, sourceKind } = props;
  // Layout root = the node with no parent. (The "earliest version found" badge can sit on an evidence leaf, so it is not the root.)
  const rootId = edges.length ? (variants.find((v) => !edges.some((x) => x.to === v.id))?.id ?? null) : earliestId;
  const tree = useMemo(() => {
    let pos: { id: string; col: number; row: number }[];
    if (edges.length) pos = layoutTree(variants, edges, rootId);
    else {
      // Before lineage is known: time-ordered grid so the tree visibly grows left to right.
      pos = variants.map((v, i) => ({ id: v.id, col: Math.floor(i / 3), row: i % 3 }));
    }
    const nodes: Node<VNodeData>[] = variants.map((v) => {
      const p = pos.find((x) => x.id === v.id) ?? { col: 0, row: 0 };
      return { id: v.id, type: "variant", position: { x: p.col * COL_W, y: p.row * ROW_H }, data: { variant: v, earliest: v.id === earliestId, thumb, sourceKind, selected: v.id === selectedId, onSelect }, draggable: false };
    });
    const flowEdges: Edge<VEdgeData>[] = edges.map((e) => ({ id: `${e.from}-${e.to}`, source: e.from, target: e.to, type: "mutation", data: { edge: e } }));
    const maxRow = Math.max(0, ...pos.map((p) => p.row));
    return { nodes, flowEdges, maxRow };
  }, [variants, edges, rootId, earliestId, selectedId, onSelect, thumb, sourceKind]);
  // Wide, bushy trees (many evidence leaves under one copy) need more vertical room to stay readable at fit-to-screen.
  const height = Math.min(900, Math.max(460, Math.round((tree.maxRow + 1) * 62)));

  return (
    <div style={{ height }} className="w-full overflow-hidden rounded-xl border border-line bg-bg" role="region" aria-label="Lineage tree">
      <ReactFlowProvider>
        <ReactFlow nodes={tree.nodes} edges={tree.flowEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView minZoom={0.2} maxZoom={1.6} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
          <Controls showInteractive={false} position="bottom-right" />
          <Fitter count={tree.nodes.length + tree.flowEdges.length} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
