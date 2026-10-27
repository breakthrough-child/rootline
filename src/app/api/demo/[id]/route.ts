// GET → replay a saved demo fixture with streamed timing.
import { getFixture, replay } from "@/lib/fixtures";
import { sseResponse } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fx = await getFixture(id);
  if (!fx) return Response.json({ error: "Unknown demo." }, { status: 404 });
  const speed = Math.min(10, Math.max(0.5, Number(new URL(req.url).searchParams.get("speed") ?? 1) || 1));
  return sseResponse((emit) => replay(fx, emit, speed));
}
