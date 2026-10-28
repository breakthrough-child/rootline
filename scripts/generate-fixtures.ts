// Regenerates the demo fixtures from REAL runs (real Tavily search + the configured LLM provider) and saves the full
// result, including its routing log, to fixtures/<id>.json. Whatever provider is configured in .env.local produces
// them (NVIDIA API today; run it again with Nebius env vars and the saved runs are labelled Nebius automatically,
// because the provider is read from each run's own call log).
//
//   npm run fixtures            # all four
//   npm run fixtures -- martinelli   # one (substring match on the id)
//
// Uses roughly 15–20 Tavily credits per fixture. Set DEV_CACHE=true to replay cached responses while iterating.
// There is deliberately no offline/fictional-corpus mode: a demo fixture must come from a real run.
import "./load-env";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const FILES = path.join(ROOT, "fixtures", "files");

async function main() {
  process.env.OFFLINE_MOCK = "false";
  const { config, llmAvailable, searchAvailable } = await import("../src/lib/config");
  if (!llmAvailable("nano") || !searchAvailable()) {
    console.error("Fixtures need real keys: set LLM_API_KEY, MODEL_NANO/SUPER/ULTRA and TAVILY_API_KEY in .env.local (see .env.example).");
    process.exit(1);
  }
  const { RunContext } = await import("../src/lib/llm");
  const { investigate } = await import("../src/lib/investigate");
  const { extractClaims } = await import("../src/lib/claims");
  const { textToInput } = await import("../src/lib/adapters/text");
  const { fileToInput } = await import("../src/lib/adapters");
  const { provenanceOf } = await import("../src/lib/provenance");
  type ExtractedInput = import("../src/lib/types").ExtractedInput;

  const cases: { id: string; title: string; chip: string; description: string; build: (ctx: InstanceType<typeof RunContext>) => Promise<{ input: ExtractedInput; claimText?: string }> }[] = [
    {
      id: "1-perfume",
      title: "“Perfume sample” kidnapping scare",
      chip: "Perfume kidnapping forward",
      description: "A text forward claiming kidnappers drug women with perfume samples, traced from a 2001 email hoax.",
      build: async () => ({ input: textToInput(await readFile(path.join(FILES, "forward-perfume.txt"), "utf8")) }),
    },
    {
      id: "2-screenshot",
      title: "Screenshot of a post from a fictional account",
      chip: "Screenshot of a post",
      description: "A screenshot of a post from a FICTIONAL account (@kemi_reports_247): the post does not exist, but its words have a long family tree.",
      build: async (ctx) => ({ input: await fileToInput(ctx, [{ name: "screenshot-kemi-reports.png", mime: "image/png", buf: await readFile(path.join(FILES, "screenshot-kemi-reports.png")) }]) }),
    },
    {
      id: "3-martinelli",
      title: "“Martinelli” video hacks your phone (WhatsApp hoax)",
      chip: "WhatsApp “Martinelli” warning",
      description: "A long-running WhatsApp chain warning, traced from 2018 to today.",
      build: async () => ({ input: textToInput(await readFile(path.join(FILES, "forward-martinelli.txt"), "utf8")) }),
    },
    {
      id: "4-circular",
      title: "Circular from a fictional organisation",
      chip: "“Official” school circular (PDF)",
      description: "A circular from the FICTIONAL Federal Office of Civic Readiness announcing school closures: no official record exists.",
      build: async (ctx) => {
        const input = await fileToInput(ctx, [{ name: "circular-focr.pdf", mime: "application/pdf", buf: await readFile(path.join(FILES, "circular-focr.pdf")) }]);
        const claims = await extractClaims(ctx, input);
        return { input, claimText: claims[0].text };
      },
    },
  ];

  const only = process.argv[2];
  const selected = cases.filter((x) => !only || x.id.includes(only));
  if (!selected.length) throw new Error(`No fixture matches "${only}". Ids: ${cases.map((c) => c.id).join(", ")}`);
  console.log(`Provider: ${config.llm.provider} (${config.llm.baseUrl})  nano=${config.llm.models.nano}  super=${config.llm.models.super}  ultra=${config.llm.models.ultra}  vision=${config.llm.models.vision || "(none, OCR)"}\n`);

  for (const c of selected) {
    const ctx = new RunContext((e) => {
      if (e.type === "stage" && /^(A|B|C|D|E|F|G|check)$/.test(e.stage)) console.log(`  [${c.id}] ${e.message}`);
      if (e.type === "error") console.log(`  [${c.id}] ERROR ${e.message}`);
    });
    console.log(`▶ ${c.id}`);
    const { input, claimText } = await c.build(ctx);
    const inv = await investigate(ctx, input, [{ id: "k0", text: claimText ?? input.text }], { id: `fixture-${c.id}` });
    if (!inv.claims[0]) throw new Error(`${c.id}: the pipeline produced no result`);
    const prov = provenanceOf(inv.logs, inv.llmProvider);
    if (!prov.provider) throw new Error(`${c.id}: no model call succeeded, refusing to save a fixture that was not produced by a real provider`);
    inv.fixture = { id: c.id, title: c.title, generatedAt: new Date().toISOString(), generatedWith: inv.mode };
    await writeFile(path.join(ROOT, "fixtures", `${c.id}.json`), JSON.stringify({ id: c.id, title: c.title, chip: c.chip, description: c.description, investigation: inv }, null, 1));
    const cl = inv.claims[0];
    const strong = cl.edges.flatMap((e) => e.mutations).filter((m) => m.strength === "strong").length;
    console.log(`  ✓ ${prov.providerName}: ${cl.variants.length} nodes, ${cl.edges.length} edges, ${strong} strong changes, earliest=${cl.variants.find((v) => v.id === cl.earliestId)?.date ?? "-"}, limited=${cl.limited}, checks=${JSON.stringify(Object.fromEntries(Object.entries(inv.checks).map(([k, v]) => [k, v?.outcome])))}`);
  }
  // Stale fixtures from older fixture sets (e.g. the removed offline-corpus ones) must not linger.
  const keep = new Set(cases.map((c) => `${c.id}.json`));
  const { readdir } = await import("node:fs/promises");
  for (const f of await readdir(path.join(ROOT, "fixtures"))) if (f.endsWith(".json") && !keep.has(f) && !only) await rm(path.join(ROOT, "fixtures", f));
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
