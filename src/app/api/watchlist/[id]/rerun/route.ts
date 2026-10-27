// Re-run a watched investigation and highlight variants that are new since the last run.
import { rateLimit, sseResponse } from "@/lib/http";
import { investigate, preflight } from "@/lib/investigate";
import { RunContext } from "@/lib/llm";
import { getInvestigation, getWatch, saveInvestigation, saveWatch } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "rerun", 4);
  if (limited) return limited;
  const { id } = await params;
  const item = await getWatch(id);
  if (!item) return Response.json({ error: "Watch item not found." }, { status: 404 });
  const prev = await getInvestigation(item.investigationId);
  if (!prev) return Response.json({ error: "Previous run not found." }, { status: 404 });
  return sseResponse(async (emit) => {
    const problem = preflight();
    if (problem) {
      emit({ type: "error", stage: "config", message: problem });
      return;
    }
    const previousSourceUrls = new Set(prev.claims.flatMap((c) => c.variants.flatMap((v) => v.sources.map((s) => s.url))));
    const ctx = new RunContext(emit);
    const inv = await investigate(ctx, prev.input, prev.claims.map((c) => ({ id: c.claimId, text: c.claim })), { previousSourceUrls });
    await saveInvestigation(inv);
    const now = new Date().toISOString();
    const newCount = inv.claims.reduce((a, c) => a + c.variants.filter((v) => v.isNew).length, 0);
    await saveWatch({ ...item, investigationId: inv.id, lastRunAt: now, runs: [...item.runs, { investigationId: inv.id, at: now, variantCount: inv.claims.reduce((a, c) => a + c.variants.filter((v) => !v.isUserInput).length, 0), newCount }] });
    emit({ type: "result", investigation: inv });
  });
}
