// Layout for the "roots in soil" lineage view. Pure and deterministic; it only decides where things go, never what is true.
//
//   • surface = today: the user's copy sits on the grass at the top; roots grow downward into older versions and the
//     deepest point is the earliest version found. Rows are ordered by age but NOT spaced by exact dates (long gaps get a
//     "··· N years deeper ···" marker instead);
//   • message versions are cards beside the roots (alternating left/right on desktop); evidence pages are labelled stones;
//   • planSoil() decides the order/sides/lanes (before anything is measured); soilGeometry() draws the roots from the
//     measured positions of the rendered rows.
import { mutationChip } from "./heuristics";
import type { Confidence, LineageEdge, Mutation, Variant } from "./types";

export type Side = 1 | -1; // 1 = right of the roots

export type SoilRow =
  | { kind: "user"; id: string }
  | { kind: "card"; id: string; side: Side }
  | { kind: "stones"; parentId: string; items: { id: string; side: Side }[]; below: boolean }
  | { kind: "gap"; key: string; years: number };

export interface PlanEdge {
  from: string; // parent (older, deeper)
  to: string; // child (newer, nearer the surface)
  confidence: Confidence;
  evidenceOnly: boolean;
  spreadJump: boolean;
  chips: { text: string; type: Mutation["type"] }[]; // strong detected changes only
  weakCount: number;
  changeNote?: string;
}

export interface SoilPlan {
  rows: SoilRow[];
  lanes: number;
  lane: Map<string, number>;
  edges: PlanEdge[]; // real copy→copy edges (virtual attachments are never drawn)
  stoneEdges: { from: string; to: string }[];
  desc: Map<string, number>;
  rootId: string | null;
  userId: string | null;
}

const dateMs = (d: string | null) => {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : t;
};

export const isStrongMutation = (m: Mutation) => m.strength === "strong" || (m.strength === undefined && !["detail_added", "detail_removed", "other"].includes(m.type));

/** Which nodes are drawn as stones: evidence pages with no children, when real copies exist. */
export function leafIds(variants: Variant[], edges: { from: string; to: string }[]): Set<string> {
  const hasCopy = variants.some((v) => !v.isUserInput && v.isCopy !== false);
  const hasChild = new Set(edges.map((e) => e.from));
  return new Set(hasCopy ? variants.filter((v) => !v.isUserInput && v.isCopy === false && !hasChild.has(v.id)).map((v) => v.id) : []);
}

const yearOf = (v: Variant) => {
  const t = dateMs(v.date);
  return t === null ? null : new Date(t).getUTCFullYear();
};

