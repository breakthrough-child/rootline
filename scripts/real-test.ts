// Real-data test: runs real rumors (and one screenshot) end to end against the REAL web (Tavily) and the
// configured LLM provider, then audits the result. Responses are cached in .cache/ (DEV_CACHE) so re-runs
// after code changes cost no Tavily credits and no LLM quota unless a prompt or query actually changed.
//
//   npx tsx scripts/real-test.ts                 # all rumors + screenshot
//   npx tsx scripts/real-test.ts perfume grant   # a subset (ids below, or "screenshot")
//   MODEL_NANO=nvidia/nemotron-3.5-lightning-30b-a3b npx tsx scripts/real-test.ts   # compare Nano candidates
//   DEV_CACHE=false npx tsx scripts/real-test.ts # bypass the cache
import "./load-env";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

process.env.DEV_CACHE ??= "true";
process.env.OFFLINE_MOCK = "false";

const RUMORS: Record<string, { title: string; text: string }> = {
  perfume: {
    title: "Perfume-sample kidnapping scare",
    text: "Please be careful ladies!!! Some men are standing at filling stations and malls giving women free perfume samples. Once you smell it you will faint and they will kidnap you and harvest your organs. Many women have gone missing. Please share this with every woman you know. Don't take anything from strangers!",
  },
  grant: {
    title: "Free government cash grant scam",
    text: "Good news! The Federal Government is giving N30,000 to every Nigerian as COVID-19 palliative. Click the link below to register and get your money. Share this message to 10 WhatsApp groups to qualify. Hurry, registration closes Friday!",
  },
  "5g": {
    title: "Phones / 5G cause cancer chain",
    text: "Please don't sleep with your phone near your head! Radiation from mobile phones and 5G towers causes brain cancer. The WHO has confirmed it. Keep your phone at least one metre away from your body at night and never charge it in your bedroom. Forward this to everyone you love.",
  },
  martinelli: {
    title: "'Martinelli' video hacks your phone",
    text: "WARNING! If you receive a video called MARTINELLI do not open it. It is a virus that will hack your phone and nothing can stop it, even if it comes from a friend. This has been confirmed by CNN and BBC. Please pass this to everyone in your contact list.",
  },
};

const OUT = path.join(process.cwd(), ".cache", "real-test");

interface Row {
  run: string;
  nodes: number;
  sources: number;
  edges: number;
  conf: string;
  mutations: number;
  grounded: string;
  excerptsStrict: string;
  limited: boolean;
  earliest: string;
  seconds: string;
  calls: number;
  failedCalls: number;
  fallbacks: number;
  costUsd: string;
  ultraOnlyUsd: string;
  warnings: string;
}

