// Watchlist: list, add (from a saved investigation), remove.
import { rateLimit } from "@/lib/http";
import { newId } from "@/lib/investigate";
import { deleteWatch, getInvestigation, listWatch, saveInvestigation, saveWatch, storageBackend } from "@/lib/store";
import type { Investigation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ items: await listWatch(), storage: storageBackend() });
  } catch (e) {
    return Response.json({ items: [], storage: storageBackend(), error: (e as Error).message });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "watch", 20);
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as { investigationId?: string; investigation?: Investigation; label?: string };
  let inv = body.investigationId ? await getInvestigation(body.investigationId) : null;
  // Replayed demo runs aren't stored yet: save a copy so they can be watched.
  if (!inv && body.investigation?.claims) {
    inv = { ...body.investigation, id: newId(), mode: body.investigation.mode === "replay" ? "replay" : body.investigation.mode };
    await saveInvestigation(inv);
  }
  if (!inv) return Response.json({ error: "Investigation not found." }, { status: 404 });
  const now = new Date().toISOString();
  const item = {
    id: newId(),
    label: (body.label || inv.claims[0]?.claim || inv.input.text).slice(0, 140),
    investigationId: inv.id,
    createdAt: now,
    lastRunAt: now,
    runs: [{ investigationId: inv.id, at: now, variantCount: inv.claims.reduce((a, c) => a + c.variants.filter((v) => !v.isUserInput).length, 0), newCount: 0 }],
  };
  await saveWatch(item);
  return Response.json(item);
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await deleteWatch(id);
  return Response.json({ ok: true });
}
