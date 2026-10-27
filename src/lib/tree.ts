// Variant deduplication and the algorithmic baseline lineage tree (pure, unit-tested).
import { relatedness } from "./text";
import type { Confidence, LineageEdge, SourceRef, Variant } from "./types";

export const DUPLICATE_THRESHOLD = 0.86;

function dateMs(d: string | null): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : t;
}

const PROVENANCE_RANK = { published_date: 0, page_metadata: 1, pdf_metadata_unverified: 2, from_screenshot_unverified: 3, unknown: 4 } as const;

/**
 * Merge near-identical variants into one node with multiple sources.
 * The merged node keeps the earliest dated source's excerpt and date.
 */
export function dedupeVariants(variants: Variant[], threshold = DUPLICATE_THRESHOLD): Variant[] {
  const out: Variant[] = [];
  for (const v of variants) {
    const match = out.find((o) => !o.isUserInput && !v.isUserInput && relatedness(o.text, v.text) >= threshold);
    if (!match) {
      out.push({ ...v, sources: [...v.sources] });
      continue;
    }
    const seen = new Set(match.sources.map((s) => s.url));
    for (const s of v.sources) if (!seen.has(s.url)) match.sources.push(s);
    const mt = dateMs(match.date);
    const vt = dateMs(v.date);
    if (vt !== null && (mt === null || vt < mt)) {
      match.date = v.date;
      match.dateProvenance = v.dateProvenance;
      match.excerpt = v.excerpt;
      match.text = v.text;
      match.pageType = v.pageType;
    }
  }
  for (const o of out) o.sources.sort(compareSources);
  return out;
}

function compareSources(a: SourceRef, b: SourceRef): number {
  const ta = dateMs(a.date) ?? Infinity;
  const tb = dateMs(b.date) ?? Infinity;
  if (ta !== tb) return ta - tb;
  return PROVENANCE_RANK[a.dateProvenance] - PROVENANCE_RANK[b.dateProvenance];
}

/** A parent may not be later than its child when both dates are known. */
export function edgeAllowed(parent: Variant, child: Variant): boolean {
  const p = dateMs(parent.date);
  const c = dateMs(child.date);
  if (p === null || c === null) return true;
  return p <= c;
}

export function distanceMatrix(variants: Variant[]): number[][] {
  const n = variants.length;
  const d: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const x = 1 - relatedness(variants[i].text, variants[j].text);
      d[i][j] = x;
      d[j][i] = x;
    }
  return d;
}

/** Root = earliest dated variant; if nothing is dated, the medoid (most central) variant. User input is never the root unless alone. */
export function pickRoot(variants: Variant[], dist: number[][]): number {
  let best = -1;
  let bestT = Infinity;
  variants.forEach((v, i) => {
    const t = dateMs(v.date);
    if (t !== null && t < bestT && !v.isUserInput) {
      bestT = t;
      best = i;
    }
  });
  if (best >= 0) return best;
  let bestSum = Infinity;
  variants.forEach((v, i) => {
    if (v.isUserInput && variants.length > 1) return;
    const s = dist[i].reduce((a, b) => a + b, 0);
    if (s < bestSum) {
      bestSum = s;
      best = i;
    }
  });
  return Math.max(best, 0);
}

export function confidenceFor(distance: number, parent: Variant, child: Variant): Confidence {
  const bothDated = dateMs(parent.date) !== null && dateMs(child.date) !== null;
  if (distance < 0.35 && bothDated) return "high";
  if (distance < 0.6) return "medium";
  return "low";
}

/**
 * Minimum spanning arborescence (Prim-style) on text distance, constrained so that a
 * parent is never later than its child when both dates are known. Always returns a tree
 * with n-1 edges for n >= 1 variants.
 */
export function baselineTree(variants: Variant[]): { rootId: string | null; edges: LineageEdge[] } {
  const n = variants.length;
  if (n === 0) return { rootId: null, edges: [] };
  const dist = distanceMatrix(variants);
  const root = pickRoot(variants, dist);
  const inTree = new Set([root]);
  const edges: LineageEdge[] = [];
  while (inTree.size < n) {
    let best: { u: number; v: number; d: number } | null = null;
    for (const u of inTree)
      for (let v = 0; v < n; v++) {
        if (inTree.has(v) || !edgeAllowed(variants[u], variants[v])) continue;
        // Prefer dated parents and earlier parents on ties.
        const d = dist[u][v];
        if (!best || d < best.d - 1e-9) best = { u, v, d };
      }
    if (!best) {
      // Only possible if a remaining node is dated earlier than every tree node (cannot happen
      // when root is the earliest dated node), but guard anyway: attach to root.
      const v = [...Array(n).keys()].find((i) => !inTree.has(i))!;
      best = { u: root, v, d: dist[root][v] };
    }
    inTree.add(best.v);
    const parent = variants[best.u];
    const child = variants[best.v];
    edges.push({
      from: parent.id,
      to: child.id,
      confidence: confidenceFor(best.d, parent, child),
      reason: `Closest earlier version by wording (similarity ${(1 - best.d).toFixed(2)}).`,
      mutations: [],
    });
  }
  return { rootId: variants[root].id, edges };
}