async function main() {
  const { RunContext } = await import("../src/lib/llm");
  const { investigate } = await import("../src/lib/investigate");
  const { textToInput } = await import("../src/lib/adapters/text");
  const { fileToInput } = await import("../src/lib/adapters");
  const { summarizeCost } = await import("../src/lib/cost");
  const { canonical } = await import("../src/lib/text");
  const { config, llmAvailable, searchAvailable } = await import("../src/lib/config");

  if (!llmAvailable("nano") || !searchAvailable() || config.offlineMock) throw new Error("Need LLM_API_KEY, MODEL_NANO and TAVILY_API_KEY in .env.local");
  console.log(`LLM: ${config.llm.provider} ${config.llm.baseUrl}\nnano=${config.llm.models.nano}\nsuper=${config.llm.models.super}\nultra=${config.llm.models.ultra}\nvision=${config.llm.models.vision}\ncache=${process.env.DEV_CACHE}\n`);
  await mkdir(OUT, { recursive: true });

  const wanted = process.argv.slice(2);
  const ids = [...Object.keys(RUMORS), "screenshot", "circular"].filter((id) => !wanted.length || wanted.includes(id));
  const rows: Row[] = [];

  for (const id of ids) {
    const ctx = new RunContext((e) => {
      if (e.type === "stage" && /^(A|B|C|D|E|F|G|check)$/.test(e.stage)) process.stdout.write(`  · ${e.message}\n`);
    });
    ctx.pages = new Map();
    console.log(`\n▶ ${id}`);
    const fileCase = id === "screenshot" ? ["screenshot-kemi-reports.png", "image/png"] : id === "circular" ? ["circular-focr.pdf", "application/pdf"] : null;
    const input = fileCase ? await fileToInput(ctx, [{ name: fileCase[0], mime: fileCase[1], buf: await readFile(path.join("fixtures", "files", fileCase[0])) }]) : textToInput(RUMORS[id].text);
    let claimText = input.text;
    if (id === "circular") {
      const { extractClaims } = await import("../src/lib/claims");
      const claims = await extractClaims(ctx, input);
      console.log(`  claims: ${claims.map((c) => `[${c.score.toFixed(2)} ${c.location ?? ""}] ${c.text.slice(0, 70)}`).join("\n          ")}`);
      claimText = claims[0].text;
    }
    if (id === "screenshot") console.log(`  read via: ${input.adapterPath.join(" → ")}\n  text: ${input.text}\n  fields: ${JSON.stringify({ ...input.screenshot, post_text: undefined })}`);
    const inv = await investigate(ctx, input, [{ id: "k0", text: claimText }], { id: `real-${id}` });
    await writeFile(path.join(OUT, `${id}.json`), JSON.stringify(inv, null, 1));
    await writeFile(path.join(OUT, `${id}.pages.json`), JSON.stringify(Object.fromEntries(ctx.pages ?? [])));
    const c = inv.claims[0];
    if (!c) {
      console.log("  ✗ no claim result (pipeline failed)");
      continue;
    }

    // ── Audit 1: do excerpts really appear on the source page? (strict, independent of the pipeline's own check)
    const urls = [...new Set(c.variants.flatMap((v) => v.sources.filter((s) => s.pageType !== "user_input").map((s) => s.url)))];
    const pages = new Map([...(ctx.pages ?? new Map<string, string>())].map(([u, t]) => [u, canonical(t)]));
    let strictOk = 0;
    let strictTotal = 0;
    const badExcerpts: string[] = [];
    for (const v of c.variants)
      for (const s of v.sources) {
        if (s.pageType === "user_input") continue;
        strictTotal++;
        const page = pages.get(s.url);
        if (page && page.includes(canonical(s.excerpt))) strictOk++;
        else badExcerpts.push(`${new URL(s.url).hostname}: ${s.excerpt.slice(0, 90)}`);
      }

    // ── Audit 2: are mutation before/after grounded in the parent/child text?
    const byId = new Map(c.variants.map((v) => [v.id, v]));
    let grounded = 0;
    let groundedTotal = 0;
    for (const e of c.edges)
      for (const m of e.mutations) {
        groundedTotal++;
        const pt = canonical(`${byId.get(e.from)?.text} ${byId.get(e.from)?.excerpt}`);
        const ct = canonical(`${byId.get(e.to)?.text} ${byId.get(e.to)?.excerpt}`);
        const okBefore = !m.before || m.before.split(/,\s*/).every((x) => pt.includes(canonical(x)));
        const okAfter = !m.after || m.after.split(/,\s*/).every((x) => ct.includes(canonical(x)));
        if (okBefore && okAfter) grounded++;
      }

    const cost = summarizeCost(inv.logs, inv.pricing ?? {});
    const conf = { high: 0, medium: 0, low: 0 };
    for (const e of c.edges) conf[e.confidence]++;
    rows.push({
      run: id,
      nodes: c.variants.length,
      sources: urls.length,
      edges: c.edges.length,
      conf: `${conf.high}/${conf.medium}/${conf.low}`,
      mutations: groundedTotal,
      grounded: groundedTotal ? `${grounded}/${groundedTotal}` : "-",
      excerptsStrict: strictTotal ? `${strictOk}/${strictTotal}` : "-",
      limited: c.limited,
      earliest: c.variants.find((v) => v.id === c.earliestId)?.date ?? "-",
      seconds: (inv.totalLatencyMs / 1000).toFixed(1),
      calls: inv.logs.length,
      failedCalls: inv.logs.filter((l) => !l.ok).length,
      fallbacks: inv.logs.filter((l) => l.provider === "heuristic").length,
      costUsd: cost.totalCostUsd.toFixed(4),
      ultraOnlyUsd: cost.ultraOnlyCostUsd.toFixed(4),
      warnings: c.warnings.join(" | "),
    });

    // ── Human audit view
    console.log(`  checks: ${JSON.stringify(Object.fromEntries(Object.entries(inv.checks).map(([k, v]) => [k, v ? { outcome: v.outcome, url: (v as { url?: string }).url, note: v.note } : v])))}`);
    console.log(`  queries: ${c.understanding.queries.join("  ||  ")}`);
    console.log(`  stats: ${JSON.stringify(c.stats)}  limited=${c.limited}  branches=${c.branches.map((b) => b.name).join("; ")}`);
    for (const v of [...c.variants].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999")))
      console.log(`  [${v.id}] ${v.date ?? "undated"} (${v.dateProvenance}) ${v.pageType} ${v.sources.length}src ${v.sources[0] ? new URL(v.sources[0].url.startsWith("http") ? v.sources[0].url : "http://you").hostname : ""} — “${v.excerpt.slice(0, 110).replace(/\s+/g, " ")}”`);
    for (const e of c.edges)
      console.log(`  ${e.from} → ${e.to} [${e.confidence}${e.spreadJump ? ", SPREAD" : ""}] ${e.mutations.map((m) => `${m.type}(${m.before.slice(0, 30)}→${m.after.slice(0, 30)})`).join(" | ") || "no changes"}`);
    if (badExcerpts.length) console.log(`  ✗ excerpts NOT found verbatim on page:\n    ${badExcerpts.join("\n    ")}`);
    console.log(`  verdict: ${c.verdict.summary}\n  reply card (${c.verdict.replyCard.split(/\s+/).length} words): ${c.verdict.replyCard}`);
    console.log(`  unsupported: ${JSON.stringify(c.verdict.unsupported)}`);
    console.log(`  tiers: ${cost.rows.map((r) => `${r.tier}/${r.model.split("/").pop()} ×${r.calls}${r.failed ? ` (${r.failed} failed)` : ""} ${(r.latencyMs / r.calls / 1000).toFixed(1)}s avg`).join(" · ")}`);
  }

  console.log("\n=== SUMMARY ===");
  console.table(rows);
  await writeFile(path.join(OUT, `summary-${(config.llm.models.nano.split("/").pop() ?? "nano").replace(/[^\w.-]/g, "_")}.json`), JSON.stringify(rows, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