export function planSoil(variants: Variant[], edgesIn: LineageEdge[], earliestId: string | null): SoilPlan {
  const empty: SoilPlan = { rows: [], lanes: 1, lane: new Map(), edges: [], stoneEdges: [], desc: new Map(), rootId: null, userId: null };
  if (!variants.length) return empty;
  const byId = new Map(variants.map((v) => [v.id, v]));
  let edges = edgesIn.filter((e) => byId.has(e.from) && byId.has(e.to));
  const hasParent = new Set(edges.map((e) => e.to));
  const user = variants.find((v) => v.isUserInput) ?? null;
  const nonUser = variants.filter((v) => !v.isUserInput);
  const tOf = (v: Variant) => dateMs(v.date);
  const earliest = [...nonUser].sort((a, b) => (tOf(a) ?? Infinity) - (tOf(b) ?? Infinity))[0];
  const root = variants.find((v) => !hasParent.has(v.id) && !v.isUserInput) ?? earliest ?? variants[0];
  const real = new Set(edges.map((e) => `${e.from}>${e.to}`));
  const latest = [...nonUser].filter((v) => v.isCopy !== false).sort((a, b) => (tOf(b) ?? -Infinity) - (tOf(a) ?? -Infinity))[0] ?? root;
  // A node with no parent gets a virtual one so it still has a place; virtual attachments are never drawn as roots.
  for (const v of variants) {
    if (v.id !== root.id && !edges.some((e) => e.to === v.id)) {
      const parent = v.isUserInput ? latest : root;
      if (parent && parent.id !== v.id) edges = [...edges, { from: parent.id, to: v.id, confidence: "low", reason: "", mutations: [] }];
    }
  }
  const stones = leafIds(variants, edges);
  const isNode = (id: string) => !stones.has(id); // cards + user
  const children = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const e of edges) {
    children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
    if (!parentOf.has(e.to)) parentOf.set(e.to, e.from);
  }
  const eff = new Map<string, number>();
  const effDate = (id: string, depth = 0): number => {
    if (eff.has(id)) return eff.get(id)!;
    const v = byId.get(id)!;
    let t: number;
    if (v.isUserInput) t = Infinity;
    else t = tOf(v) ?? (depth < 50 && parentOf.has(id) ? effDate(parentOf.get(id)!, depth + 1) : -Infinity);
    eff.set(id, t);
    return t;
  };
  const nodeKids = (id: string) => (children.get(id) ?? []).filter(isNode).sort((a, b) => effDate(a) - effDate(b));

  const desc = new Map<string, number>();
  const countDesc = (id: string, trail = new Set<string>()): number => {
    if (desc.has(id)) return desc.get(id)!;
    if (trail.has(id)) return 0;
    trail.add(id);
    const n = (children.get(id) ?? []).reduce((a, c) => a + 1 + countDesc(c, trail), 0);
    desc.set(id, n);
    return n;
  };
  countDesc(root.id);
  for (const v of variants) if (!desc.has(v.id)) countDesc(v.id);

  // lanes: tidy tree, one lane per branch end
  let lanes = 0;
  const lane = new Map<string, number>();
  const seen = new Set<string>();
  const assign = (id: string): number => {
    seen.add(id);
    const kids = nodeKids(id).filter((k) => !seen.has(k));
    if (!kids.length) {
      lane.set(id, lanes++);
      return lane.get(id)!;
    }
    const xs = kids.map(assign);
    const m = (Math.min(...xs) + Math.max(...xs)) / 2;
    lane.set(id, m);
    return m;
  };
  if (isNode(root.id)) assign(root.id);
  for (const v of variants) if (isNode(v.id) && !lane.has(v.id)) lane.set(v.id, lanes++);

  // order: newest first (user at the surface), every child before its parent
  const waiting = new Map<string, number>();
  for (const v of variants) if (isNode(v.id)) waiting.set(v.id, nodeKids(v.id).length);
  const avail = [...waiting.entries()].filter(([, n]) => n === 0).map(([id]) => id);
  const order: string[] = [];
  const placed = new Set<string>();
  while (avail.length) {
    avail.sort((a, b) => effDate(b) - effDate(a));
    const id = avail.shift()!;
    if (placed.has(id)) continue;
    placed.add(id);
    order.push(id);
    const p = parentOf.get(id);
    if (p && isNode(p) && waiting.has(p)) {
      waiting.set(p, waiting.get(p)! - 1);
      if (waiting.get(p)! <= 0 && !placed.has(p)) avail.push(p);
    }
  }
  for (const v of variants) if (isNode(v.id) && !placed.has(v.id)) order.push(v.id); // safety net (cycles)

  // rows
  const stonesOf = new Map<string, string[]>();
  for (const s of stones) {
    const p = parentOf.get(s);
    const host = p && isNode(p) ? p : root.id;
    stonesOf.set(host, [...(stonesOf.get(host) ?? []), s]);
  }
  const rows: SoilRow[] = [];
  let flip: Side = 1;
  let prevYear: number | null = null;
  const stoneRows = (host: string, ids: string[], below: boolean) => {
    const sorted = [...ids].sort((a, b) => (tOf(byId.get(b)!) ?? -Infinity) - (tOf(byId.get(a)!) ?? -Infinity));
    for (let i = 0; i < sorted.length; i += 2) {
      const pair = sorted.slice(i, i + 2);
      const items = pair.length === 2 ? [{ id: pair[0], side: -1 as Side }, { id: pair[1], side: 1 as Side }] : [{ id: pair[0], side: (-flip) as Side }];
      rows.push({ kind: "stones", parentId: host, items, below });
    }
  };
  for (const id of order) {
    const v = byId.get(id)!;
    if (v.isUserInput) {
      rows.push({ kind: "user", id });
      continue;
    }
    const y = yearOf(v);
    if (y !== null && prevYear !== null && prevYear - y >= 3) rows.push({ kind: "gap", key: `${id}`, years: prevYear - y });
    if (y !== null) prevYear = y;
    const mine = stonesOf.get(id) ?? [];
    const lowest = mine.filter((s) => s === earliestId && id === root.id);
    stoneRows(id, mine.filter((s) => !lowest.includes(s)), false);
    rows.push({ kind: "card", id, side: flip });
    flip = (-flip) as Side;
    if (lowest.length) stoneRows(id, lowest, true);
  }

  const strongOf = (e: LineageEdge) => (e.mutations ?? []).filter(isStrongMutation);
  const planEdges: PlanEdge[] = edges
    .filter((e) => real.has(`${e.from}>${e.to}`) && isNode(e.from) && isNode(e.to))
    .map((e) => ({ from: e.from, to: e.to, confidence: e.confidence, evidenceOnly: !!e.evidenceOnly, spreadJump: !!e.spreadJump, chips: strongOf(e).slice(0, 2).map((m) => ({ text: mutationChip(m), type: m.type })), weakCount: (e.mutations?.length ?? 0) - strongOf(e).length, changeNote: e.changeNote }));
  const stoneEdges = [...stones].map((s) => ({ from: parentOf.has(s) && isNode(parentOf.get(s)!) ? parentOf.get(s)! : root.id, to: s }));
  return { rows, lanes: Math.max(1, lanes), lane, edges: planEdges, stoneEdges, desc, rootId: root.id, userId: user?.id ?? null };
}

