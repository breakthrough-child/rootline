import { publicStatus } from "@/lib/config";
import { listFixtures } from "@/lib/fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ...publicStatus(), fixtures: await listFixtures() });
}
