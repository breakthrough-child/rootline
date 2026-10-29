// Layout engine for the "root system" lineage view: a top-down, date-scaled tree.
// Pure and deterministic (unit-tested against the real fixtures). No data is changed: this only decides where things go.
//
//   • the root (origin) is at the top, descendants grow downward, y follows date (monotone, with minimum spacing);
//   • copies of the message are cards; evidence pages (fact-checks without a clean quoted copy) are small leaf markers
//     that sprout from their copy's branch; the user's copy sits at the bottom;
//   • branches are tapering ribbons whose thickness reflects how many descendants they carry.
import { mutationChip } from "./heuristics";
import type { Confidence, LineageEdge, Mutation, Variant } from "./types";

export interface LayoutOptions {
  /** Available width in px (the container). The layout may need more (see `minWidth`) and then the view scales to fit. */
  width: number;
  compact: boolean;
}

export type NodeKind = "card" | "leaf" | "user";

export interface PlacedNode {
  id: string;
  kind: NodeKind;
  x: number; // centre
  y: number; // centre
  w: number;
  h: number;
  undated: boolean;
  side?: 1 | -1; // leaves: which side of the branch
  aboveRoot?: boolean; // the earliest evidence page sits above the root card
}

export interface PlacedEdge {
  from: string;
  to: string;
  kind: "branch" | "twig";
  ribbon: string; // closed SVG path (tapering ribbon)
  center: string; // centre-line SVG path
  mid: { x: number; y: number };
  confidence: Confidence;
  evidenceOnly: boolean;
  spreadJump: boolean;
  chips: { text: string; type: Mutation["type"] }[]; // strong detected changes only
  weakCount: number;
  width0: number;
  width1: number;
}

export interface Tick {
  label: string;
  y: number;
}

export interface RootLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  ticks: Tick[];
  width: number; // logical width actually used (>= opts.width)
  height: number;
  minWidth: number;
  rootId: string | null;
}

const dateMs = (d: string | null) => {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : t;
};

export const isStrongMutation = (m: Mutation) => m.strength === "strong" || (m.strength === undefined && !["detail_added", "detail_removed", "other"].includes(m.type));

/** Which nodes are drawn as leaf markers: evidence pages with no children, when real copies exist. */
export function leafIds(variants: Variant[], edges: { from: string; to: string }[]): Set<string> {
  const hasCopy = variants.some((v) => !v.isUserInput && v.isCopy !== false);
  const hasChild = new Set(edges.map((e) => e.from));
  return new Set(hasCopy ? variants.filter((v) => !v.isUserInput && v.isCopy === false && !hasChild.has(v.id)).map((v) => v.id) : []);
}

/** Taper ribbon around a cubic Bézier: width goes from w0 at the start to w1 at the end. */
function ribbon(p0: [number, number], c1: [number, number], c2: [number, number], p1: [number, number], w0: number, w1: number): { d: string; center: string; mid: { x: number; y: number } } {
  const N = 28;
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    pts.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]]);
  }
  const left: string[] = [];
  const right: string[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(N, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const w = (w0 + (w1 - w0) * (i / N)) / 2;
    left.push(`${(p[0] + nx * w).toFixed(1)},${(p[1] + ny * w).toFixed(1)}`);
    right.push(`${(p[0] - nx * w).toFixed(1)},${(p[1] - ny * w).toFixed(1)}`);
  });
  const d = `M${left.join(" L")} L${right.reverse().join(" L")} Z`;
  const center = `M${p0[0].toFixed(1)},${p0[1].toFixed(1)} C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}`;
  const m = pts[Math.round(N / 2)];
  return { d, center, mid: { x: m[0], y: m[1] } };
}

/** Point on the cubic centre-line at the sample whose y is closest to `y`. */
function pointAtY(p0: [number, number], c1: [number, number], c2: [number, number], p1: [number, number], y: number): [number, number] {
  let best: [number, number] = p0;
  let bd = Infinity;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const u = 1 - t;
    const x = u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0];
    const yy = u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1];
    if (Math.abs(yy - y) < bd) {
      bd = Math.abs(yy - y);
      best = [x, yy];
    }
  }
  return best;
}

