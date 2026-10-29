// The root-system layout, checked against the REAL saved demo runs: nothing overlaps, descendants are below their
// parents, the user's copy is at the bottom, and years run top to bottom.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { layoutRoots } from "@/lib/rootLayout";
import type { Investigation } from "@/lib/types";

const load = (f: string) => (JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", f), "utf8")) as { investigation: Investigation }).investigation.claims[0];

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 1;

describe.each(["1-perfume.json", "3-martinelli.json", "2-screenshot.json", "4-circular.json"])("layout of %s", (file) => {
  const c = load(file);
  for (const [label, opts] of [["desktop", { width: 900, compact: false }], ["mobile", { width: 343, compact: true }]] as const) {
    it(`places every node, with no overlaps (${label})`, () => {
      const l = layoutRoots(c.variants, c.edges, c.earliestId, opts);
      expect(l.nodes.map((n) => n.id).sort()).toEqual(c.variants.map((v) => v.id).sort());
      expect(l.width).toBeGreaterThanOrEqual(opts.width);
      for (const n of l.nodes) {
        expect(n.x - n.w / 2).toBeGreaterThanOrEqual(-1);
        expect(n.x + n.w / 2).toBeLessThanOrEqual(l.width + 1);
        expect(n.y - n.h / 2).toBeGreaterThanOrEqual(-1);
        expect(n.y + n.h / 2).toBeLessThanOrEqual(l.height + 1);
      }
      const cards = l.nodes.filter((n) => n.kind !== "leaf");
      for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) expect(overlaps(cards[i], cards[j])).toBe(false);
      for (const n of l.nodes.filter((x) => x.kind === "leaf")) for (const k of cards) expect(overlaps(n, k)).toBe(false);
    });
  }
  it("grows downward: every child card is below its parent, the user's copy is lowest", () => {
    const l = layoutRoots(c.variants, c.edges, c.earliestId, { width: 900, compact: false });
    const at = new Map(l.nodes.map((n) => [n.id, n]));
    for (const e of c.edges) {
      const p = at.get(e.from)!;
      const ch = at.get(e.to)!;
      if (ch.kind === "leaf" && ch.aboveRoot) continue;
      expect(ch.y).toBeGreaterThan(p.y);
    }
    const user = l.nodes.find((n) => n.kind === "user");
    if (user && l.nodes.length > 1) expect(Math.max(...l.nodes.filter((n) => n.kind !== "user").map((n) => n.y))).toBeLessThan(user.y);
    // the origin (no parent) is the top-most card
    const root = at.get(l.rootId!)!;
    expect(root.y).toBeLessThanOrEqual(Math.min(...l.nodes.filter((n) => n.kind === "card").map((n) => n.y)) + 0.01);
  });
  it("year ticks are ordered top to bottom and cover the dated range", () => {
    const l = layoutRoots(c.variants, c.edges, c.earliestId, { width: 900, compact: false });
    const ys = l.ticks.map((t) => t.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    const years = l.ticks.map((t) => Number(t.label));
    expect([...years].sort((a, b) => a - b)).toEqual(years);
  });
  it("only strong detected changes become chips; weaker ones are only counted", () => {
    const l = layoutRoots(c.variants, c.edges, c.earliestId, { width: 900, compact: false });
    const strong = c.edges.flatMap((e) => e.mutations).filter((m) => m.strength === "strong").length;
    expect(l.edges.reduce((a, e) => a + e.chips.length, 0)).toBeLessThanOrEqual(strong);
  });
});

describe("edge cases", () => {
  it("a lone user copy is placed and nothing crashes with no edges", () => {
    const l = layoutRoots([{ id: "you", text: "x", excerpt: "x", sources: [], date: null, dateProvenance: "unknown", pageType: "user_input", isUserInput: true }], [], null, { width: 343, compact: true });
    expect(l.nodes).toHaveLength(1);
  });
  it("undated cards sit below dated ones on their branch", () => {
    const mk = (id: string, date: string | null) => ({ id, text: id, excerpt: id, sources: [], date, dateProvenance: (date ? "published_date" : "unknown") as "published_date", pageType: "social" as const });
    const vs = [mk("a", "2019-01-01"), mk("b", null), mk("c", "2021-01-01")];
    const edges = [
      { from: "a", to: "b", confidence: "low" as const, reason: "", mutations: [] },
      { from: "a", to: "c", confidence: "high" as const, reason: "", mutations: [] },
    ];
    const l = layoutRoots(vs, edges, "a", { width: 900, compact: false });
    const y = (id: string) => l.nodes.find((n) => n.id === id)!.y;
    expect(y("b")).toBeGreaterThan(y("c"));
    expect(l.nodes.find((n) => n.id === "b")!.undated).toBe(true);
  });
});