// ── geometry ────────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RootShape {
  key: string;
  fill: string; // closed tapering outline
  highlight: string; // lighter edge
  hairs: string; // small root hairs
  confidence: Confidence;
  spreadJump: boolean;
  tip: boolean;
  y0: number;
  y1: number;
}

export interface Connector {
  key: string;
  d: string;
  w: number;
  kind: "card" | "stone" | "stem";
}

export interface SoilGeometry {
  roots: RootShape[];
  connectors: Connector[];
  nodes: Map<string, { x: number; y: number }>;
  grassY: number;
  grass: string;
  strata: { d: string; i: number }[];
  pebbles: { x: number; y: number; rx: number; ry: number; rot: number }[];
  width: number;
  height: number;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const rng = (seed: string) => {
  let a = hash(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const f = (n: number) => n.toFixed(1);

/** Smooth closed/open path through points (quadratic through midpoints). */
function smooth(pts: [number, number][], moveFirst = true): string {
  if (pts.length < 3) return pts.map((p, i) => `${i === 0 && moveFirst ? "M" : "L"}${f(p[0])},${f(p[1])}`).join(" ");
  let d = moveFirst ? `M${f(pts[0][0])},${f(pts[0][1])}` : "";
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${f(pts[i][0])},${f(pts[i][1])} ${f(mx)},${f(my)}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${f(l[0])},${f(l[1])}`;
}

/** A filled, tapering, irregular root between two points (vertical growth), with a highlight edge and root hairs. */
export function rootShape(key: string, p0: [number, number], p1: [number, number], wTop: number, wBot: number, extra: { confidence?: Confidence; spreadJump?: boolean; tip?: boolean } = {}): RootShape & { pts: [number, number][] } {
  const r = rng(key);
  const dy = Math.max(12, p1[1] - p0[1]);
  const len = Math.hypot(p1[0] - p0[0], dy);
  const N = Math.max(10, Math.round(len / 9));
  const amp = Math.min(11, 3 + len / 40) * (0.6 + r() * 0.8);
  const fq = 1.1 + r() * 1.5;
  const ph = r() * Math.PI * 2;
  const fw = 2 + r() * 3;
  const pw = r() * Math.PI * 2;
  const c1: [number, number] = [p0[0], p0[1] + dy * 0.45];
  const c2: [number, number] = [p1[0], p1[1] - dy * 0.45];
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const x = u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0] + amp * Math.sin(Math.PI * 2 * (fq * t) + ph) * Math.sin(Math.PI * t);
    const y = u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1];
    pts.push([x, y]);
  }
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const hi: [number, number][] = [];
  const nrm: [number, number][] = [];
  const wAt: number[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(N, i + 1)];
    const dx = b[0] - a[0];
    const dyy = b[1] - a[1];
    const l = Math.hypot(dx, dyy) || 1;
    const nx = -dyy / l;
    const ny = dx / l;
    const t = i / N;
    const w = (wTop + (wBot - wTop) * t) * (1 + 0.1 * Math.sin(Math.PI * 2 * (fw * t) + pw)) * (extra.tip ? 1 - 0.85 * t * t : 1);
    nrm.push([nx, ny]);
    wAt.push(w);
    left.push([p[0] + (nx * w) / 2, p[1] + (ny * w) / 2]);
    right.push([p[0] - (nx * w) / 2, p[1] - (ny * w) / 2]);
    hi.push([p[0] + nx * w * 0.2, p[1] + ny * w * 0.2]);
  });
  const fill = `${smooth(left)} ${smooth([...right].reverse(), false)} Z`;
  const highlight = smooth(hi.slice(1, -1));
  let hairs = "";
  const step = Math.max(3, Math.round(34 / 9));
  for (let i = 2; i < N - 1; i += step + Math.floor(r() * 3)) {
    const side = r() < 0.5 ? 1 : -1;
    const b: [number, number] = [pts[i][0] + (nrm[i][0] * side * wAt[i]) / 2, pts[i][1] + (nrm[i][1] * side * wAt[i]) / 2];
    const l = 5 + r() * 7;
    const e: [number, number] = [b[0] + nrm[i][0] * side * l, b[1] + nrm[i][1] * side * l + 3 + r() * 4];
    hairs += `M${f(b[0])},${f(b[1])} Q${f((b[0] + e[0]) / 2 + side * 2)},${f((b[1] + e[1]) / 2 - 1)} ${f(e[0])},${f(e[1])} `;
  }
  return { key, fill, highlight, hairs, confidence: extra.confidence ?? "high", spreadJump: !!extra.spreadJump, tip: !!extra.tip, y0: p0[1], y1: p1[1], pts };
}

export interface GeometryInput {
  plan: SoilPlan;
  rects: Map<string, Rect>; // measured rows' items (cards, user, stones), in content coordinates
  width: number;
  height: number;
  strip: { x0: number; x1: number }; // where the roots live
  compact: boolean;
}

export function soilGeometry(inp: GeometryInput): SoilGeometry {
  const { plan, rects, width: W, height: H, strip, compact } = inp;
  const userRect = plan.userId ? rects.get(plan.userId) : undefined;
  const grassY = userRect ? userRect.y + userRect.h + 12 : 22;
  const sp = Math.min(34, Math.max(9, (strip.x1 - strip.x0 - 20) / Math.max(1, plan.lanes)));
  const cx = (strip.x0 + strip.x1) / 2;
  const laneX = (id: string) => cx + ((plan.lane.get(id) ?? 0) + 0.5 - plan.lanes / 2) * sp;
  const sideOf = new Map<string, Side>();
  for (const row of plan.rows) {
    if (row.kind === "card") sideOf.set(row.id, compact ? 1 : row.side);
    if (row.kind === "stones") for (const it of row.items) sideOf.set(it.id, compact ? 1 : it.side);
  }
  const nodes = new Map<string, { x: number; y: number }>();
  for (const [id, r] of rects) {
    if (id === plan.userId) nodes.set(id, { x: laneX(id), y: grassY + 6 });
    else if (plan.lane.has(id)) nodes.set(id, { x: laneX(id), y: r.y + Math.min(30, r.h / 2) });
  }
  const maxDesc = Math.max(1, plan.desc.get(plan.rootId ?? "") ?? 1);
  const wOf = (id: string) => 4 + 15 * Math.sqrt(((plan.desc.get(id) ?? 0) + 1) / (maxDesc + 1));
  const roots: RootShape[] = [];
  const centre = new Map<string, [number, number][]>(); // parent id → centre-lines of roots leaving it upward (for stones)
  const addCentre = (id: string, pts: [number, number][]) => centre.set(id, [...(centre.get(id) ?? []), ...pts]);
  for (const e of plan.edges) {
    const c = nodes.get(e.to);
    const p = nodes.get(e.from);
    if (!c || !p || p.y <= c.y) continue;
    const low = e.confidence === "low";
    const k = low ? 0.6 : e.confidence === "medium" ? 0.85 : 1;
    const s = rootShape(`${e.from}>${e.to}`, [c.x, c.y], [p.x, p.y], wOf(e.to) * k * 0.9, wOf(e.from) * k, { confidence: e.confidence, spreadJump: e.spreadJump });
    roots.push(s);
    addCentre(e.from, s.pts);
  }
  // the taproot: the deepest node continues as a tapering tip
  const rootNode = plan.rootId ? nodes.get(plan.rootId) : undefined;
  if (rootNode && plan.rootId) {
    const t = rootShape(`tip>${plan.rootId}`, [rootNode.x, rootNode.y], [rootNode.x + (hash(plan.rootId) % 2 ? 6 : -6), rootNode.y + 70], wOf(plan.rootId), 1, { tip: true });
    roots.push(t);
    addCentre(plan.rootId, t.pts);
  }
  const connectors: Connector[] = [];
  const near = (id: string, y: number): [number, number] => {
    const pts = centre.get(id) ?? [];
    let best: [number, number] | null = null;
    for (const q of pts) if (!best || Math.abs(q[1] - y) < Math.abs(best[1] - y)) best = q;
    const n = nodes.get(id);
    return best ?? (n ? [n.x, y] : [cx, y]);
  };
  for (const [id, r] of rects) {
    const n = nodes.get(id);
    if (!n || id === plan.userId) continue;
    const side = sideOf.get(id) ?? 1;
    const ex = side === 1 ? r.x : r.x + r.w;
    connectors.push({ key: `c-${id}`, d: `M${f(n.x)},${f(n.y)} Q${f((n.x + ex) / 2)},${f(n.y + 5)} ${f(ex)},${f(n.y)}`, w: 3, kind: "card" });
  }
  for (const se of plan.stoneEdges) {
    const r = rects.get(se.to);
    if (!r) continue;
    const side = sideOf.get(se.to) ?? 1;
    const y = r.y + r.h / 2;
    const [bx, by] = near(se.from, y);
    const ex = side === 1 ? r.x : r.x + r.w;
    connectors.push({ key: `s-${se.to}`, d: `M${f(bx)},${f(by)} Q${f((bx + ex) / 2)},${f(y + 7)} ${f(ex)},${f(y)}`, w: 2, kind: "stone" });
  }
  if (userRect && plan.userId) {
    const n = nodes.get(plan.userId)!;
    const ux = userRect.x + userRect.w / 2;
    connectors.push({ key: "stem", d: `M${f(ux)},${f(userRect.y + userRect.h)} Q${f(ux)},${f(grassY - 2)} ${f(n.x)},${f(n.y)}`, w: 3, kind: "stem" });
  }

  // soil: strata, grass, pebbles
  const r = rng("soil");
  const bands = 5;
  const top = grassY + 6;
  const strata: { d: string; i: number }[] = [];
  for (let i = 0; i < bands; i++) {
    const y0 = top + ((H - top) * i) / bands;
    const pts: [number, number][] = [];
    for (let x = 0; x <= W + 40; x += 40) pts.push([x, y0 + (i === 0 ? 0 : (r() - 0.5) * 16)]);
    strata.push({ d: `${smooth(pts)} L${f(W)},${f(H)} L0,${f(H)} Z`, i });
  }
  let grass = `M0,${f(grassY + 10)} L0,${f(grassY)}`;
  for (let x = 0; x <= W; x += 5) grass += ` L${f(x + 1.5)},${f(grassY - 3 - r() * 7)} L${f(x + 3.5)},${f(grassY + 1)}`;
  grass += ` L${f(W)},${f(grassY + 10)} Z`;
  const pebbles: SoilGeometry["pebbles"] = [];
  const n = Math.floor((H - top) / 120);
  for (let i = 0; i < n; i++) pebbles.push({ x: r() * W, y: top + 30 + r() * (H - top - 60), rx: 3 + r() * 5, ry: 2 + r() * 3.5, rot: r() * 180 });
  return { roots, connectors, nodes, grassY, grass, strata, pebbles, width: W, height: H };
}

/** "Snopes" from snopes.com, "Bbc" from bbc.co.uk; used for stone labels. */
export function siteName(host: string): string {
  const parts = host.replace(/^www\./, "").split(".");
  const label = parts.length > 2 && ["co", "com", "org", "gov", "ac"].includes(parts[parts.length - 2]) ? parts[parts.length - 3] : parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : host;
}
