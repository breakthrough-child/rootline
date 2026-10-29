"use client";
// The lineage as roots growing through soil: surface = today (your copy on the grass), roots run down into older versions,
// the deepest point is the earliest version found. Presentation only: data, confidence and honesty rules come from the saved
// result; ordering/lanes live in src/lib/soilLayout.ts. Rows are real HTML (measured), roots are drawn around them in SVG.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { planSoil, siteName, soilGeometry, type Rect, type SoilRow } from "@/lib/soilLayout";
import type { LineageEdge, PageType, Variant } from "@/lib/types";
import { fmtDate, hostOf, PageTypeBadge } from "./bits";

interface Props {
  variants: Variant[];
  edges: LineageEdge[];
  earliestId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  thumb?: string;
  sourceKind?: string;
}

const TYPE_WORD: Record<PageType, string> = { debunk: "fact-check", official: "official", news: "news", social: "social post", forum: "forum", other: "web page", user_input: "your copy" };
const chipTone = (type: string) => (type === "authority_added" || type === "authority_removed" || type === "number_changed" ? "border-rose/40 bg-rose-soft text-rose" : "border-amber/40 bg-amber-soft text-amber");
const yearOf = (v: Variant) => (v.date ? v.date.slice(0, 4) : null);
const hostFor = (v: Variant) => (v.isUserInput ? "Your copy" : v.sources[0] ? hostOf(v.sources[0].url) : "");

/** One plain sentence + one small line, built only from the saved data. Neutral when evidence is thin. */
export function bannerText(variants: Variant[], edges: LineageEdge[], earliestId: string | null): { headline: string; detail: string } {
  const others = variants.filter((v) => !v.isUserInput);
  const e = variants.find((v) => v.id === earliestId && !v.isUserInput);
  const strong = edges.flatMap((x) => x.mutations).filter((m) => m.strength === "strong").length;
  const parts = [`${others.length} version${others.length === 1 ? "" : "s"} found`, strong ? `${strong} notable change${strong === 1 ? "" : "s"} detected` : ""].filter(Boolean);
  if (!others.length) return { headline: "Rootline did not find earlier versions of this message.", detail: "That does not mean none exist: the search may simply have missed them." };
  const thin = others.length < 3 ? "Only a few versions were found, so this picture may be incomplete. " : "";
  if (e?.date) {
    const place = `${TYPE_WORD[e.pageType]} on ${hostFor(e)}, ${fmtDate(e.date)}`;
    return { headline: `This message has circulated since ${e.date.slice(0, 4)}.`, detail: `${thin}Earliest version found: ${place}. ${parts.join(" · ")}.` };
  }
  return { headline: "Rootline could not date the earliest version of this message.", detail: `${thin}${parts.join(" · ")}.` };
}

