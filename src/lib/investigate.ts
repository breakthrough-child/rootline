// Runs a full investigation: checks + one pipeline run per selected claim, grouped together.
import pLimit from "p-limit";
import { checkOfficial, checkPostExists, looksOfficial } from "./checks";
import { config, llmAvailable, searchAvailable } from "./config";
import { RunContext } from "./llm";
import { runClaim } from "./pipeline";
import type { ClaimResult, Investigation, RunMode } from "./types";
import type { ExtractedInput } from "./types";

export function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function runMode(): { mode: RunMode; note?: string } {
  if (config.offlineMock)
    return { mode: "offline_mock", note: "Offline mock: sources come from a FICTIONAL built-in corpus (.example domains) and model stages use deterministic heuristics. Not a real web trace." };
  return { mode: "live" };
}

export function preflight(): string | null {
  if (!searchAvailable()) return "Search isn't configured (TAVILY_API_KEY missing). Try a demo example, or set OFFLINE_MOCK=true for the fictional offline corpus.";
  if (!config.offlineMock && !llmAvailable("nano")) return "Nebius Token Factory isn't configured (NEBIUS_API_KEY / MODEL_NANO missing). Try a demo example instead.";
  return null;
}

export async function investigate(
  ctx: RunContext,
  input: ExtractedInput,
  claims: { id: string; text: string }[],
  opts: { previousSourceUrls?: Set<string>; id?: string } = {},
): Promise<Investigation> {
  const t0 = Date.now();
  const selected = claims.length ? claims.slice(0, 5) : [{ id: "k0", text: input.text }];
  const checks: Investigation["checks"] = {};
  const checkTasks: Promise<void>[] = [];
  if (input.screenshot) {
    checkTasks.push(
      checkPostExists(ctx, input.screenshot)
        .then((r) => {
          if (r) {
            checks.postExists = r;
            ctx.emit({ type: "check", postExists: r });
          }
        })
        .catch(() => undefined),
    );
  }
  if (["pdf", "docx", "image"].includes(input.sourceKind) && (input.sourceKind !== "image" || looksOfficial(input.text))) {
    checkTasks.push(
      checkOfficial(ctx, input, selected[0].text)
        .then((r) => {
          if (r) {
            checks.official = r;
            ctx.emit({ type: "check", official: r });
          }
        })
        .catch(() => undefined),
    );
  }
  const limit = pLimit(2);
  const results = await Promise.all(
    selected.map((c) =>
      limit(async (): Promise<ClaimResult | null> => {
        try {
          const r = await runClaim(ctx, c.id, c.text, input, { previousSourceUrls: opts.previousSourceUrls });
          ctx.emit({ type: "claim_done", claim: r });
          return r;
        } catch (e) {
          ctx.emit({ type: "error", message: `Tracing this claim failed: ${(e as Error).message}`, stage: c.id });
          return null;
        }
      }),
    ),
  );
  await Promise.all(checkTasks);
  const { mode, note } = runMode();
  return {
    id: opts.id ?? newId(),
    createdAt: new Date().toISOString(),
    mode,
    modeNote: note,
    input: { ...input, original: { ...input.original } },
    claims: results.filter((r): r is ClaimResult => r !== null),
    checks,
    logs: ctx.logs,
    totalLatencyMs: Date.now() - t0,
    pricing: config.pricing,
  };
}
