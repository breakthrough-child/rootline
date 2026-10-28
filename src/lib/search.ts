// Tavily search + extract (https://docs.tavily.com), with an offline mock over a fictional corpus.
import { config } from "./config";
import { cacheGet, cachePut } from "./devcache";
import type { RunContext } from "./llm";
import { mockExtract, mockSearch } from "./mock/corpus";
import type { DateProvenance } from "./types";

export interface SearchHit {
  url: string;
  title: string;
  content: string; // snippet
  score: number;
  publishedDate: string | null;
}

export interface SearchOptions {
  maxResults?: number;
  includeDomains?: string[];
  topic?: "general" | "news";
  depth?: "basic" | "advanced";
  stage?: string;
}

const TAVILY = "https://api.tavily.com";

async function tavily<T>(path: string, body: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const cached = await cacheGet<T>("tavily", { path, body });
  if (cached) return cached;
  const data = await tavilyFetch<T>(path, body, timeoutMs);
  await cachePut("tavily", { path, body }, data);
  return data;
}

async function tavilyFetch<T>(path: string, body: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${TAVILY}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.tavily.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`Tavily ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function search(ctx: RunContext, query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const t0 = Date.now();
  const stage = opts.stage ?? "B: search";
  if (config.offlineMock) {
    const hits = mockSearch(query, opts.maxResults ?? 10, opts.includeDomains);
    ctx.log({ provider: "mock", model: "fictional-corpus", tier: "search", stage, tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - t0, ok: true, note: `${hits.length} results` });
    return hits;
  }
  if (!config.tavily.apiKey) throw new Error("TAVILY_API_KEY is not set");
  try {
    const data = await tavily<{ results: { url: string; title: string; content: string; score: number; published_date?: string | null }[] }>(
      "/search",
      {
        query,
        search_depth: opts.depth ?? "basic",
        max_results: opts.maxResults ?? 10,
        topic: opts.topic ?? "general",
        include_published_date: true,
        ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
      },
      20_000,
    );
    const hits = (data.results ?? []).map((r) => ({ url: r.url, title: r.title ?? "", content: r.content ?? "", score: r.score ?? 0, publishedDate: r.published_date ?? null }));
    ctx.log({ provider: "tavily", model: `search/${opts.depth ?? "basic"}`, tier: "search", stage, tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - t0, ok: true, note: `${hits.length} results` });
    return hits;
  } catch (e) {
    ctx.log({ provider: "tavily", model: "search", tier: "search", stage, tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - t0, ok: false, note: String((e as Error).message).slice(0, 200) });
    throw e;
  }
}

export interface ExtractedPage {
  url: string;
  content: string;
  metaDate: string | null; // date found in page metadata/content, if any
}

/** Extract page content in batches of 20 (Tavily's per-request limit). */
export async function extract(ctx: RunContext, urls: string[], query?: string): Promise<ExtractedPage[]> {
  const out: ExtractedPage[] = [];
  for (let i = 0; i < urls.length; i += 20) {
    const batch = urls.slice(i, i + 20);
    const t0 = Date.now();
    if (config.offlineMock) {
      out.push(...mockExtract(batch));
      ctx.log({ provider: "mock", model: "fictional-corpus", tier: "extract", stage: "B: extract", tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - t0, ok: true, note: `${batch.length} pages` });
      continue;
    }
    try {
      const data = await tavily<{ results: { url: string; raw_content: string }[]; failed_results?: { url: string; error: string }[] }>(
        "/extract",
        { urls: batch, extract_depth: "basic", format: "text", ...(query ? { query, chunks_per_source: 5 } : {}) },
        35_000,
      );
      for (const r of data.results ?? []) out.push({ url: r.url, content: (r.raw_content ?? "").slice(0, 60_000), metaDate: findMetaDate(r.raw_content ?? "") });
      ctx.log({ provider: "tavily", model: "extract/basic", tier: "extract", stage: "B: extract", tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - t0, ok: true, note: `${data.results?.length ?? 0} ok, ${data.failed_results?.length ?? 0} failed` });
    } catch (e) {
      ctx.log({ provider: "tavily", model: "extract", tier: "extract", stage: "B: extract", tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - t0, ok: false, note: String((e as Error).message).slice(0, 200) });
    }
  }
  return out;
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
/** Best-effort date from page text ("Published 12 March 2021", ISO dates near the top). */
export function findMetaDate(content: string): string | null {
  const head = content.slice(0, 1500);
  const iso = head.match(/\b(20[0-2]\d|19[89]\d)-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const re = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})[a-z]*\\.?,?\\s+(20[0-2]\\d|19[89]\\d)\\b|\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20[0-2]\\d|19[89]\\d)\\b`, "i");
  const m = head.match(re);
  if (!m) return null;
  const [d, mon, y] = m[1] ? [m[1], m[2], m[3]] : [m[5], m[4], m[6]];
  const t = Date.parse(`${d} ${mon} ${y} UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/** Pick the best date and record where it came from. */
export function resolveDate(published: string | null, metaDate: string | null): { date: string | null; provenance: DateProvenance } {
  if (published) {
    const t = Date.parse(published);
    if (!Number.isNaN(t)) return { date: new Date(t).toISOString().slice(0, 10), provenance: "published_date" };
  }
  if (metaDate) return { date: metaDate, provenance: "page_metadata" };
  return { date: null, provenance: "unknown" };
}
