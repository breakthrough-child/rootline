"use client";
// The lineage as a "root system": top-down, date-scaled, tapering organic branches. Presentation only: all data,
// confidence and honesty rules come from the saved result; the layout lives in src/lib/rootLayout.ts.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { layoutRoots, type PlacedEdge, type PlacedNode } from "@/lib/rootLayout";
import type { LineageEdge, Variant } from "@/lib/types";
import { fmtDate, PageTypeBadge, PROVENANCE_LABEL } from "./bits";

interface Props {
  variants: Variant[];
  edges: LineageEdge[];
  earliestId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  thumb?: string;
  sourceKind?: string;
}

const PROV_ICON = { published_date: "●", page_metadata: "◐", from_screenshot_unverified: "◌", pdf_metadata_unverified: "◌", unknown: "?" } as const;
const LEAF_PATH = "M0,-11 C8,-7 8,6 0,11 C-8,6 -8,-7 0,-11 Z";
const chipTone = (type: string) => (type === "authority_added" || type === "authority_removed" || type === "number_changed" ? "border-rose/40 bg-rose-soft text-rose" : "border-amber/40 bg-amber-soft text-amber");

export function TreeView({ variants, edges, earliestId, selectedId, onSelect, thumb, sourceKind }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(820);
  const [zoom, setZoom] = useState(1);
  const clipId = useId().replace(/:/g, "");

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(Math.max(280, Math.floor(el.clientWidth))));
    ro.observe(el);
    setCw(Math.max(280, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  const compact = cw < 560;
  const layout = useMemo(() => layoutRoots(variants, edges, earliestId, { width: cw - 2, compact }), [variants, edges, earliestId, cw, compact]);
  const byId = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);
  const fit = Math.min(1, (cw - 2) / layout.width); // wide trees shrink to fit the screen: no horizontal page scroll
  const scale = fit * zoom;
  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  const resetView = useCallback(() => {
    setZoom(1);
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, []);

  const delay = (y: number) => `${Math.round((y / Math.max(1, layout.height)) * 1500)}ms`;
  const year = (v: Variant) => (v.date ? v.date.slice(0, 4) : null);

  return (
    <div ref={wrapRef} className="relative w-full min-w-0 max-w-full" role="region" aria-label="Lineage root system">
      <div ref={scrollRef} className="overflow-auto rounded-xl border border-line bg-bg" style={{ maxHeight: "min(82vh, 920px)" }}>
        <div style={{ width: layout.width * scale, height: layout.height * scale, position: "relative" }}>
          <div style={{ width: layout.width, height: layout.height, transform: `scale(${scale})`, transformOrigin: "0 0", position: "absolute", left: 0, top: 0 }}>
            {/* ── SVG layer: year scale, branches, twigs, leaves ── */}
            <svg width={layout.width} height={layout.height} className="absolute left-0 top-0" role="presentation" style={{ overflow: "visible" }}>
              <defs>
                <clipPath id={clipId}>
                  <rect className="rt-clip-rect" x={0} y={-40} width={layout.width} height={layout.height + 80} />
                </clipPath>
              </defs>
              {layout.ticks.map((t) => (
                <g key={t.label}>
                  <line x1={compact ? 30 : 46} x2={layout.width - 8} y1={t.y} y2={t.y} stroke="var(--border)" strokeWidth={1} strokeDasharray="2 6" />
                  <text x={compact ? 2 : 6} y={t.y + 4} fontSize={compact ? 10 : 11} fill="var(--muted)" fontFamily="ui-sans-serif, system-ui">
                    {t.label}
                  </text>
                </g>
              ))}
              <g clipPath={`url(#${clipId})`}>
                {layout.edges.map((e) => (
                  <Branch key={`${e.from}>${e.to}`} e={e} />
                ))}
              </g>
              {layout.nodes
                .filter((n) => n.kind === "leaf")
                .map((n) => {
                  const v = byId.get(n.id)!;
                  const isEarliest = n.id === earliestId;
                  const color = v.pageType === "debunk" ? "var(--leaf-fact)" : v.pageType === "official" ? "var(--leaf-official)" : "var(--leaf-news)";
                  const label = `${year(v) ?? "undated"} · ${v.pageType === "debunk" ? "fact-check" : v.pageType}: ${v.excerpt.slice(0, 110)}${isEarliest ? " · Earliest version found" : ""}`;
                  const sel = selectedId === n.id;
                  return (
                    <g key={n.id} transform={`translate(${n.x},${n.y})`} className="rt-fade" style={{ ["--rt-delay" as string]: delay(n.y), cursor: "pointer" }} role="button" tabIndex={0} aria-label={label} onClick={() => onSelect(n.id)} onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && onSelect(n.id)}>
                      <title>{label}</title>
                      {(sel || isEarliest) && <circle r={17} fill="none" stroke={isEarliest ? "var(--accent)" : "var(--ink)"} strokeWidth={isEarliest ? 2 : 1.5} strokeDasharray={isEarliest ? undefined : "3 3"} />}
                      <path d={LEAF_PATH} transform={`rotate(${(n.side ?? 1) * 38})`} fill={color} stroke="var(--bg)" strokeWidth={1.2} opacity={n.undated ? 0.55 : 0.95} />
                      <path d="M0,-8 L0,8" transform={`rotate(${(n.side ?? 1) * 38})`} stroke="var(--bg)" strokeWidth={0.8} opacity={0.6} />
                      <text y={26} textAnchor="middle" fontSize={9.5} fill="var(--muted)" fontFamily="ui-sans-serif, system-ui">
                        {year(v) ?? "undated"}
                      </text>
                    </g>
                  );
                })}
            </svg>

            {/* ── HTML layer: change chips, cards ── */}
            {layout.edges.map((e) =>
              e.kind === "branch" ? (
                <div key={`c-${e.from}>${e.to}`} className="rt-fade pointer-events-none absolute z-10 flex flex-col gap-1" style={{ left: e.mid.x + Math.max(e.width0, 6) / 2 + 8, top: e.mid.y - 10, ["--rt-delay" as string]: delay(e.mid.y) }}>
                  {e.spreadJump && <span className="w-fit rounded-full bg-amber px-1.5 py-0.5 text-[9px] font-bold uppercase text-surface">wider spread</span>}
                  {e.chips.map((c, i) => (
                    <span key={i} className={`w-fit max-w-[150px] truncate rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${chipTone(c.type)}`}>
                      {c.text}
                    </span>
                  ))}
                  {e.weakCount > 0 && <span className="w-fit text-[9px] text-muted">+{e.weakCount} weaker</span>}
                </div>
              ) : null,
            )}
            {layout.nodes
              .filter((n) => n.kind !== "leaf")
              .map((n) => (
                <Card key={n.id} n={n} v={byId.get(n.id)!} isEarliest={n.id === earliestId} selected={selectedId === n.id} onSelect={onSelect} delayMs={delay(n.y)} compact={compact} thumb={n.kind === "user" ? thumb : undefined} sourceKind={sourceKind} />
              ))}
            {/* an earliest evidence page above the root */}
            {(() => {
              const top = layout.nodes.find((n) => n.kind === "leaf" && n.aboveRoot);
              return top && nodeById.get(top.id) ? <span className="pointer-events-none absolute text-[10px] font-semibold uppercase tracking-wide text-accent" style={{ left: top.x + 22, top: top.y - 7 }}>Earliest version found (evidence page)</span> : null;
            })()}
          </div>
        </div>
      </div>

      <div className="absolute bottom-3 right-3 z-20 flex flex-col overflow-hidden rounded-lg border border-line bg-surface text-ink shadow">
        <button aria-label="Zoom in" className="px-2.5 py-1.5 text-base hover:bg-surface-2" onClick={() => setZoom((z) => Math.min(2.5, +(z * 1.25).toFixed(3)))}>
          +
        </button>
        <button aria-label="Zoom out" className="border-t border-line px-2.5 py-1.5 text-base hover:bg-surface-2" onClick={() => setZoom((z) => Math.max(0.5, +(z / 1.25).toFixed(3)))}>
          −
        </button>
        <button aria-label="Fit to screen" className="border-t border-line px-2 py-1.5 text-[11px] hover:bg-surface-2" onClick={resetView}>
          Fit
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Top = earliest version found; time runs downward. Cards are copies of the message; small leaves are evidence pages (fact-checks without a clean quoted copy). Thicker branches carry more descendants; faint dotted branches are low-confidence links.
      </p>
    </div>
  );
}

