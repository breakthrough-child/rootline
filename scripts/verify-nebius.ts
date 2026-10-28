// One command to check a Rootline deployment's environment against Nebius Token Factory (or any configured provider):
//   npm run verify-nebius
// 1. config sanity  2. /v1/models  3. a tiny request to every configured model (and an image to the vision model)
// 4. one small END-TO-END trace on the real web  5. a PASS / WARN / FAIL checklist. Exit code 1 if anything FAILs.
// Uses ~10–14 Tavily credits and a few cents of tokens. It never prints keys.
import "./load-env";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Keep the end-to-end trace small and uncached so it measures the real thing.
process.env.DEV_CACHE = "false";
process.env.OFFLINE_MOCK = "false";
process.env.MAX_QUERIES ||= "5";
process.env.MAX_CANDIDATE_PAGES ||= "14";
process.env.MAX_PAIRS ||= "12";

type Status = "PASS" | "WARN" | "FAIL" | "SKIP";
const rows: { status: Status; item: string; detail: string }[] = [];
const add = (status: Status, item: string, detail = "") => {
  rows.push({ status, item, detail });
  const icon = { PASS: "✅", WARN: "⚠️ ", FAIL: "❌", SKIP: "⏭️ " }[status];
  console.log(`${icon} ${status.padEnd(4)}  ${item}${detail ? `  — ${detail}` : ""}`);
};

const TINY_RUMOR =
  "WARNING! If you receive a video called MARTINELLI do not open it. It is a virus that will hack your phone and nothing can stop it, even if it comes from a friend. This has been confirmed by CNN and BBC. Please pass this to everyone in your contact list.";

