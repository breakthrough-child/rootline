// General statements about current events: classified, reported neutrally, never traced or doubted.
import { afterEach, describe, expect, it, vi } from "vitest";
import { chainMarkers, generalVerdict, GENERAL_LEAD, heuristicKind, isSensitiveText, summaryIsGrounded } from "@/lib/general";
import { speaksTo } from "@/lib/text";
import { textToInput } from "@/lib/adapters/text";

const FULANI = "Fulani herdsmen are clashing with farmers in Nigeria and it is causing deaths, displacement and food shortages in several states.";
const PERFUME = "Please be careful ladies!!! Some men are standing at filling stations and malls giving women free perfume samples. Once you smell it you will faint and they will kidnap you. Please share this with every woman you know.";
const MARTINELLI = "WARNING! If you receive a video called MARTINELLI do not open it. It is a virus that will hack your phone. This has been confirmed by CNN and BBC. Please pass this to everyone in your contact list.";
const GRANT = "Good news! The Federal Government is giving N30,000 to every Nigerian. Click the link below to register. Share this message to 10 WhatsApp groups to qualify. Hurry, registration closes Friday!";

describe("classification heuristics", () => {
  it("plain news-style statements are general; chain forwards, hoax warnings and scam offers are messages", () => {
    expect(heuristicKind(FULANI)).toBe("general_statement");
    for (const m of [PERFUME, MARTINELLI, GRANT]) expect(heuristicKind(m)).toBe("circulating_message");
    expect(chainMarkers(FULANI)).toEqual({ strong: false, count: 0 });
    expect(chainMarkers(PERFUME).strong).toBe(true);
  });
  it("flags sensitive topics (ethnic, religious, conflict, security) and not neutral ones", () => {
    expect(isSensitiveText(FULANI)).toBe(true);
    expect(isSensitiveText("Boko Haram attacked a village")).toBe(true);
    expect(isSensitiveText("The Federal Government is giving N30,000 palliative to households")).toBe(false);
  });
});

describe("classifyInput", () => {
  afterEach(() => vi.unstubAllGlobals());
  async function classify(text: string, modelSays: unknown, kind: "text" | "image" = "text") {
    process.env.OFFLINE_MOCK = "false";
    process.env.LLM_API_KEY = "k";
    process.env.LLM_BASE_URL = "https://integrate.api.nvidia.com/v1";
    process.env.MODEL_NANO = "nano";
    process.env.LLM_RPM = "0";
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelSays) } }], usage: {} }), { status: 200 })));
    const { classifyInput } = await import("@/lib/general");
    const { RunContext } = await import("@/lib/llm");
    const input = { ...textToInput(text), sourceKind: kind } as ReturnType<typeof textToInput>;
    return classifyInput(new RunContext(), text, input);
  }
  it("trusts the model for plain text, but a chain-forward marker always wins (real forwards are never downgraded)", async () => {
    expect((await classify(FULANI, { input_kind: "general_statement", sensitive: true, news_queries: ["Nigeria farmer herder conflict"] })).kind).toBe("general_statement");
    expect((await classify(PERFUME, { input_kind: "general_statement", sensitive: false, news_queries: [] })).kind).toBe("circulating_message");
    expect((await classify(MARTINELLI, { input_kind: "general_statement" })).kind).toBe("circulating_message");
  });
  it("screenshots and documents are always treated as messages", async () => {
    expect((await classify(FULANI, { input_kind: "general_statement" }, "image")).kind).toBe("circulating_message");
  });
  it("sensitivity comes from the model OR the words", async () => {
    const c = await classify(FULANI, { input_kind: "general_statement", sensitive: false });
    expect(c.sensitive).toBe(true);
  });
});

describe("neutral general verdict", () => {
  const reports = [
    { url: "https://www.bbc.com/x", title: "t", publisher: "bbc.com", kind: "news" as const, date: "2026-03-22", dateProvenance: "published_date" as const, summary: "bbc.com reports that 52 people were killed.", excerpt: "" },
    { url: "https://dw.com/y", title: "t", publisher: "dw.com", kind: "news" as const, date: null, dateProvenance: "unknown" as const, summary: "dw.com reports…", excerpt: "" },
  ];
  it("uses the required lead text, lists sources and never suggests doubt", () => {
    const v = generalVerdict(reports);
    expect(v.summary).toBe(GENERAL_LEAD);
    expect(v.unsupported).toEqual([]);
    expect(v.replyCard).toContain("bbc.com");
    expect(v.replyCard.split(/\s+/).length).toBeLessThan(60);
    expect(`${v.summary} ${v.replyCard}`).not.toMatch(/\b(false|fake|hoax|debunk\w*|doubt\w*|unsupported|scam|lie|misinformation|not true)\b/i);
  });
  it("with no sources found it says so without implying true or false", () => {
    const v = generalVerdict([]);
    expect(v.replyCard).toMatch(/doesn't mean it is true or false/);
    expect(v.summary).toMatch(/did not find reputable reports/);
    expect(v.replyCard.split(/\s+/).length).toBeLessThan(60);
  });
});

describe("summaries must be grounded in the source text", () => {
  const source = "In Plateau State attacks killed at least 140 people, Amnesty International said, in a conflict between farmers and herders.";
  it("accepts a faithful summary and rejects one with invented content", () => {
    expect(summaryIsGrounded("Amnesty International said at least 140 people were killed in Plateau State attacks.", source)).toBe(true);
    expect(summaryIsGrounded("The government secretly planned the violence to seize farmland across the country.", source)).toBe(false);
  });
});

describe("fact-checks of a different story do not attach", () => {
  const claim = "Fulani herdsmen are clashing with farmers in Nigeria and it is causing deaths in several states.";
  it("rejects a fact-check of a different video, accepts a page about the same events", () => {
    expect(speaksTo(claim, "Fact check: a viral video said to show herders attacking a church in Kenya is actually from a 2012 film shoot.", 3)).toBe(false);
    expect(speaksTo(claim, "Clashes between Fulani herdsmen and farmers in Nigeria have caused deaths in several states, officials said.", 3)).toBe(true);
  });
});