/** Validate a proposed parent assignment: ids exist, single root, no cycles, date constraint. */
export function validateTree(
  variants: Variant[],
  edges: { from: string; to: string }[],
): { ok: true } | { ok: false; reason: string } {
  const ids = new Map(variants.map((v) => [v.id, v]));
  const parent = new Map<string, string>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) return { ok: false, reason: `unknown node id in edge ${e.from}->${e.to}` };
    if (e.from === e.to) return { ok: false, reason: "self edge" };
    if (parent.has(e.to)) return { ok: false, reason: `node ${e.to} has two parents` };
    if (!edgeAllowed(ids.get(e.from)!, ids.get(e.to)!)) return { ok: false, reason: `parent ${e.from} is dated after child ${e.to}` };
    parent.set(e.to, e.from);
  }
  const roots = variants.filter((v) => !parent.has(v.id));
  if (roots.length !== 1) return { ok: false, reason: `expected 1 root, found ${roots.length}` };
  for (const v of variants) {
    const seen = new Set<string>();
    let cur: string | undefined = v.id;
    while (cur !== undefined) {
      if (seen.has(cur)) return { ok: false, reason: "cycle" };
      seen.add(cur);
      cur = parent.get(cur);
    }
  }
  return { ok: true };
}

/** Candidate pairs for mutation analysis: tree edges first, then nearest earlier neighbours, capped. */
export function candidatePairs(variants: Variant[], treeEdges: { from: string; to: string }[], cap: number, k = 2): [string, string][] {
  const key = (a: string, b: string) => `${a}|${b}`;
  const seen = new Set<string>();
  const out: [string, string][] = [];
  const push = (a: string, b: string) => {
    if (out.length >= cap || seen.has(key(a, b))) return;
    seen.add(key(a, b));
    out.push([a, b]);
  };
  for (const e of treeEdges) push(e.from, e.to);
  const dist = distanceMatrix(variants);
  variants.forEach((child, j) => {
    const cands = variants
      .map((p, i) => ({ i, d: dist[i][j] }))
      .filter(({ i }) => i !== j && edgeAllowed(variants[i], child))
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
    for (const c of cands) push(variants[c.i].id, child.id);
  });
  return out;
}

/** Mark edges where the child's subtree carries notably more sources than the parent alone (wider spread). */
export function markSpread(variants: Variant[], edges: LineageEdge[]): LineageEdge[] {
  const children = new Map<string, string[]>();
  for (const e of edges) children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
  const byId = new Map(variants.map((v) => [v.id, v]));
  const memo = new Map<string, number>();
  const subtree = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    const own = byId.get(id)?.isUserInput ? 0 : (byId.get(id)?.sources.length ?? 0);
    const total = own + (children.get(id) ?? []).reduce((a, c) => a + subtree(c), 0);
    memo.set(id, total);
    return total;
  };
  const totalSources = variants.reduce((a, v) => a + (v.isUserInput ? 0 : v.sources.length), 0);
  let bestIdx = -1;
  let bestScore = 0;
  edges.forEach((e, i) => {
    const s = subtree(e.to);
    const parentOwn = byId.get(e.from)?.sources.length ?? 0;
    const score = s - parentOwn;
    if (s >= 3 && s >= totalSources * 0.4 && score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });
  return edges.map((e, i) => ({ ...e, spreadJump: i === bestIdx }));
}

/** Time-ordered layout: x by date rank (undated nodes placed after their parent), y by DFS order. */
export function layoutTree(variants: Variant[], edges: { from: string; to: string }[], rootId: string | null) {
  const children = new Map<string, string[]>();
  for (const e of edges) children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
  const depth = new Map<string, number>();
  const order: string[] = [];
  const visit = (id: string, d: number) => {
    if (depth.has(id)) return;
    depth.set(id, d);
    order.push(id);
    const kids = (children.get(id) ?? []).slice().sort((a, b) => {
      const va = variants.find((v) => v.id === a)!;
      const vb = variants.find((v) => v.id === b)!;
      return (dateMs(va.date) ?? Infinity) - (dateMs(vb.date) ?? Infinity);
    });
    for (const k of kids) visit(k, d + 1);
  };
  if (rootId) visit(rootId, 0);
  for (const v of variants) visit(v.id, 0);
  // y: leaves get sequential rows; parents centered over children
  const rows = new Map<string, number>();
  let next = 0;
  const place = (id: string): number => {
    const kids = children.get(id) ?? [];
    if (!kids.length) {
      rows.set(id, next++);
      return rows.get(id)!;
    }
    const ys = kids.map(place);
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    rows.set(id, y);
    return y;
  };
  if (rootId) place(rootId);
  for (const v of variants) if (!rows.has(v.id)) place(v.id);
  return variants.map((v) => ({ id: v.id, col: depth.get(v.id) ?? 0, row: rows.get(v.id) ?? 0 }));
}
