// Routing cost/latency summary built from real call logs (pure; safe on client and server).
import type { ModelCallLog } from "./types";

export type Pricing = Record<string, [number, number]>; // tier -> USD per 1M [in, out]

export interface TierRow {
  tier: string;
  model: string;
  calls: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costUsd: number;
}

export interface CostSummary {
  rows: TierRow[];
  totalCostUsd: number;
  ultraOnlyCostUsd: number;
  modelLatencyMs: number; // sum of model call latencies
  ultraOnlyLatencyMs: number | null; // estimated
  latencyBasis: string;
  pricing: Pricing;
}

const DEFAULT_ULTRA_MS_PER_OUT_TOKEN = 25; // fallback estimate when no Ultra call was measured in this run

export function summarizeCost(logs: ModelCallLog[], pricing: Pricing): CostSummary {
  const map = new Map<string, TierRow>();
  for (const l of logs) {
    const key = `${l.tier}|${l.model}`;
    const r = map.get(key) ?? { tier: l.tier, model: l.model, calls: 0, failed: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0, costUsd: 0 };
    r.calls++;
    if (!l.ok) r.failed++;
    r.tokensIn += l.tokensIn;
    r.tokensOut += l.tokensOut;
    r.latencyMs += l.latencyMs;
    const p = pricing[l.tier];
    if (p) r.costUsd += (l.tokensIn * p[0] + l.tokensOut * p[1]) / 1e6;
    map.set(key, r);
  }
  const rows = [...map.values()].sort((a, b) => b.calls - a.calls);
  const llmLogs = logs.filter((l) => l.provider === "nebius");
  const ultra = pricing.ultra ?? [1, 3];
  const ultraOnlyCostUsd = llmLogs.reduce((a, l) => a + (l.tokensIn * ultra[0] + l.tokensOut * ultra[1]) / 1e6, 0);
  const ultraLogs = llmLogs.filter((l) => l.tier === "ultra" && l.ok && l.tokensOut > 0);
  const measured = ultraLogs.length ? ultraLogs.reduce((a, l) => a + l.latencyMs, 0) / ultraLogs.reduce((a, l) => a + l.tokensOut, 0) : null;
  const msPerTok = measured ?? DEFAULT_ULTRA_MS_PER_OUT_TOKEN;
  const ultraOnlyLatencyMs = llmLogs.length ? llmLogs.reduce((a, l) => a + (l.tier === "ultra" ? l.latencyMs : l.tokensOut * msPerTok + 400), 0) : null;
  return {
    rows,
    totalCostUsd: rows.reduce((a, r) => a + r.costUsd, 0),
    ultraOnlyCostUsd,
    modelLatencyMs: llmLogs.reduce((a, l) => a + l.latencyMs, 0),
    ultraOnlyLatencyMs,
    latencyBasis: measured ? `Ultra measured in this run at ${measured.toFixed(1)} ms/output token` : `no Ultra call measured; assumes ${DEFAULT_ULTRA_MS_PER_OUT_TOKEN} ms/output token`,
    pricing,
  };
}
