// OpenAI-compatible chat-completions client (Nebius Token Factory by default; any provider via
// LLM_BASE_URL / LLM_API_KEY / MODEL_*) with Zod validation,
// one retry on malformed JSON, and a log entry for every call.
import { z } from "zod";
import { config, llmAvailable, type Tier } from "./config";
import { cacheGet, cachePut } from "./devcache";
import type { ModelCallLog, RunEvent } from "./types";

export class RunContext {
  logs: ModelCallLog[] = [];
  /** Dev/test only: set to a Map to capture extracted page text per URL (used by scripts/real-test.ts audits). */
  pages: Map<string, string> | null = null;
  private seq = 0;
  constructor(private readonly emitFn?: (e: RunEvent) => void) {}
  emit(e: RunEvent) {
    this.emitFn?.(e);
  }
  log(entry: Omit<ModelCallLog, "id" | "at">) {
    const log: ModelCallLog = { ...entry, id: `c${++this.seq}`, at: Date.now() };
    this.logs.push(log);
    this.emitFn?.({ type: "log", log });
    return log;
  }
  stage(stage: string, message: string, claimId?: string) {
    this.emitFn?.({ type: "stage", stage, message, claimId });
  }
}

export class LlmUnavailable extends Error {}

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } | { type: "input_audio"; input_audio: { data: string; format: string } };
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

interface ChatOpts {
  tier: Tier;
  stage: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  timeoutMs?: number;
}