export function layoutRoots(variants: Variant[], edgesIn: LineageEdge[], earliestId: string | null, opts: LayoutOptions): RootLayout {
  const compact = opts.compact;
  const cardW = compact ? 150 : 196;
  const cardH = compact ? 58 : 66;
  const gapY = cardH + (compact ? 34 : 40);
  const gutter = compact ? 36 : 54;
  const padTop = 28;
  const leafR = 11;
  const sideMargin = 12;
  const byId = new Map(variants.map((v) => [v.id, v]));
  if (!variants.length) return { nodes: [], edges: [], ticks: [], width: opts.width, height: 120, minWidth: opts.width, rootId: null };

  // ── structure: parents/children, virtual edges when no lineage exists yet ──
  let edges = edgesIn.filter((e) => byId.has(e.from) && byId.has(e.to));
  const hasParent = new Set(edges.map((e) => e.to));
  const nonUser = variants.filter((v) => !v.isUserInput);
  const dateOf = (v: Variant) => dateMs(v.date);
  const earliest = [...nonUser].sort((a, b) => (dateOf(a) ?? Infinity) - (dateOf(b) ?? Infinity))[0];
  const root = variants.find((v) => !hasParent.has(v.id) && !v.isUserInput) ?? earliest ?? variants[0];
  const virtual = new Set<string>();
  // Any node without a parent (other than the root): attach it virtually so it still has a place (not drawn as a branch).
  for (const v of variants) {
    if (v.id !== root.id && !edges.some((e) => e.to === v.id)) {
      const parent = v.isUserInput && nonUser.length ? nonUser[nonUser.length - 1] : root;
      if (parent && parent.id !== v.id) {
        edges = [...edges, { from: parent.id, to: v.id, confidence: "low", reason: "", mutations: [] }];
        virtual.add(`${parent.id}>${v.id}`);
      }
    }
  }
  const children = new Map<string, string[]>();
  for (const e of edges) children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
  const leaves = leafIds(variants, edges);
  const user = variants.find((v) => v.isUserInput);
  const isCard = (id: string) => !leaves.has(id) && id !== user?.id;
  const sortKids = (ids: string[]) => [...ids].sort((a, b) => (dateMs(byId.get(a)!.date) ?? Infinity) - (dateMs(byId.get(b)!.date) ?? Infinity));
  const cardKids = (id: string) => sortKids((children.get(id) ?? []).filter(isCard));
  const leafKids = (id: string) => (children.get(id) ?? []).filter((c) => leaves.has(c));

  // descendants (all types) → branch thickness
  const desc = new Map<string, number>();
  const countDesc = (id: string): number => {
    if (desc.has(id)) return desc.get(id)!;
    desc.set(id, 0);
    const n = (children.get(id) ?? []).reduce((a, c) => a + 1 + countDesc(c), 0);
    desc.set(id, n);
    return n;
  };
  countDesc(root.id);
  const maxDesc = Math.max(1, ...[...desc.values()]);
  const thick = (id: string) => 2.2 + 9.5 * Math.sqrt((desc.get(id) ?? 0) / maxDesc);

  // ── x: tidy placement, one lane per card-leaf ──
  let lanes = 0;
  const xLane = new Map<string, number>();
  const seen = new Set<string>();
  const assign = (id: string): number => {
    seen.add(id);
    const kids = cardKids(id).filter((k) => !seen.has(k));
    if (!kids.length) {
      xLane.set(id, lanes++);
      return xLane.get(id)!;
    }
    const xs = kids.map(assign);
    const m = (Math.min(...xs) + Math.max(...xs)) / 2;
    xLane.set(id, m);
    return m;
  };
  if (isCard(root.id)) assign(root.id);
  else xLane.set(root.id, lanes++);
  const L = Math.max(1, lanes);
  const laneMin = cardW + 56; // room for leaf markers either side of a card
  const minWidth = gutter + sideMargin * 2 + L * laneMin;
  const W = Math.max(opts.width, minWidth);
  const laneW = (W - gutter - sideMargin * 2) / L;
  const xOf = (id: string) => gutter + sideMargin + ((xLane.get(id) ?? 0) + 0.5) * laneW;

  // ── y: by date, monotone, with minimum spacing ──
  // The year scale is anchored on the cards (copies); evidence leaves may fall after its end but never define its start.
  const cardTimes = nonUser.filter((v) => !leaves.has(v.id)).map((v) => dateOf(v)).filter((t): t is number => t !== null);
  const leafTimes = nonUser.filter((v) => leaves.has(v.id)).map((v) => dateOf(v)).filter((t): t is number => t !== null);
  const times = cardTimes.length ? cardTimes : leafTimes;
  const tmin = times.length ? Math.min(...times) : 0;
  const tmax = times.length ? Math.max(...times, ...leafTimes.filter((t) => t >= tmin)) : 0;
  const cardsAll = variants.filter((v) => isCard(v.id));
  const datedCards = cardsAll.filter((v) => dateOf(v) !== null);
  const span = Math.max(380, datedCards.length * (cardH + 34));
  const earliestLeaf = earliestId && leaves.has(earliestId) ? byId.get(earliestId)! : null;
  const rootDate = dateOf(root);
  // The earliest page is drawn above the root only when it is an evidence page that hangs directly from the root.
  const aboveRoot = !!earliestLeaf && edges.some((e) => e.to === earliestLeaf.id && e.from === root.id) && (dateOf(earliestLeaf) ?? Infinity) < (rootDate ?? Infinity);
  const top = padTop + cardH / 2 + (aboveRoot ? 64 : 0); // centre of the root card
  const rawY = (t: number) => top + (tmax === tmin ? 0 : ((t - tmin) / (tmax - tmin)) * span);

  const placed: { id: string; x: number; y: number }[] = [];
  const pos = new Map<string, { x: number; y: number }>();
  const conflicts = (x: number, y: number) => placed.some((p) => Math.abs(p.x - x) < cardW + 10 && Math.abs(p.y - y) < cardH + 18);
  const place = (v: Variant, y0: number) => {
    const x = xOf(v.id);
    let y = y0;
    let guard = 0;
    while (conflicts(x, y) && guard++ < 200) y += 10;
    pos.set(v.id, { x, y });
    placed.push({ id: v.id, x, y });
  };
  const parentOf = new Map(edges.map((e) => [e.to, e.from]));
  // root first, always at the top
  place(root, isCard(root.id) ? top : top);
  // dated cards in date order (parents are never later than children for copies)
  for (const v of [...datedCards].sort((a, b) => dateOf(a)! - dateOf(b)!)) {
    if (v.id === root.id) continue;
    const p = pos.get(parentOf.get(v.id) ?? "");
    place(v, Math.max(rawY(dateOf(v)!), p ? p.y + gapY : top + gapY));
  }
  // undated cards: at the bottom of their branch
  const branchMax = (id: string): number => Math.max(pos.get(id)?.y ?? 0, ...cardKids(id).map(branchMax));
  const undatedCards = cardsAll.filter((v) => dateOf(v) === null && v.id !== root.id);
  const order: string[] = [];
  const dfs = (id: string) => {
    for (const k of cardKids(id)) {
      order.push(k);
      dfs(k);
    }
  };
  dfs(root.id);
  for (const id of order) {
    const v = byId.get(id)!;
    if (dateOf(v) !== null || pos.has(id) || !undatedCards.includes(v)) continue;
    const p = pos.get(parentOf.get(id) ?? "") ?? { x: 0, y: top };
    place(v, Math.max(p.y + gapY, branchMax(parentOf.get(id) ?? root.id) + gapY));
  }
  for (const v of cardsAll) if (!pos.has(v.id)) place(v, Math.max(...placed.map((p) => p.y)) + gapY); // safety net

  // ── year scale: monotone envelope through the card anchors ──
  const anchors = datedCards
    .map((v) => ({ t: dateOf(v)!, y: pos.get(v.id)!.y }))
    .sort((a, b) => a.t - b.t);
  for (let i = 1; i < anchors.length; i++) anchors[i].y = Math.max(anchors[i].y, anchors[i - 1].y);
  const yOfDate = (t: number): number => {
    if (!anchors.length) return rawY(t);
    if (t <= anchors[0].t) return anchors[0].y - (rawY(anchors[0].t) - rawY(t));
    const last = anchors[anchors.length - 1];
    if (t >= last.t) return last.y + (rawY(t) - rawY(last.t));
    for (let i = 1; i < anchors.length; i++) {
      if (t <= anchors[i].t) {
        const a = anchors[i - 1];
        const b = anchors[i];
        return b.t === a.t ? b.y : a.y + ((t - a.t) / (b.t - a.t)) * (b.y - a.y);
      }
    }
    return last.y;
  };

  // ── leaf markers: sprout from the parent's branch at their date ──
  const leafPos = new Map<string, { x: number; y: number; side: 1 | -1; above: boolean }>();
  const edgeGeom = new Map<string, { p0: [number, number]; c1: [number, number]; c2: [number, number]; p1: [number, number] }>();
  const geom = (from: string, to: string) => {
    const a = pos.get(from)!;
    const b = pos.get(to)!;
    const p0: [number, number] = [a.x, a.y + cardH / 2];
    const p1: [number, number] = [b.x, b.y - cardH / 2];
    const dy = Math.max(20, p1[1] - p0[1]);
    const dx = p1[0] - p0[0];
    return { p0, c1: [p0[0] + dx * 0.12, p0[1] + dy * 0.58] as [number, number], c2: [p1[0] - dx * 0.12, p1[1] - dy * 0.5] as [number, number], p1 };
  };
  for (const e of edges) if (isCard(e.from) && isCard(e.to)) edgeGeom.set(`${e.from}>${e.to}`, geom(e.from, e.to));
  for (const p of [...pos.keys()]) {
    const ls = leafKids(p).sort((a, b) => (dateMs(byId.get(a)!.date) ?? Infinity) - (dateMs(byId.get(b)!.date) ?? Infinity));
    if (!ls.length) continue;
    const pp = pos.get(p)!;
    const minY = pp.y + cardH / 2 + 22;
    const lastY: Record<string, number> = { "1": minY - 26, "-1": minY - 26 };
    // the branch the leaves grow along: the first card child's branch, else a straight tail
    const firstKid = cardKids(p)[0];
    const along = firstKid ? edgeGeom.get(`${p}>${firstKid}`) : undefined;
    ls.forEach((id, i) => {
      const v = byId.get(id)!;
      const t = dateOf(v);
      const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
      if (aboveRoot && id === earliestLeaf?.id && p === root.id) {
        leafPos.set(id, { x: pp.x + 0, y: padTop + 12, side: 1, above: true });
        return;
      }
      let y = t !== null ? Math.max(minY, yOfDate(t)) : lastY["1"] + 26;
      y = Math.max(y, lastY[String(side)] + 24);
      lastY[String(side)] = y;
      const bx = along ? pointAtY(along.p0, along.c1, along.c2, along.p1, y)[0] : pp.x;
      leafPos.set(id, { x: bx + side * (cardW / 2 + 14 + (i % 3) * 4), y, side, above: false });
    });
  }

  // ── user's copy at the bottom ──
  const allY = [...[...pos.values()].map((p) => p.y + cardH / 2), ...[...leafPos.values()].map((p) => p.y + leafR)];
  const bottom = Math.max(...allY, top + cardH);
  let userPos: { x: number; y: number } | null = null;
  if (user) {
    userPos = { x: (gutter + sideMargin + (W - sideMargin)) / 2, y: bottom + (aboveRoot || nonUser.length ? 54 : 0) + cardH / 2 };
    if (!nonUser.length) userPos = { x: (gutter + W) / 2, y: top + cardH / 2 };
    pos.set(user.id, userPos);
  }
  const height = Math.max(...[...pos.values()].map((p) => p.y + cardH / 2), ...[...leafPos.values()].map((p) => p.y + leafR)) + 36;

  // ── edges ──
  const outEdges: PlacedEdge[] = [];
  const strongOf = (e: LineageEdge) => (e.mutations ?? []).filter(isStrongMutation);
  for (const e of edges) {
    const key = `${e.from}>${e.to}`;
    if (virtual.has(key)) continue; // no lineage yet: nodes are placed but no branch is claimed
    const strong = strongOf(e);
    const base = { from: e.from, to: e.to, confidence: e.confidence, evidenceOnly: !!e.evidenceOnly, spreadJump: !!e.spreadJump, chips: strong.slice(0, 2).map((m) => ({ text: mutationChip(m), type: m.type })), weakCount: (e.mutations?.length ?? 0) - strong.length };
    if (leaves.has(e.to)) {
      const lp = leafPos.get(e.to);
      const pp = pos.get(e.from);
      if (!lp || !pp) continue;
      const firstKid = cardKids(e.from)[0];
      const along = firstKid ? edgeGeom.get(`${e.from}>${firstKid}`) : undefined;
      const start: [number, number] = along ? pointAtY(along.p0, along.c1, along.c2, along.p1, lp.y) : lp.above ? [pp.x, pp.y - cardH / 2] : [pp.x, lp.y];
      const end: [number, number] = [lp.x - lp.side * (leafR - 2), lp.y];
      const c1: [number, number] = [start[0] + (end[0] - start[0]) * 0.5, start[1] - 2];
      const c2: [number, number] = [end[0] - (end[0] - start[0]) * 0.2, end[1] - 4];
      const r = ribbon(start, c1, c2, end, 2, 1);
      outEdges.push({ ...base, kind: "twig", ribbon: r.d, center: r.center, mid: r.mid, width0: 2, width1: 1 });
      continue;
    }
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const toUser = e.to === user?.id;
    const g = toUser
      ? (() => {
          const p0: [number, number] = [a.x, a.y + cardH / 2];
          const p1: [number, number] = [b.x, b.y - cardH / 2 - 16];
          const dy = Math.max(20, p1[1] - p0[1]);
          return { p0, c1: [p0[0], p0[1] + dy * 0.55] as [number, number], c2: [p1[0], p1[1] - dy * 0.45] as [number, number], p1 };
        })()
      : edgeGeom.get(key) ?? geom(e.from, e.to);
    const wChild = thick(e.to);
    const r = ribbon(g.p0, g.c1, g.c2, g.p1, wChild * 1.2, Math.max(1.6, wChild * 0.7));
    outEdges.push({ ...base, kind: "branch", ribbon: r.d, center: r.center, mid: r.mid, width0: wChild * 1.2, width1: Math.max(1.6, wChild * 0.7) });
  }

  // ── nodes ──
  const nodes: PlacedNode[] = [];
  for (const v of variants) {
    if (leaves.has(v.id)) {
      const lp = leafPos.get(v.id);
      if (lp) nodes.push({ id: v.id, kind: "leaf", x: lp.x, y: lp.y, w: leafR * 2, h: leafR * 2, undated: dateOf(v) === null, side: lp.side, aboveRoot: lp.above });
      continue;
    }
    const p = pos.get(v.id);
    if (p) nodes.push({ id: v.id, kind: v.isUserInput ? "user" : "card", x: p.x, y: p.y, w: cardW, h: cardH, undated: dateOf(v) === null });
  }

  // ── year ticks ──
  const ticks: Tick[] = [];
  if (times.length) {
    const y0 = new Date(tmin).getUTCFullYear();
    const y1 = new Date(tmax).getUTCFullYear();
    const yrs = y1 - y0;
    const step = yrs <= 6 ? 1 : yrs <= 14 ? 2 : yrs <= 30 ? 5 : 10;
    const years = new Set<number>([y0, y1]);
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) years.add(y);
    let lastY = -Infinity;
    for (const y of [...years].sort((a, b) => a - b)) {
      const ty = yOfDate(Date.UTC(y, y === y0 ? new Date(tmin).getUTCMonth() : 0, 1));
      if (ty - lastY < 22) continue;
      ticks.push({ label: String(y), y: ty });
      lastY = ty;
    }
  }
  return { nodes, edges: outEdges, ticks, width: W, height, minWidth, rootId: root.id };
}
