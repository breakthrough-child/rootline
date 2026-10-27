import { describe, expect, it } from "vitest";
import { extractJson } from "@/lib/llm";
import { LineageSchema, MembershipSchema, MutationsSchema, ScreenshotSchema, UnderstandingSchema, VerdictSchema } from "@/lib/schemas";

describe("extractJson", () => {
  it("pulls JSON out of think blocks and code fences", () => {
    expect(extractJson('<think>hmm {"no":1}</think>\n```json\n{"a": [1, {"b": "}"}]}\n```')).toEqual({ a: [1, { b: "}" }] });
  });
  it("throws when there is no JSON", () => {
    expect(() => extractJson("sorry, I can't")).toThrow();
  });
});

describe("schemas", () => {
  it("UnderstandingSchema requires at least 2 queries", () => {
    expect(UnderstandingSchema.safeParse({ claim: "Schools close", queries: ["one"] }).success).toBe(false);
    const ok = UnderstandingSchema.parse({ claim: "Schools close", queries: ["a b", "c d"], call_to_action: "" });
    expect(ok.call_to_action).toBeNull();
    expect(ok.numbers).toEqual([]);
  });
  it("MembershipSchema coerces unknown page types to other", () => {
    expect(MembershipSchema.parse({ contains_version: true, excerpt: "x", page_type: "blog" }).page_type).toBe("other");
  });
  it("MutationsSchema maps unknown mutation types to other", () => {
    const m = MutationsSchema.parse({ mutations: [{ type: "number_inflated", before: 200, after: "2,000" }] });
    expect(m.mutations[0]).toMatchObject({ type: "other", before: "200", after: "2,000" });
  });
  it("LineageSchema validates confidence", () => {
    const l = LineageSchema.parse({ edges: [{ parent: "a", child: "b", confidence: "certain" }], earliest_id: "a" });
    expect(l.edges[0].confidence).toBe("low");
  });
  it("VerdictSchema rejects an empty reply card", () => {
    expect(VerdictSchema.safeParse({ summary: "A long enough summary.", reply_card: "" }).success).toBe(false);
  });
  it("ScreenshotSchema normalizes empty strings to null", () => {
    const s = ScreenshotSchema.parse({ platform: "twitter", handle: "  ", post_text: "hi" });
    expect(s.platform).toBe("unknown");
    expect(s.handle).toBeNull();
  });
});
