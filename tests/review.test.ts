// The Super review pass may keep / retype / drop labels, never add or edit them, and never bypass grounding checks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LineageEdge, Mutation, Variant } from "@/lib/types";

const v = (id: string, text: string): Variant => ({ id, text, excerpt: text, sources: [], date: null, dateProvenance: "unknown", pageType: "social" });
const EARLIER = "Please don't open the video. It will hack your phone.";
const LATER = "WARNING! Do not open the video. It will hack your phone. This was confirmed by CNN and BBC. Share this with everyone in Lagos.";
const m = (type: string, before: string, after: string): Mutation => ({ type: type as never, before, after, explanation: "" });
const edge = (muts: Mutation[]): LineageEdge => ({ from: "a", to: "b", confidence: "medium", reason: "", mutations: muts });

async function run(labels: Mutation[], reply: unknown | Error) {
  process.env.OFFLINE_MOCK = "false";
  process.env.LLM_API_KEY = "k";
  process.env.LLM_BASE_URL = "https://integrate.api.nvidia.com/v1";
  process.env.MODEL_SUPER = "super-model";
  process.env.LLM_RPM = "0";
  vi.resetModules();
  const fetchMock = vi.fn(async () => {
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { reviewMutations } = await import("@/lib/pipeline");
  const { RunContext } = await import("@/lib/llm");
  const out = await reviewMutations(new RunContext(), [v("a", EARLIER), v("b", LATER)], [edge(labels)], "k0");
  return { out, fetchMock, mutations: out.edges[0].mutations };
}

describe("reviewMutations", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const labels = () => [m("authority_added", "", "CNN and BBC"), m("urgency_added", "", "Share this with everyone"), m("location_changed", "", "Lagos"), m("emotional_framing_added", "", "WARNING!")];

  it("keeps, retypes and drops according to the reviewer", async () => {
    const { mutations, out } = await run(labels(), {
      labels: [
        { index: 0, verdict: "keep" },
        { index: 1, verdict: "retype", type: "call_to_action_added" }, // wrong type fixed
        { index: 2, verdict: "drop" },
        { index: 3, verdict: "keep" },
      ],
    });
    expect(mutations.map((x) => `${x.type}:${x.after}`)).toEqual(["authority_added:CNN and BBC", "call_to_action_added:Share this with everyone", "emotional_framing_added:WARNING!"]);
    expect(out.stats).toEqual({ reviewed: 4, kept: 2, retyped: 1, dropped: 1 });
  });

  it("cannot add labels: unknown indices and extra entries are ignored", async () => {
    const { mutations } = await run([m("authority_added", "", "CNN and BBC")], { labels: [{ index: 0, verdict: "keep" }, { index: 7, verdict: "keep", type: "number_changed" }, { index: -1, verdict: "retype", type: "other" }] });
    expect(mutations).toHaveLength(1);
  });

  it("a retype that fails the code-level type check is dropped, not trusted", async () => {
    // "Lagos" is not a number: retyping the location label to number_changed must fail validation.
    const { mutations, out } = await run([m("location_changed", "", "Lagos")], { labels: [{ index: 0, verdict: "retype", type: "number_changed" }] });
    expect(mutations).toEqual([]);
    expect(out.stats.dropped).toBe(1);
  });

  it("labels the reviewer did not mention are kept (it can only remove or retype what it names)", async () => {
    const { mutations } = await run(labels(), { labels: [{ index: 2, verdict: "drop" }] });
    expect(mutations).toHaveLength(3);
  });

  it("leaves labels untouched when the review call fails or is invalid", async () => {
    const failed = await run(labels(), new Error("boom"));
    expect(failed.mutations).toHaveLength(4);
    const garbage = await run(labels(), { nonsense: true });
    expect(garbage.mutations).toHaveLength(4);
  });

  it("makes no model call when there is nothing to review or no Super model", async () => {
    const none = await run([], { labels: [] });
    expect(none.fetchMock).not.toHaveBeenCalled();
    process.env.MODEL_SUPER = "";
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    const { reviewMutations } = await import("@/lib/pipeline");
    const { RunContext } = await import("@/lib/llm");
    const res = await reviewMutations(new RunContext(), [v("a", EARLIER), v("b", LATER)], [edge(labels())], "k0");
    expect(res.edges[0].mutations).toHaveLength(4);
    expect(fetch).not.toHaveBeenCalled();
  });
});
