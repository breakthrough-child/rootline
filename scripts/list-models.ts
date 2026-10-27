// Lists NVIDIA/Nemotron models available on the configured provider and suggests MODEL_* values.
// Works with Nebius Token Factory (default) and the NVIDIA API (build.nvidia.com):
//   LLM_API_KEY=... npm run models
//   LLM_BASE_URL=https://integrate.api.nvidia.com/v1 LLM_API_KEY=nvapi-... npm run models
const base = (process.env.LLM_BASE_URL || process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, "");
const key = process.env.LLM_API_KEY || process.env.NEBIUS_API_KEY;

async function main() {
  // Nebius requires a key for /models; NVIDIA's list is public but we send the key when we have one.
  const res = await fetch(`${base}/models?verbose=true`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  if (!res.ok) throw new Error(`${base}/models → ${res.status} ${await res.text()}${key ? "" : " (set LLM_API_KEY)"}`);
  const { data } = (await res.json()) as { data: { id: string; architecture?: { modality?: string }; pricing?: { prompt?: string; completion?: string } }[] };
  const nvidia = data.filter((m) => /nvidia|nemotron|parakeet|canary|whisper/i.test(m.id) && !/embed|safety|reward|guard|retriever|parse/i.test(m.id));
  console.log(`Provider: ${base}\n`);
  console.table(nvidia.map((m) => ({ id: m.id, modality: m.architecture?.modality ?? "", in$per1M: m.pricing?.prompt ? Number(m.pricing.prompt) * 1e6 : "", out$per1M: m.pricing?.completion ? Number(m.pricing.completion) * 1e6 : "" })));
  const pick = (...res: RegExp[]) => res.map((re) => nvidia.find((m) => re.test(m.id) && !/-fast$/.test(m.id))?.id).find(Boolean) ?? "";
  console.log("\nSuggested .env.local values (verify before use):");
  console.log(`MODEL_NANO=${pick(/nemotron-?3-nano-30b|nemotron-nano-3-30b/i, /lightning/i)}`);
  console.log(`MODEL_SUPER=${pick(/nemotron-3-super-120b/i, /super(?!-vl)/i)}`);
  console.log(`MODEL_ULTRA=${pick(/nemotron-3-ultra-550b/i, /ultra/i)}`);
  console.log(`MODEL_VISION=${pick(/super-vl/i, /vl|omni|vision/i)}`);
  console.log(`MODEL_ASR=${pick(/parakeet|canary|whisper/i)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
