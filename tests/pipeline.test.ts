// End-to-end pipeline test against the FICTIONAL offline corpus (no network, no keys).
import { beforeAll, describe, expect, it } from "vitest";
import type { Investigation } from "@/lib/types";

let inv: Investigation;
let corpus: { url: string; content: string }[];

beforeAll(async () => {
  process.env.OFFLINE_MOCK = "true";
  const { RunContext } = await import("@/lib/llm");
  const { investigate } = await import("@/lib/investigate");
  const { textToInput } = await import("@/lib/adapters/text");
  corpus = (await import("@/lib/mock/corpus")).MOCK_CORPUS;
  const input = textToInput(
    "URGENT: Men are offering free perfume samples at filling stations in Lekki and Abuja. You smell it and you faint immediately, then they kidnap you. 2,000 women missing this month. Police have confirmed and Dr. Ama Felix of Bluewater Teaching Hospital confirmed it. Forward to every woman you know!",
  );
  inv = await investigate(new RunContext(), input, [{ id: "k0", text: input.text }]);
});

describe("pipeline (offline mock)", () => {
  it("finds a family, not the unrelated shop article", () => {
    const c = inv.claims[0];
    expect(c.limited).toBe(false);
    expect(c.variants.length).toBeGreaterThanOrEqual(5);
    const urls = c.variants.flatMap((v) => v.sources.map((s) => s.url));
    expect(urls.some((u) => u.includes("shopwise-news"))).toBe(false);
  });
  it("on a sensitive topic (kidnapping) a forum post is never the earliest version: the earliest fact-check/news/official page is", () => {
    const c = inv.claims[0];
    const earliest = c.variants.find((v) => v.id === c.earliestId)!;
    // The 2017 forum post is a real (older) copy and stays in the tree, but is not presented as the earliest version.
    expect(c.variants.some((v) => v.date === "2017-03-14")).toBe(true);
    expect(["debunk", "news", "official"]).toContain(earliest.pageType);
    expect(earliest.date).toBe("2021-02-10");
    expect(c.edges).toHaveLength(c.variants.length - 1);
  });
  it("honesty: every excerpt is quoted verbatim from its source", () => {
    for (const v of inv.claims[0].variants)
      for (const s of v.sources) {
        if (s.pageType === "user_input") continue;
        const page = corpus.find((p) => p.url === s.url)!;
        expect(page.content).toContain(s.excerpt);
      }
  });
  it("labels mutations (number change, authority added) and produces a short reply card", () => {
    const c = inv.claims[0];
    const types = new Set(c.edges.flatMap((e) => e.mutations.map((m) => m.type)));
    expect(types.has("number_changed")).toBe(true);
    expect(types.has("authority_added")).toBe(true);
    expect(c.verdict.replyCard.split(/\s+/).length).toBeLessThan(60);
    expect(c.verdict.unsupported[0]?.sourceUrls[0]).toMatch(/factline|verifydesk|citypost/);
  });
  it("logs every step for the routing panel", () => {
    expect(inv.logs.length).toBeGreaterThan(5);
    expect(inv.mode).toBe("offline_mock");
  });
});

describe("copy-only mutation edges", () => {
  it("never labels changes on an edge that touches an evidence page without a clean quoted copy", () => {
    for (const e of inv.claims[0].edges) {
      const ends = [e.from, e.to].map((id) => inv.claims[0].variants.find((v) => v.id === id)!);
      if (ends.some((v) => v.isCopy === false)) {
        expect(e.mutations).toEqual([]);
        expect(e.evidenceOnly).toBe(true);
      }
    }
    // fact-check pages found by the offline heuristic have no clean quote, so they must be evidence pages
    expect(inv.claims[0].variants.filter((v) => v.pageType === "debunk").every((v) => v.isCopy === false)).toBe(true);
  });
});