export function TreeView({ variants, edges, earliestId, selectedId, onSelect, thumb, sourceKind }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const [cw, setCw] = useState(820);
  const [zoom, setZoom] = useState(1);
  const [rects, setRects] = useState<Map<string, Rect>>(new Map());
  const [height, setHeight] = useState(600);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const clipId = useId().replace(/:/g, "");
  const sigRef = useRef("");

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(Math.max(280, Math.floor(el.clientWidth))));
    ro.observe(el);
    setCw(Math.max(280, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  const compact = cw < 640;
  const W = cw - 2;
  const plan = useMemo(() => planSoil(variants, edges, earliestId), [variants, edges, earliestId]);
  const byId = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);
  const stripW = compact ? Math.min(96, Math.max(52, plan.lanes * 15 + 36)) : Math.min(250, Math.max(130, plan.lanes * 32 + 70));
  const strip = compact ? { x0: 0, x1: stripW } : { x0: (W - stripW) / 2, x1: (W + stripW) / 2 };
  const cols = compact ? `${stripW}px minmax(0,1fr)` : `minmax(0,1fr) ${stripW}px minmax(0,1fr)`;
  const col = (side: 1 | -1) => (compact ? 2 : side === 1 ? 3 : 1);

  const measure = useCallback(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const base = inner.getBoundingClientRect();
    const next = new Map<string, Rect>();
    for (const [id, el] of els.current) {
      const r = el.getBoundingClientRect();
      next.set(id, { x: (r.left - base.left) / zoom, y: (r.top - base.top) / zoom, w: r.width / zoom, h: r.height / zoom });
    }
    const h = Math.ceil(inner.offsetHeight);
    const sig = `${h}|${[...next].map(([k, r]) => `${k}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`).join(";")}`;
    if (sig === sigRef.current) return;
    sigRef.current = sig;
    setRects(next);
    setHeight(h);
  }, [zoom]);

  useLayoutEffect(() => {
    measure();
  });
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [measure]);

  const geo = useMemo(() => (rects.size ? soilGeometry({ plan, rects, width: W, height, strip, compact }) : null), [plan, rects, W, height, strip.x0, strip.x1, compact]); // eslint-disable-line react-hooks/exhaustive-deps
  const reg = (id: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  };
  const resetView = () => {
    setZoom(1);
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  };
  const nRows = Math.max(1, plan.rows.length);
  const delay = (i: number) => ({ ["--rt-delay" as string]: `${Math.round((i / nRows) * 1500)}ms` });
  const banner = useMemo(() => bannerText(variants, edges, earliestId), [variants, edges, earliestId]);
  const edgeInto = useMemo(() => new Map(plan.edges.map((e) => [e.to, e])), [plan]);
  const earliestStone = !!earliestId && plan.rows.some((r) => r.kind === "stones" && r.items.some((i) => i.id === earliestId));

  const card = (id: string, i: number, side: 1 | -1 | 0) => {
    const v = byId.get(id)!;
    const user = !!v.isUserInput;
    const e = edgeInto.get(id);
    const isRoot = id === plan.rootId && !user;
    const expanded = open.has(id);
    const y = yearOf(v);
    const sel = selectedId === id;
    return (
      <div key={id} ref={reg(id)} className="rt-pop min-w-0" style={{ ...delay(i), gridColumn: side === 0 ? "1 / -1" : col(side as 1 | -1), justifySelf: side === 0 ? "center" : undefined, width: side === 0 ? "min(340px, 100%)" : undefined }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelect(id)}
          onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), onSelect(id))}
          className={`relative cursor-pointer rounded-2xl border-2 bg-surface p-3 text-left shadow-lg transition hover:border-accent ${sel ? "border-accent ring-2 ring-accent/30" : user ? "border-blue" : isRoot ? "border-accent/70" : "border-line"}`}
        >
          {user && <span className="absolute -top-2.5 left-3 rounded-full bg-blue px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-surface">You are here</span>}
          {isRoot && <span className="absolute -top-2.5 left-3 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-ink">{id === earliestId ? "Root: earliest version found" : "Oldest copy found"}</span>}
          {v.isNew && <span className="absolute -top-2.5 right-3 rounded-full bg-amber px-2 py-0.5 text-[10px] font-bold uppercase text-surface">New</span>}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {y ? <span className="text-2xl font-semibold leading-none tabular-nums">{y}</span> : <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-semibold uppercase text-muted">undated</span>}
            {!user && <PageTypeBadge type={v.pageType} />}
            <span className="min-w-0 truncate text-xs text-muted">{hostFor(v)}</span>
          </div>
          <div className="mt-2 flex gap-2">
            {user && thumb && <img src={thumb} alt="" className="h-12 w-12 shrink-0 rounded border border-line object-cover" />}
            <p className={`min-w-0 text-[13px] leading-snug ${expanded ? "" : "line-clamp-3"}`}>{expanded ? v.text.slice(0, 1200) : v.excerpt}</p>
          </div>
          {(v.excerpt.length > 150 || v.text.length > v.excerpt.length + 20) && (
            <button
              className="mt-1 text-[11px] text-accent underline-offset-2 hover:underline"
              onClick={(ev) => {
                ev.stopPropagation();
                setOpen((s) => {
                  const n = new Set(s);
                  if (n.has(id)) n.delete(id);
                  else n.add(id);
                  return n;
                });
              }}
            >
              {expanded ? "Show less" : "Show full text"}
            </button>
          )}
          {user && sourceKind && sourceKind !== "text" && <span className="ml-2 rounded bg-surface-2 px-1 text-[10px] uppercase text-muted">{sourceKind}</span>}
          {e?.changeNote && (
            <p className="mt-2 border-t border-line pt-2 text-[12px] leading-snug">
              <span className="font-semibold text-accent">What changed: </span>
              {e.changeNote}
            </p>
          )}
          {e && (e.chips.length > 0 || e.spreadJump || e.weakCount > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {e.spreadJump && <span className="rounded-full bg-amber px-1.5 py-0.5 text-[9px] font-bold uppercase text-surface">wider spread</span>}
              {e.chips.map((c, k) => (
                <span key={k} className={`max-w-full truncate rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${chipTone(c.type)}`}>
                  {c.text}
                </span>
              ))}
              {e.weakCount > 0 && <span className="text-[10px] text-muted">+{e.weakCount} weaker in details</span>}
            </div>
          )}
          <span className="sr-only">{v.date ? fmtDate(v.date) : "Undated"}</span>
        </div>
      </div>
    );
  };

  const row = (r: SoilRow, i: number) => {
    if (r.kind === "gap")
      return (
        <div key={`g-${r.key}`} className="rt-fade my-1 min-w-0 text-center" style={{ ...delay(i), gridColumn: "1 / -1" }}>
          <span className="rounded-full bg-surface/80 px-3 py-0.5 text-[11px] tracking-wide text-muted">··· {r.years} years deeper ···</span>
        </div>
      );
    if (r.kind === "user") return card(r.id, i, compact ? 1 : 0);
    if (r.kind === "card") return card(r.id, i, compact ? 1 : r.side);
    return r.items.map((it) => {
      const v = byId.get(it.id)!;
      const y = yearOf(v);
      const label = `${siteName(hostFor(v))} · ${y ?? "undated"} · ${TYPE_WORD[v.pageType]}`;
      const sel = selectedId === it.id;
      const earliest = it.id === earliestId;
      return (
        <div key={it.id} ref={reg(it.id)} className="rt-pop min-w-0" style={{ ...delay(i), gridColumn: col(compact ? 1 : it.side), justifySelf: compact || it.side === 1 ? "start" : "end", maxWidth: "100%" }}>
          <button
            onClick={() => onSelect(it.id)}
            title={`${label} — ${v.excerpt.slice(0, 200)}`}
            aria-label={`${label}${earliest ? " (earliest version found)" : ""}`}
            className={`max-w-full border-2 bg-surface px-3 py-1.5 text-left text-[12px] leading-tight shadow-md transition hover:border-accent ${sel ? "border-accent ring-2 ring-accent/30" : earliest ? "border-accent" : "border-[var(--pebble)]"}`}
            style={{ borderRadius: "999px 60% 70% 999px / 70% 50% 60% 55%" }}
          >
            {earliest && <span className="mr-1.5 text-[9px] font-bold uppercase text-accent">Earliest version found ·</span>}
            <span className="font-medium">{label}</span>
          </button>
        </div>
      );
    });
  };

  return (
    <div ref={wrapRef} className="relative w-full min-w-0 max-w-full" role="region" aria-label="Lineage root system">
      <div className="mb-3 rounded-xl border border-line bg-surface px-4 py-3">
        <p className="text-base font-semibold">{banner.headline}</p>
        <p className="mt-0.5 text-xs text-muted">{banner.detail}</p>
      </div>
      <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden rounded-xl border border-line" style={{ background: "var(--soil-1)" }}>
        <div style={{ width: W * zoom, height: height * zoom, position: "relative" }}>
          <div ref={innerRef} className="absolute left-0 top-0" style={{ width: W, transform: `scale(${zoom})`, transformOrigin: "0 0" }}>
            {geo && (
              <svg width={W} height={height} className="pointer-events-none absolute left-0 top-0" role="presentation" aria-hidden>
                <defs>
                  <filter id={`${clipId}g`} x="0" y="0" width="100%" height="100%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n" />
                    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 -0.12" />
                  </filter>
                  <clipPath id={clipId}>
                    <rect className="rt-clip-rect" x={0} y={geo.grassY} width={W} height={height} />
                  </clipPath>
                </defs>
                <rect x={0} y={0} width={W} height={geo.grassY} fill="var(--bg)" />
                {geo.strata.map((s) => (
                  <path key={s.i} d={s.d} fill={`var(--soil-${s.i + 1})`} />
                ))}
                <rect x={0} y={geo.grassY} width={W} height={height - geo.grassY} filter={`url(#${clipId}g)`} opacity={0.35} style={{ mixBlendMode: "multiply" }} />
                {geo.pebbles.map((p, i) => (
                  <g key={i} transform={`translate(${p.x},${p.y}) rotate(${p.rot})`}>
                    <ellipse rx={p.rx} ry={p.ry} fill="var(--pebble)" />
                    <ellipse rx={p.rx * 0.5} ry={p.ry * 0.4} cx={-p.rx * 0.2} cy={-p.ry * 0.3} fill="#fff" opacity={0.25} />
                  </g>
                ))}
                <path d={geo.grass} fill="var(--grass)" />
                <g clipPath={`url(#${clipId})`}>
                  {geo.roots.map((r) => {
                    const op = r.confidence === "low" ? 0.55 : r.confidence === "medium" ? 0.85 : 1;
                    return (
                      <g key={r.key} opacity={op}>
                        <path d={r.hairs} fill="none" stroke="var(--root)" strokeWidth={0.9} strokeLinecap="round" opacity={0.7} />
                        <path d={r.fill} fill={r.spreadJump ? "var(--moss)" : "var(--root)"} />
                        <path d={r.highlight} fill="none" stroke="var(--root-hi)" strokeWidth={1.4} strokeLinecap="round" opacity={0.8} />
                      </g>
                    );
                  })}
                  {geo.connectors.map((c) => (
                    <path key={c.key} d={c.d} fill="none" stroke={c.kind === "stem" ? "var(--grass)" : "var(--root)"} strokeWidth={c.w} strokeLinecap="round" strokeDasharray={c.kind === "stone" ? "1 5" : undefined} />
                  ))}
                </g>
              </svg>
            )}
            <div className="relative z-10 grid gap-y-4 px-3 pb-24 pt-5" style={{ gridTemplateColumns: cols, columnGap: 0 }}>
              {plan.rows.map((r, i) => row(r, i))}
            </div>
          </div>
        </div>
      </div>

      <div className="absolute right-3 top-[88px] z-20 flex flex-col overflow-hidden rounded-lg border border-line bg-surface text-ink shadow">
        <button aria-label="Zoom in" className="px-2.5 py-1.5 text-base hover:bg-surface-2" onClick={() => setZoom((z) => Math.min(2, +(z * 1.2).toFixed(3)))}>
          +
        </button>
        <button aria-label="Zoom out" className="border-t border-line px-2.5 py-1.5 text-base hover:bg-surface-2" onClick={() => setZoom((z) => Math.max(0.6, +(z / 1.2).toFixed(3)))}>
          −
        </button>
        <button aria-label="Fit to screen" className="border-t border-line px-2 py-1.5 text-[11px] hover:bg-surface-2" onClick={resetView}>
          Fit
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Surface = today; roots run down into older versions and the deepest point is the earliest version found. Gaps in time are compressed. Cards are copies of the message; stones are evidence pages (hover or click for details). Thicker roots carry more descendants; thin, pale roots are low-confidence links.{earliestStone ? " The earliest page found is an evidence page, shown at the bottom." : ""}
      </p>
    </div>
  );
}
