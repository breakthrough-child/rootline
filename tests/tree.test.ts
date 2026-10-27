import { describe, expect, it } from "vitest";
import { baselineTree, candidatePairs, dedupeVariants, markSpread, validateTree } from "@/lib/tree";
import type { Variant } from "@/lib/types";

const v = (id: string, text: string, date: string | null, extra: Partial<Variant> = {}): Variant => ({
  id,
  text,
  excerpt: text,
  sources: [{ url: `https://x.example/${id}`, title: id, excerpt: text, pageType: "social", date, dateProvenance: date ? "published_date" : "unknown" }],
  date,
  dateProvenance: date ? "published_date" : "unknown",
  pageType: "social",
  ...extra,
});

const A = v("a", "Men offer free perfume samples in Ibadan. You smell it and feel dizzy.", "2018-01-01");
const B = v("b", "Men offer free perfume samples in Lagos. You smell it and faint. 200 women missing.", "2019-01-01");
const C = v("c", "Men offer free perfume samples in Lagos and Abuja. You smell it and faint. 2,000 women missing. Police confirmed.", "2020-01-01");
const D = v("d", "Men offer free perfume samples in Lagos and Abuja. You smell it and faint. 2,000 women missing. Police confirmed. Forward!", null);

describe("dedupeVariants", () => {
  it("merges near-identical variants into one node with multiple sources, keeping the earliest date", () => {
    const dup = v("c2", "Men offer free perfume samples in Lagos and Abuja. You smell it and faint. 2,000 women missing. Police confirmed!", "2019-06-01");
    const out = dedupeVariants([C, dup, A]);
    expect(out).toHaveLength(2);
    const merged = out.find((x) => x.sources.length === 2)!;
    expect(merged.date).toBe("2019-06-01");
    expect(merged.sources.map((s) => s.url)).toEqual(["https://x.example/c2", "https://x.example/c"]);
  });
  it("never merges the user's copy", () => {
    const you = { ...C, id: "you", isUserInput: true };
    expect(dedupeVariants([C, you])).toHaveLength(2);
  });
});

describe("baselineTree", () => {
  it("roots at the earliest dated version and produces n-1 edges", () => {
    const { rootId, edges } = baselineTree([C, A, D, B]);
    expect(rootId).toBe("a");
    expect(edges).toHaveLength(3);
    expect(validateTree([A, B, C, D], edges).ok).toBe(true);
  });
  it("never makes a parent later than its child when both are dated", () => {
    // B' is textually closest to C but dated AFTER C; it must not become C's parent.
    const Blate = v("blate", C.text.replace("Police confirmed.", "Police confirmed!!"), "2021-01-01");
    const { edges } = baselineTree([A, C, Blate]);
    for (const e of edges) {
      const p = [A, C, Blate].find((x) => x.id === e.from)!;
      const ch = [A, C, Blate].find((x) => x.id === e.to)!;
      expect(Date.parse(p.date!) <= Date.parse(ch.date!)).toBe(true);
    }
  });
  it("handles all-undated input by picking a central root", () => {
    const xs = [v("p", "one two three four five", null), v("q", "one two three four six", null), v("r", "one two three seven eight", null)];
    const { rootId, edges } = baselineTree(xs);
    expect(rootId).toBeTruthy();
    expect(edges).toHaveLength(2);
  });
  it("handles a single node", () => {
    expect(baselineTree([A])).toEqual({ rootId: "a", edges: [] });
  });
});

describe("validateTree", () => {
  it("rejects unknown ids, two parents, cycles and date violations", () => {
    expect(validateTree([A, B], [{ from: "a", to: "zzz" }]).ok).toBe(false);
    expect(validateTree([A, B, C], [{ from: "a", to: "c" }, { from: "b", to: "c" }]).ok).toBe(false);
    expect(validateTree([A, B], [{ from: "b", to: "a" }]).ok).toBe(false); // date violation
    const u1 = v("u1", "x", null);
    const u2 = v("u2", "y", null);
    expect(validateTree([u1, u2], [{ from: "u1", to: "u2" }, { from: "u2", to: "u1" }]).ok).toBe(false);
  });
});

describe("candidatePairs + spread", () => {
  it("includes tree edges first and respects the cap", () => {
    const { edges } = baselineTree([A, B, C, D]);
    const pairs = candidatePairs([A, B, C, D], edges, 4);
    expect(pairs).toHaveLength(4);
    expect(pairs.slice(0, 3)).toEqual(edges.map((e) => [e.from, e.to]));
  });
  it("flags at most one spread jump", () => {
    const many = { ...C, sources: [...C.sources, ...[1, 2, 3].map((i) => ({ ...C.sources[0], url: `https://x.example/c${i}` }))] };
    const vs = [A, B, many, D];
    const { edges } = baselineTree(vs);
    const marked = markSpread(vs, edges);
    expect(marked.filter((e) => e.spreadJump).length).toBe(1);
  });
});

describe("user copy", () => {
  it("is always a leaf", () => {
    const you = { ...A, id: "you", isUserInput: true, date: null, dateProvenance: "unknown" as const };
    const { edges } = baselineTree([you, A, B, C]);
    expect(edges.some((e) => e.from === "you")).toBe(false);
    expect(validateTree([you, A, B, C], [{ from: "you", to: "a" }, { from: "a", to: "b" }, { from: "b", to: "c" }]).ok).toBe(false);
  });
});
