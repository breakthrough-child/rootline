// Runs each demo case through the REAL pipeline and saves the full result (incl. routing logs)
// to fixtures/<id>.json. With LLM_API_KEY (or NEBIUS_API_KEY) + MODEL_NANO + TAVILY_API_KEY set it uses
// the live web and Nemotron on the configured provider; otherwise it falls back to OFFLINE_MOCK (fictional corpus) and labels the fixture so.
//   npx tsx scripts/generate-fixtures.ts            (all)
//   npx tsx scripts/generate-fixtures.ts perfume    (one)
import "./load-env";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const live = !!((process.env.LLM_API_KEY || process.env.NEBIUS_API_KEY) && process.env.TAVILY_API_KEY && process.env.MODEL_NANO);
if (!live) process.env.OFFLINE_MOCK = "true";

const ROOT = path.join(__dirname, "..");
const FILES = path.join(ROOT, "fixtures", "files");

async function main() {
  const { RunContext } = await import("../src/lib/llm");
  const { investigate } = await import("../src/lib/investigate");
  const { extractClaims } = await import("../src/lib/claims");
  const { textToInput } = await import("../src/lib/adapters/text");
  const { fileToInput } = await import("../src/lib/adapters");
  const { normalizeInput } = await import("../src/lib/text");
  type ExtractedInput = import("../src/lib/types").ExtractedInput;

  const cases: { id: string; title: string; chip: string; description: string; build: (ctx: InstanceType<typeof RunContext>) => Promise<ExtractedInput> }[] = [
    {
      id: "1-perfume",
      title: "“Perfume sample” kidnapping scare",
      chip: "Perfume kidnapping forward",
      description: "A text forward claiming kidnappers drug women with perfume samples.",
      build: async () => textToInput(await readFile(path.join(FILES, "forward-perfume.txt"), "utf8")),
    },
    {
      id: "2-grant",
      title: "“Free government cash grant” scam chain",
      chip: "Government grant scam",
      description: "A text forward offering a government cash grant via a link.",
      build: async () => textToInput(await readFile(path.join(FILES, "forward-grant.txt"), "utf8")),
    },
    {
      id: "3-screenshot",
      title: "Screenshot of a post from a fictional account",
      chip: "Screenshot of a post",
      description: "A screenshot of a post from a fictional account (@kemi_reports_247).",
      build: async (ctx) => fileToInput(ctx, [{ name: "screenshot-kemi-reports.png", mime: "image/png", buf: await readFile(path.join(FILES, "screenshot-kemi-reports.png")) }]),
    },
    {
      id: "4-voice",
      title: "Voice note in Pidgin (fictional speaker)",
      chip: "Voice note (Pidgin)",
      description: "A voice note repeating the grant rumour in Nigerian Pidgin.",
      build: async () => {
        // No audio recording is bundled yet (see fixtures/files/README.md): the transcript stands in for ASR output.
        const t = normalizeInput(await readFile(path.join(FILES, "voice-note-transcript.txt"), "utf8"));
        const segs = t.split(/(?<=[.?!])\s+/).map((s, i) => ({ start: i * 4, end: i * 4 + 4, text: s }));
        let text = "";
        const locations = segs.map((s) => {
          const start = text.length + (text ? 1 : 0);
          text += (text ? " " : "") + s.text;
          return { label: `00:${String(s.start).padStart(2, "0")}`, start, end: text.length, seconds: s.start };
        });
        return {
          sourceKind: "audio",
          original: { kind: "upload", filename: "voice-note.ogg", mime: "audio/ogg" },
          text,
          englishText: "Did you hear? The Federal Government is giving a fifty thousand naira relief grant to every citizen. Click the link and apply before Friday. Share it to ten groups so they activate your payment.",
          language: "pcm",
          locations,
          segments: segs,
          unverifiedMetadata: { duration: `${segs.length * 4}s` },
          adapterPath: ["asr:fixture-transcript (no recording bundled)", "translate:fixture"],
          notes: ["Auto-transcribed; may contain errors, especially for Pidgin and local languages."],
        } satisfies ExtractedInput;
      },
    },
    {
      id: "5-circular",
      title: "Circular from a fictional organisation",
      chip: "“Official” school circular (PDF)",
      description: "A circular from the fictional Federal Office of Civic Readiness announcing school closures.",
      build: async (ctx) => fileToInput(ctx, [{ name: "circular-focr.pdf", mime: "application/pdf", buf: await readFile(path.join(FILES, "circular-focr.pdf")) }]),
    },
  ];

  const only = process.argv[2];
  for (const c of cases.filter((x) => !only || x.id.includes(only))) {
    const ctx = new RunContext((e) => {
      if (e.type === "stage") console.log(`  [${c.id}] ${e.message}`);
      if (e.type === "error") console.log(`  [${c.id}] ERROR ${e.message}`);
    });
    console.log(`\n▶ ${c.id} (${live ? `live via ${process.env.LLM_BASE_URL || process.env.NEBIUS_BASE_URL || "Nebius Token Factory"}` : "offline mock"})`);
    const input = await c.build(ctx);
    const claims = await extractClaims(ctx, input);
    const inv = await investigate(ctx, input, claims.slice(0, c.id === "5-circular" ? 1 : 3).map((k) => ({ id: k.id, text: k.text })), { id: `fixture-${c.id}` });
    inv.fixture = { id: c.id, title: c.title, generatedAt: new Date().toISOString(), generatedWith: inv.mode };
    await writeFile(path.join(ROOT, "fixtures", `${c.id}.json`), JSON.stringify({ id: c.id, title: c.title, chip: c.chip, description: c.description, investigation: inv }, null, 1));
    const cl = inv.claims[0];
    console.log(`  ✓ ${inv.claims.length} claim(s); ${cl?.variants.length ?? 0} nodes, ${cl?.edges.length ?? 0} edges, earliest=${cl?.earliestId}, limited=${cl?.limited}; checks=${JSON.stringify(Object.fromEntries(Object.entries(inv.checks).map(([k, v]) => [k, v?.outcome])))}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
