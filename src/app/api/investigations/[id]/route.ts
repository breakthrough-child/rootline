import { getInvestigation } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await getInvestigation(id).catch(() => null);
  return inv ? Response.json(inv) : Response.json({ error: "Not found" }, { status: 404 });
}