function Branch({ e }: { e: PlacedEdge }) {
  const low = e.confidence === "low";
  const opacity = e.kind === "twig" ? 0.55 : low ? 0.42 : e.confidence === "medium" ? 0.82 : 1;
  const fill = e.spreadJump ? "var(--moss)" : e.kind === "twig" ? "var(--bark-soft)" : "var(--bark)";
  return (
    <g>
      <path d={e.ribbon} fill={fill} opacity={opacity} />
      {(low || e.kind === "twig") && <path d={e.center} fill="none" stroke="var(--bg)" strokeWidth={Math.min(2, Math.max(1, e.width0 / 3))} strokeDasharray="1.5 5" strokeLinecap="round" opacity={0.9} />}
    </g>
  );
}

function Card({ n, v, isEarliest, selected, onSelect, delayMs, compact, thumb, sourceKind }: { n: PlacedNode; v: Variant; isEarliest: boolean; selected: boolean; onSelect: (id: string) => void; delayMs: string; compact: boolean; thumb?: string; sourceKind?: string }) {
  const user = n.kind === "user";
  const y = v.date ? v.date.slice(0, 4) : null;
  return (
    <div className="rt-pop absolute" style={{ left: n.x - n.w / 2, top: n.y - n.h / 2, width: n.w, height: n.h, ["--rt-delay" as string]: delayMs }}>
      {user && <span className="absolute -top-[22px] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-blue px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-surface">You are here</span>}
      {isEarliest && !user && <span className="absolute -top-[9px] left-2 z-10 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-ink">Earliest version found</span>}
      {v.isNew && <span className="absolute -top-[9px] right-2 z-10 rounded-full bg-amber px-1.5 py-0.5 text-[9px] font-bold uppercase text-surface">New</span>}
      <button
        onClick={() => onSelect(n.id)}
        title={`${y ?? "Undated"} (${PROVENANCE_LABEL[v.dateProvenance]}) — ${v.excerpt.slice(0, 160)}`}
        className={`h-full w-full rounded-2xl border-2 bg-surface px-2.5 py-1.5 text-left shadow-md transition hover:border-accent ${selected ? "border-accent ring-2 ring-accent/30" : user ? "border-blue" : isEarliest ? "border-accent/70" : "border-line"}`}
      >
        <div className="flex items-center gap-1.5 text-[11px]">
          <span aria-hidden className={v.dateProvenance === "published_date" ? "text-accent" : v.dateProvenance === "unknown" ? "text-muted" : "text-amber"}>
            {PROV_ICON[v.dateProvenance]}
          </span>
          {y ? <span className="font-semibold tabular-nums">{y}</span> : <span className="rounded bg-surface-2 px-1 py-px text-[10px] font-semibold uppercase text-muted">undated</span>}
          <PageTypeBadge type={v.pageType} />
          {v.sources.length > 1 && !compact && <span className="text-muted">· {v.sources.length}</span>}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {thumb && <img src={thumb} alt="" className="h-6 w-6 shrink-0 rounded border border-line object-cover" />}
          {!thumb && user && sourceKind && sourceKind !== "text" && <span className="shrink-0 rounded bg-surface-2 px-1 text-[9px] uppercase text-muted">{sourceKind}</span>}
          <p className="truncate text-[12px] leading-tight">{v.excerpt}</p>
        </div>
        <span className="sr-only">{v.date ? fmtDate(v.date) : "Undated"}</span>
      </button>
    </div>
  );
}