async function main() {
  const { config, llmAvailable, searchAvailable } = await import("../src/lib/config");
  const { RunContext, chat } = await import("../src/lib/llm");
  const { summarizeCost } = await import("../src/lib/cost");
  const { canonical } = await import("../src/lib/text");

  console.log(`\nRootline environment check\n  provider: ${config.llm.provider}   base URL: ${config.llm.baseUrl}\n`);

  // ── 1. config ──────────────────────────────────────────────────────────────
  add(config.llm.apiKey ? "PASS" : "FAIL", "LLM_API_KEY is set", config.llm.apiKey ? "" : "put your Token Factory key in .env.local");
  add(config.tavily.apiKey ? "PASS" : "FAIL", "TAVILY_API_KEY is set");
  add(config.llm.provider === "nebius" ? "PASS" : "WARN", "Provider is Nebius Token Factory", config.llm.provider === "nebius" ? "" : `LLM_BASE_URL points at "${config.llm.provider}"; the hackathon requires Token Factory (https://api.tokenfactory.nebius.com/v1)`);
  for (const t of ["nano", "super", "ultra"] as const) add(config.llm.models[t] ? "PASS" : "FAIL", `MODEL_${t.toUpperCase()} is set`, config.llm.models[t]);
  add(config.llm.models.vision ? "PASS" : "WARN", "MODEL_VISION is set", config.llm.models.vision || "empty: screenshots will use the Tesseract OCR fallback");
  if (!config.llm.apiKey || !config.tavily.apiKey || !config.llm.models.nano) {
    console.log("\nFix the FAIL items above and run again.");
    process.exit(1);
  }

  // ── 2. model list ──────────────────────────────────────────────────────────
  let available: string[] = [];
  try {
    // retry transient connection drops (seen as "fetch failed" on some networks)
    let res: Response | undefined;
    for (let n = 0; n < 3 && !res; n++) {
      try {
        res = await fetch(`${config.llm.baseUrl}/models`, { headers: { Authorization: `Bearer ${config.llm.apiKey}` }, signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        if (n === 2) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (n + 1)));
      }
    }
    if (!res) throw new Error("no response");
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
    available = ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id);
    add("PASS", "GET /models works", `${available.length} models visible to this key`);
  } catch (e) {
    add("FAIL", "GET /models works", (e as Error).message);
  }
  const nemotron = available.filter((id) => /nemotron/i.test(id) && !/embed|safety|reward|guard|retriever|parse|content/i.test(id));
  if (nemotron.length) console.log(`        Nemotron models on this key: ${nemotron.join(", ")}`);

  // ── 3. each model answers ─────────────────────────────────────────────────
  const failedTiers: string[] = [];
  for (const tier of ["nano", "super", "ultra"] as const) {
    const id = config.llm.models[tier];
    if (available.length && !available.includes(id)) add("WARN", `${id} is listed by /models`, "not in the list — check case and spelling");
    const ctx = new RunContext();
    const t0 = Date.now();
    try {
      const out = await chat(ctx, { tier, stage: "verify", maxTokens: 40, timeoutMs: 90_000, json: true, messages: [{ role: "user", content: 'Reply with exactly this JSON and nothing else: {"ok": true}' }] });
      const good = /"ok"\s*:\s*true/.test(out.text);
      add(good ? "PASS" : "WARN", `${tier} model answers (${id})`, `${((Date.now() - t0) / 1000).toFixed(1)}s${good ? "" : `, unexpected reply: ${out.text.slice(0, 60)}`}`);
    } catch (e) {
      failedTiers.push(tier);
      add("FAIL", `${tier} model answers (${id})`, String((e as Error).message).slice(0, 160));
    }
  }
  if (config.llm.models.vision) {
    const ctx = new RunContext();
    try {
      const png = await readFile(path.join("fixtures", "files", "screenshot-kemi-reports.png"));
      const out = await chat(ctx, {
        tier: "vision",
        stage: "verify",
        maxTokens: 200,
        timeoutMs: 90_000,
        messages: [{ role: "user", content: [{ type: "text", text: "What is the account handle shown in this image? Reply with the handle only." }, { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }] }],
      });
      add(/kemi_reports_247/i.test(out.text) ? "PASS" : "WARN", `vision model reads an image (${config.llm.models.vision})`, /kemi_reports_247/i.test(out.text) ? "read the handle correctly" : `answered: ${out.text.slice(0, 60)}`);
    } catch (e) {
      add("FAIL", `vision model reads an image (${config.llm.models.vision})`, String((e as Error).message).slice(0, 160));
    }
  } else {
    const cands = available.filter((id) => /vl\b|-vl|omni|vision/i.test(id));
    add("SKIP", "vision model", cands.length ? `candidates on your key: ${cands.join(", ")} — set MODEL_VISION to one and re-run` : "no vision-capable model found on this key; OCR fallback will be used");
  }

  // ── 4. end-to-end trace ───────────────────────────────────────────────────
  if (failedTiers.length) {
    add("SKIP", "end-to-end trace", `skipped: fix the failing model(s) first (${failedTiers.join(", ")}); run \`npm run probe\` for alternatives`);
  } else if (!searchAvailable() || !llmAvailable("nano")) {
    add("SKIP", "end-to-end trace", "configuration incomplete");
  } else {
    console.log("\n  Running one small end-to-end trace on the real web (about 1–3 minutes)…");
    const { investigate } = await import("../src/lib/investigate");
    const { textToInput } = await import("../src/lib/adapters/text");
    const ctx = new RunContext();
    ctx.pages = new Map();
    const input = textToInput(TINY_RUMOR);
    const t0 = Date.now();
    try {
      const inv = await investigate(ctx, input, [{ id: "k0", text: input.text }]);
      const c = inv.claims[0];
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      add(c ? "PASS" : "FAIL", "pipeline completed", `${secs}s, ${inv.logs.length} calls`);
      if (c) {
        const relatives = c.variants.filter((v) => !v.isUserInput);
        add(relatives.length >= 3 ? "PASS" : "WARN", "found related versions", `${relatives.length} found (≥3 expected for this well-known hoax)${c.limited ? "; family flagged as limited" : ""}`);
        const pages = new Map([...ctx.pages].map(([u, t]) => [u, canonical(t)]));
        const srcs = relatives.flatMap((v) => v.sources);
        const verbatim = srcs.filter((s) => pages.get(s.url)?.includes(canonical(s.excerpt))).length;
        add(srcs.length && verbatim === srcs.length ? "PASS" : "FAIL", "every excerpt is verbatim on its source page", `${verbatim}/${srcs.length}`);
        const dated = relatives.filter((v) => v.date).length;
        add(dated ? "PASS" : "WARN", "dates found with provenance", `${dated}/${relatives.length} versions dated`);
        add(c.edges.length === c.variants.length - 1 ? "PASS" : "FAIL", "tree is a valid tree", `${c.variants.length} nodes, ${c.edges.length} edges`);
        add(c.verdict.replyCard.split(/\s+/).length < 60 ? "PASS" : "WARN", "reply card is under 60 words", `${c.verdict.replyCard.split(/\s+/).length} words`);
        const strong = c.edges.flatMap((e) => e.mutations).filter((m) => m.strength === "strong").length;
        add("PASS", "detected changes", `${strong} strong, ${c.edges.flatMap((e) => e.mutations).length - strong} weaker (informational)`);
      }
      const llmCalls = inv.logs.filter((l) => l.provider === config.llm.provider);
      const failed = llmCalls.filter((l) => !l.ok);
      add(failed.length === 0 ? "PASS" : "FAIL", "no failed model calls", `${llmCalls.length} calls, ${failed.length} failed${failed[0] ? `: ${failed[0].note}` : ""}`);
      const fb = inv.logs.filter((l) => l.provider === "heuristic");
      add(fb.length === 0 ? "PASS" : "WARN", "no stage fell back to rule-based logic", fb.length ? fb.map((l) => `${l.stage}: ${l.note}`).join("; ").slice(0, 200) : "");
      const cost = summarizeCost(inv.logs, inv.pricing ?? {});
      console.log(`        tokens: ${llmCalls.reduce((a, l) => a + l.tokensIn, 0)} in / ${llmCalls.reduce((a, l) => a + l.tokensOut, 0)} out · est. cost $${cost.totalCostUsd.toFixed(4)} (all-Ultra $${cost.ultraOnlyCostUsd.toFixed(4)})`);
      const byTier = cost.rows.filter((r) => r.calls).map((r) => `${r.tier}×${r.calls} (${r.model.split("/").pop()})`);
      console.log(`        routing: ${byTier.join(" · ")}`);
    } catch (e) {
      add("FAIL", "pipeline completed", String((e as Error).message).slice(0, 200));
    }
  }

  // ── 5. optional pieces ───────────────────────────────────────────────────
  if (config.supabase.url && config.supabase.serviceKey) {
    try {
      const { storageBackend, getInvestigation } = await import("../src/lib/store");
      await getInvestigation("verify-nonexistent");
      add("PASS", "Supabase is reachable", storageBackend());
    } catch (e) {
      add("FAIL", "Supabase is reachable", String((e as Error).message).slice(0, 140) + " (did you run supabase/schema.sql?)");
    }
  } else add("SKIP", "Supabase", "not configured: share links and the Watchlist are temporary");
  add("SKIP", "Voice notes / video", config.asr.enabled ? "ASR_ENDPOINT_URL is set but this script does not test it (untested feature)" : "off (needs ASR_ENDPOINT_URL)");

  // ── summary ──────────────────────────────────────────────────────────────
  const n = (s: Status) => rows.filter((r) => r.status === s).length;
  console.log(`\n══ ${n("FAIL") === 0 ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"} ══  ${n("PASS")} pass · ${n("WARN")} warn · ${n("FAIL")} fail · ${n("SKIP")} skipped`);
  if (n("FAIL")) console.log("Failed: " + rows.filter((r) => r.status === "FAIL").map((r) => r.item).join("; "));
  process.exit(n("FAIL") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