/** Strip reasoning blocks and markdown fences, then pull out the first JSON object/array. */
export function extractJson(raw: string): unknown {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/[[{]/);
  if (start < 0) throw new Error("no JSON found");
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("unterminated JSON");
}

// Shared throttle so parallel stages stay under the provider's requests-per-minute limit.
let nextSlot = 0;
async function throttle() {
  const rpm = config.llm.rpm;
  if (!rpm) return;
  const gap = 60_000 / rpm;
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gap;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

// Per-model memory of optional parameters a provider rejected, so we only pay the retry once.
const unsupported = { thinking: new Set<string>(), json: new Set<string>() };

export async function chat(ctx: RunContext, opts: ChatOpts): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  if (!llmAvailable(opts.tier)) throw new LlmUnavailable(`${opts.tier} model not configured`);
  const { provider, apiKey } = config.llm;
  const model = config.llm.models[opts.tier];
  const baseUrl = opts.tier === "vision" || opts.tier === "asr" ? config.llm.visionBaseUrl : config.llm.baseUrl;
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 1200,
    temperature: opts.temperature ?? 0.1,
  };
  // JSON mode is a hint only: output is always parsed and Zod-validated, so dropping it is safe.
  if (opts.json && config.llm.jsonMode && !unsupported.json.has(model)) body.response_format = { type: "json_object" };
  // Nemotron 3 models reason by default; for structured extraction we turn thinking off where supported.
  if (config.llm.disableThinking && !unsupported.thinking.has(model)) body.chat_template_kwargs = { enable_thinking: false };

  // Dev-only response cache (DEV_CACHE=true). The log keeps the originally measured latency/tokens.
  const cacheKey = { baseUrl, body };
  const hit = await cacheGet<{ text: string; tokensIn: number; tokensOut: number; latencyMs: number }>("llm", cacheKey);
  if (hit) {
    ctx.log({ provider, model, tier: opts.tier, stage: opts.stage, tokensIn: hit.tokensIn, tokensOut: hit.tokensOut, latencyMs: hit.latencyMs, ok: true, note: "dev cache (original latency)" });
    return { text: hit.text, tokensIn: hit.tokensIn, tokensOut: hit.tokensOut };
  }

  let attemptStart = Date.now();
  const doFetch = async (payload: Record<string, unknown>) => {
    await throttle();
    attemptStart = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 45_000);
    try {
      return await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  // Retry transient failures (rate limits, 5xx) with backoff; honour Retry-After.
  const fetchWithBackoff = async (payload: Record<string, unknown>) => {
    let res = await doFetch(payload);
    for (let attempt = 0; attempt < 5 && (res.status === 429 || res.status >= 500); attempt++) {
      const ra = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, (Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) : Math.min(2 ** attempt * 3, 30)) * 1000));
      res = await doFetch(payload);
    }
    return res;
  };

  try {
    let res = await fetchWithBackoff(body);
    // Providers differ in which optional parameters they accept. On a 400, drop them one at a
    // time (thinking toggle first, then JSON mode), remember that for this model, and retry.
    for (const [key, memo] of [["chat_template_kwargs", unsupported.thinking], ["response_format", unsupported.json]] as const) {
      if (res.status !== 400 || !(key in body)) continue;
      memo.add(model);
      delete body[key];
      res = await fetchWithBackoff(body);
    }
    if (!res.ok) throw new Error(`${provider} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      choices: { message: { content: string | null; reasoning_content?: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const tokensIn = data.usage?.prompt_tokens ?? 0;
    const tokensOut = data.usage?.completion_tokens ?? 0;
    // Latency of the successful request itself; time spent in our own throttle/backoff is reported in the note.
    const latencyMs = Date.now() - attemptStart;
    const waited = attemptStart - t0;
    ctx.log({ provider, model, tier: opts.tier, stage: opts.stage, tokensIn, tokensOut, latencyMs, ok: true, note: waited > 1500 ? `+${(waited / 1000).toFixed(1)}s throttle/retry wait` : undefined });
    await cachePut("llm", cacheKey, { text, tokensIn, tokensOut, latencyMs });
    return { text, tokensIn, tokensOut };
  } catch (err) {
    ctx.log({ provider, model, tier: opts.tier, stage: opts.stage, tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - t0, ok: false, note: String((err as Error).message).slice(0, 200) });
    throw err;
  }
}

/**
 * Ask for JSON matching `schema`. Retries once (feeding back the validation error) and then
 * throws, so callers can degrade gracefully to their heuristic fallback.
 */
export async function chatJson<T>(ctx: RunContext, schema: z.ZodType<T>, opts: Omit<ChatOpts, "json">): Promise<T> {
  let messages = opts.messages;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    // A retry usually follows truncated JSON (output hit max_tokens), so give it a bigger budget.
    const { text } = await chat(ctx, { ...opts, maxTokens: attempt ? Math.min(4000, (opts.maxTokens ?? 1200) * 2) : opts.maxTokens, messages, json: true, stage: attempt ? `${opts.stage} (retry)` : opts.stage });
    try {
      const parsed = schema.safeParse(extractJson(text));
      if (parsed.success) return parsed.data;
      lastErr = new Error(parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    } catch (e) {
      lastErr = e;
    }
    messages = [
      ...opts.messages,
      { role: "assistant", content: text.slice(0, 2000) },
      { role: "user", content: `That was not valid JSON for the required schema (${String((lastErr as Error).message).slice(0, 200)}). Reply with ONLY the corrected JSON object.` },
    ];
  }
  throw lastErr instanceof Error ? lastErr : new Error("invalid model output");
}

/** Run `primary` (a model call); on any failure, log and run the deterministic `fallback`. */
export async function withFallback<T>(ctx: RunContext, stage: string, tier: Tier, primary: () => Promise<T>, fallback: () => T): Promise<{ value: T; usedFallback: boolean }> {
  let reason = "";
  if (llmAvailable(tier)) {
    try {
      return { value: await primary(), usedFallback: false };
    } catch (e) {
      // fall through to the heuristic; transport failures are already logged, validation rejections are recorded below
      reason = String((e as Error).message ?? e).slice(0, 160);
    }
  }
  const t0 = Date.now();
  const value = fallback();
  ctx.log({
    provider: "heuristic",
    model: "rootline-heuristic",
    tier: "local",
    stage,
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: Date.now() - t0,
    ok: true,
    note: llmAvailable(tier) ? `${tier} output rejected or call failed (${reason}); used deterministic fallback` : `${tier} not configured; used deterministic fallback`,
  });
  return { value, usedFallback: true };
}
