// Which provider/models actually produced a saved run: always derived from its call log, never hardcoded.
import type { Investigation, ModelCallLog } from "./types";

export const PROVIDER_NAME: Record<string, string> = {
  nebius: "Nebius Token Factory",
  nvidia: "the NVIDIA API (build.nvidia.com)",
  "openai-compatible": "an OpenAI-compatible endpoint",
};
const LLM = new Set(Object.keys(PROVIDER_NAME));

export interface RunProvenance {
  provider: string | null; // nebius | nvidia | openai-compatible | null (no model calls: offline/mock)
  providerName: string;
  models: { tier: string; model: string; calls: number }[];
  fallbackCalls: number;
}

export function provenanceOf(logs: ModelCallLog[], fallbackProvider?: string): RunProvenance {
  const llm = logs.filter((l) => LLM.has(l.provider) && l.ok);
  const counts = new Map<string, number>();
  for (const l of llm) counts.set(l.provider, (counts.get(l.provider) ?? 0) + 1);
  const provider = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (llm.length ? null : (fallbackProvider ?? null));
  const byModel = new Map<string, { tier: string; model: string; calls: number }>();
  for (const l of llm) {
    const k = `${l.tier}|${l.model}`;
    const r = byModel.get(k) ?? { tier: l.tier, model: l.model, calls: 0 };
    r.calls++;
    byModel.set(k, r);
  }
  return {
    provider,
    providerName: provider ? (PROVIDER_NAME[provider] ?? provider) : "no model provider (rule-based fallbacks only)",
    models: [...byModel.values()].sort((a, b) => b.calls - a.calls),
    fallbackCalls: logs.filter((l) => l.provider === "heuristic").length,
  };
}

/** One honest sentence for the "Replay of a saved run" banner. */
export function replayNote(inv: Investigation, generatedAt?: string): string {
  const p = provenanceOf(inv.logs, inv.llmProvider);
  const when = (generatedAt ?? inv.createdAt).slice(0, 10);
  const offline = inv.mode === "offline_mock" || inv.fixture?.generatedWith === "offline_mock";
  if (offline) return `Replay of a saved run from ${when}, generated offline against a FICTIONAL corpus (sources are .example placeholders), not the real web.`;
  const tiers = p.models.filter((m) => ["nano", "super", "ultra", "vision"].includes(m.tier)).map((m) => `${m.tier}: ${m.model.split("/").pop()}`);
  return `Replay of a saved run from ${when}. Real web search (Tavily); models served by ${p.providerName}${tiers.length ? ` (${tiers.join(", ")})` : ""}.`;
}
