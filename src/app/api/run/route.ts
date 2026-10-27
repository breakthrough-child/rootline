// POST {input, claims} → stream the pipeline (SSE), save the investigation, emit the result.
import { config } from "@/lib/config";
import { getFixture, listFixtures, replay } from "@/lib/fixtures";
import { rateLimit, sseResponse } from "@/lib/http";
import { investigate, preflight } from "@/lib/investigate";
import { RunContext } from "@/lib/llm";
import { saveInvestigation } from "@/lib/store";
import { canonical } from "@/lib/text";
import type { ExtractedInput } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const limited = rateLimit(req, "run", 6);
  if (limited) return limited;
  let body: { input: ExtractedInput; claims?: { id: string; text: string }[] };
  try {
    body = await req.json();
    if (!body?.input?.text || typeof body.input.text !== "string") throw new Error();
    if (body.input.text.length > 40_000) return Response.json({ error: "Input too long." }, { status: 400 });
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  // Demo mode: a pasted demo message replays its saved run.
  if (config.demoMode) {
    for (const f of await listFixtures()) {
      const fx = await getFixture(f.id);
      if (fx && canonical(fx.investigation.input.text) === canonical(body.input.text)) return sseResponse((emit) => replay(fx, emit));
    }
  }
  return sseResponse(async (emit) => {
    const problem = preflight();
    if (problem) {
      emit({ type: "error", stage: "config", message: problem });
      return;
    }
    const ctx = new RunContext(emit);
    const claims = (body.claims ?? []).filter((c) => typeof c.text === "string" && c.text.trim()).map((c) => ({ id: String(c.id), text: c.text.slice(0, 2000) }));
    const inv = await investigate(ctx, body.input, claims);
    try {
      await saveInvestigation(inv);
    } catch (e) {
      emit({ type: "stage", stage: "save", message: `Could not save this result for sharing: ${(e as Error).message}` });
    }
    emit({ type: "result", investigation: inv });
  });
}
