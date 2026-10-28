"use client";
import { useMemo, useState } from "react";
import { summarizeCost } from "@/lib/cost";
import { PROVIDER_NAME, provenanceOf } from "@/lib/provenance";
import type { ExtractedInput, ModelCallLog } from "@/lib/types";

const DEFAULT_PRICING: Record<string, [number, number]> = { nano: [0.06, 0.24], super: [0.3, 0.9], ultra: [1, 3], vision: [0.3, 0.9] };

const WHY: Record<string, string> = {
  nano: "Nano — high-volume, parallel, narrow jobs: claim parsing, page membership, pairwise mutations, checks.",
  super: "Super — judgement across many items: clustering variants, reviewing mutation labels, ranking claims, writing the verdict and reply.",
  ultra: "Ultra — one hard reasoning call: refining the whole lineage tree under constraints.",
  vision: "Vision — reading screenshots, scanned pages and video keyframes.",
  asr: "Speech — transcribing voice notes and video audio.",
  search: "Tavily search — finding earlier and parallel versions.",
  extract: "Tavily extract — reading full page content.",
  local: "Local — OCR or deterministic fallbacks (no model call).",
};


export function RoutingDrawer({ logs, pricing, input, provider: providerProp }: { logs: ModelCallLog[]; pricing?: Record<string, [number, number]>; input?: ExtractedInput; provider?: string }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => summarizeCost(logs, pricing ?? DEFAULT_PRICING), [logs, pricing]);
  // The provider comes from the run's own call log; the stored label is only a fallback for runs without model calls.
  const prov = useMemo(() => provenanceOf(logs, providerProp), [logs, providerProp]);
  const provider = prov.provider ?? undefined;
  const tiers = [...new Set(summary.rows.map((r) => r.tier))];
  const fallbacks = logs.filter((l) => l.provider === "heuristic").length;
  const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
        How this was built
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOpen(false)} role="dialog" aria-modal aria-label="How this was built">
          <div className="h-full w-full max-w-xl overflow-y-auto bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">How this was built</h2>
              <button onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-muted hover:bg-surface-2" aria-label="Close">✕</button>
            </div>
            <p className="mb-4 text-sm text-muted">
              Every number below comes from this run&apos;s real call log: {logs.length} calls{fallbacks ? `, including ${fallbacks} deterministic fallback step${fallbacks > 1 ? "s" : ""}` : ""}.
              {provider && <> Models served by {PROVIDER_NAME[provider] ?? provider}.</>}
            </p>

            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Routing</h3>
            <div className="mb-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1 pr-2">Tier / model</th>
                    <th className="py-1 pr-2 text-right">Calls</th>
                    <th className="py-1 pr-2 text-right">Tokens in/out</th>
                    <th className="py-1 pr-2 text-right">Time</th>
                    <th className="py-1 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r) => (
                    <tr key={`${r.tier}${r.model}`} className="border-t border-line">
                      <td className="py-1.5 pr-2">
                        <span className="font-medium">{r.tier}</span> <span className="break-all text-xs text-muted">{r.model}</span>
                        {r.failed > 0 && <span className="ml-1 text-xs text-rose">({r.failed} failed)</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{r.calls}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{r.tokensIn || r.tokensOut ? `${r.tokensIn.toLocaleString()} / ${r.tokensOut.toLocaleString()}` : "—"}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{(r.latencyMs / 1000).toFixed(1)}s</td>
                      <td className="py-1.5 text-right tabular-nums">{r.costUsd ? usd(r.costUsd) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Versus running everything on Ultra</h3>
            {summary.ultraOnlyLatencyMs !== null ? (
              <div className="mb-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-accent-soft p-3">
                  <p className="text-xs text-muted">Routed (this run)</p>
                  <p className="text-lg font-semibold tabular-nums">{usd(summary.totalCostUsd)}</p>
                  <p className="text-xs tabular-nums text-muted">{(summary.modelLatencyMs / 1000).toFixed(1)}s summed model time</p>
                </div>
                <div className="rounded-lg bg-surface-2 p-3">
                  <p className="text-xs text-muted">All on Ultra (estimate)</p>
                  <p className="text-lg font-semibold tabular-nums">{usd(summary.ultraOnlyCostUsd)}</p>
                  <p className="text-xs tabular-nums text-muted">{summary.latencyBasis.startsWith("no Ultra") ? "latency not estimated (no Ultra call measured in this run)" : `~${(summary.ultraOnlyLatencyMs / 1000).toFixed(1)}s summed model time (estimate)`}</p>
                </div>
                <p className="col-span-2 text-xs text-muted">
                  {provider && provider !== "nebius" && <>Costs use Nebius Token Factory list prices as an estimate (this run used {PROVIDER_NAME[provider] ?? provider}). </>}
                  Same token counts re-priced at Ultra rates ({summary.pricing.ultra?.join(" / ")} USD per 1M in/out). Latency basis: {summary.latencyBasis}. Token counts for Ultra would differ in practice; this is an estimate.
                </p>
              </div>
            ) : (
              <p className="mb-5 rounded-lg bg-surface-2 p-3 text-sm text-muted">No Token Factory calls in this run (offline mock or fallbacks only), so there is no cost to compare.</p>
            )}

            {input && (
              <>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Input path</h3>
                <ul className="mb-5 flex flex-wrap gap-1.5 text-xs">
                  {input.adapterPath.map((p) => (
                    <li key={p} className="rounded bg-surface-2 px-2 py-1 font-mono">{p}</li>
                  ))}
                </ul>
              </>
            )}

            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Why each tier does each job</h3>
            <ul className="mb-5 space-y-1 text-sm">
              {tiers.map((t) => (
                <li key={t}>{WHY[t] ?? t}</li>
              ))}
            </ul>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted">Full call log ({logs.length})</summary>
              <ol className="mt-2 space-y-1 font-mono">
                {logs.map((l) => (
                  <li key={l.id} className={l.ok ? "" : "text-rose"}>
                    [{l.stage}] {l.provider}/{l.model} · {l.tokensIn}/{l.tokensOut} tok · {l.latencyMs}ms{l.note ? ` · ${l.note}` : ""}
                  </li>
                ))}
              </ol>
            </details>
          </div>
        </div>
      )}
    </>
  );
}
