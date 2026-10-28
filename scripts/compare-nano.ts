// Compares candidate Nano-tier models on the REAL membership stage (Stage C) over pages saved by real-test.ts.
// For each model: pages accepted, agreement with the first model, per-request latency (excludes our own
// throttle waits), tokens, failures. Review disagreements by eye: the "reference" is not ground truth.
//   npx tsx scripts/compare-nano.ts perfume nvidia/nemotron-3.5-lightning-30b-a3b nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
import "./load-env";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const [id, ...models] = process.argv.slice(2);
  if (!id || !models.length) throw new Error("usage: compare-nano.ts <rumorId> <modelA> [modelB ...]");
  const pagesFile = JSON.parse(await readFile(path.join(".cache", "real-test", `${id}.pages.json`), "utf8")) as Record<string, string>;
  const inv = JSON.parse(await readFile(path.join(".cache", "real-test", `${id}.json`), "utf8"));
  const c = inv.claims[0];
  const { config } = await import("../src/lib/config");
  const { RunContext } = await import("../src/lib/llm");
  const { confirmMembership } = await import("../src/lib/pipeline");
  const pages = Object.entries(pagesFile).map(([url, content]) => ({ url, title: "", content, date: null, dateProvenance: "unknown" as const }));
  console.log(`${pages.length} pages · claim: ${c.understanding.claim.slice(0, 80)} · elements: ${c.understanding.keyElements?.length ?? 0}\n`);
  const accepted: Record<string, Set<string>> = {};
  for (const model of models) {
    config.llm.models.nano = model;
    const ctx = new RunContext();
    const t0 = Date.now();
    const vs = await confirmMembership(ctx, c.understanding.claim, c.understanding.keyElements ?? [], pages, "cmp");
    const calls = ctx.logs.filter((l) => l.stage.startsWith("C: confirm"));
    const ok = calls.filter((l) => l.ok);
    const lat = ok.map((l) => l.latencyMs).sort((a, b) => a - b);
    const q = (p: number) => (lat.length ? (lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] / 1000).toFixed(1) : "-");
    accepted[model] = new Set(vs.flatMap((v) => v.sources.map((s) => s.url)));
    console.log(`${model}\n  accepted ${accepted[model].size}/${pages.length} · model calls ${calls.length} (${calls.length - ok.length} failed) · latency p50 ${q(0.5)}s p95 ${q(0.95)}s · tokens in/out ${ok.reduce((a, l) => a + l.tokensIn, 0)}/${ok.reduce((a, l) => a + l.tokensOut, 0)} · wall ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const ref = accepted[models[0]];
  for (const m of models.slice(1)) {
    const a = accepted[m];
    const only = (x: Set<string>, y: Set<string>) => [...x].filter((u) => !y.has(u)).map((u) => new URL(u).hostname + new URL(u).pathname.slice(0, 40));
    console.log(`\n${m.split("/").pop()} vs ${models[0].split("/").pop()}: both=${[...a].filter((u) => ref.has(u)).length}  only-ref=${only(ref, a).length}  only-this=${only(a, ref).length}`);
    console.log("  only in reference:", only(ref, a).join(" | ") || "-");
    console.log("  only in this     :", only(a, ref).join(" | ") || "-");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
