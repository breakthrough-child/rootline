// Prints node counts, edge confidence, latency and cost for every fixture.
//   npx tsx scripts/eval.ts          (saved fixtures)
//   npx tsx scripts/eval.ts --rerun  (re-run each fixture's input through the pipeline now)
import "./load-env";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { summarizeCost } from "../src/lib/cost";
import type { Investigation } from "../src/lib/types";

const DIR = path.join(__dirname, "..", "fixtures");

async function main() {
  const rerun = process.argv.includes("--rerun");
  if (rerun && !((process.env.LLM_API_KEY || process.env.NEBIUS_API_KEY) && process.env.TAVILY_API_KEY)) process.env.OFFLINE_MOCK = "true";
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json")).sort();
  const rows: Record<string, string | number>[] = [];
  for (const f of files) {
    const fx = JSON.parse(await readFile(path.join(DIR, f), "utf8")) as { id: string; investigation: Investigation };
    let inv = fx.investigation;
    if (rerun) {
      const { RunContext } = await import("../src/lib/llm");
      const { investigate } = await import("../src/lib/investigate");
      inv = await investigate(new RunContext(), inv.input, inv.claims.map((c) => ({ id: c.claimId, text: c.claim })));
    }
    const cost = summarizeCost(inv.logs, inv.pricing ?? {});
    for (const c of inv.claims) {
      const conf = { high: 0, medium: 0, low: 0 };
      for (const e of c.edges) conf[e.confidence]++;
      rows.push({
        fixture: fx.id,
        mode: inv.mode,
        claim: c.claim.slice(0, 40),
        nodes: c.variants.length,
        sources: c.variants.reduce((a, v) => a + v.sources.length, 0),
        edges: c.edges.length,
        "conf h/m/l": `${conf.high}/${conf.medium}/${conf.low}`,
        mutations: c.edges.reduce((a, e) => a + e.mutations.length, 0),
        limited: String(c.limited),
        earliest: c.variants.find((v) => v.id === c.earliestId)?.date ?? "-",
        "latency s": (inv.totalLatencyMs / 1000).toFixed(1),
        calls: inv.logs.length,
        "cost $": cost.totalCostUsd.toFixed(4),
        "all-Ultra $": cost.ultraOnlyCostUsd.toFixed(4),
      });
    }
  }
  console.table(rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
