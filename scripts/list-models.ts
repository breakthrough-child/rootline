// Lists models available to your Nebius Token Factory key and suggests MODEL_* env values.
//   NEBIUS_API_KEY=... npx tsx scripts/list-models.ts
const base = (process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, "");

async function main() {
  if (!process.env.NEBIUS_API_KEY) throw new Error("Set NEBIUS_API_KEY");
  const res = await fetch(`${base}/models?verbose=true`, { headers: { Authorization: `Bearer ${process.env.NEBIUS_API_KEY}` } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const { data } = (await res.json()) as { data: { id: string; architecture?: { modality?: string }; pricing?: { prompt?: string; completion?: string } }[] };
  const nvidia = data.filter((m) => /nvidia|nemotron|parakeet|canary|whisper/i.test(m.id));
  console.table(nvidia.map((m) => ({ id: m.id, modality: m.architecture?.modality ?? "", in$per1M: m.pricing?.prompt ? Number(m.pricing.prompt) * 1e6 : "", out$per1M: m.pricing?.completion ? Number(m.pricing.completion) * 1e6 : "" })));
  const pick = (re: RegExp) => nvidia.find((m) => re.test(m.id) && !/-fast$/.test(m.id))?.id ?? "";
  console.log("\nSuggested .env.local values (verify before use):");
  console.log(`MODEL_NANO=${pick(/nano-30b|lightning/i)}`);
  console.log(`MODEL_SUPER=${pick(/super-120b/i) || pick(/super/i)}`);
  console.log(`MODEL_ULTRA=${pick(/ultra-550b/i) || pick(/ultra/i)}`);
  console.log(`MODEL_VISION=${pick(/vl|omni|vision/i)}`);
  console.log(`MODEL_ASR=${pick(/parakeet|canary|whisper/i)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
