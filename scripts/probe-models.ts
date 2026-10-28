// Sends a 1-token request to every candidate model on the configured provider, to see which ones your key can really call.
// (A model can be listed by /v1/models yet return 404 "Function not found for account".)
//   npm run probe
import "./load-env";

async function main() {
  const base = (process.env.LLM_BASE_URL || "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, "");
  const key = process.env.LLM_API_KEY || process.env.NEBIUS_API_KEY;
  if (!key) throw new Error("Set LLM_API_KEY");
  const list = (await (await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } })).json()) as { data: { id: string }[] };
  const ids = list.data.map((m) => m.id).filter((id) => /nemotron|parakeet|canary/i.test(id) && !/embed|safety|reward|guard|retriever|parse|content/i.test(id));
  const extra = process.argv.slice(2);
  for (const id of [...new Set([...ids, ...extra])]) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: id, messages: [{ role: "user", content: "Reply with the single word: ok" }], max_tokens: 8, temperature: 0 }),
        signal: AbortSignal.timeout(60_000),
      });
      const t = await res.text();
      let note = "";
      try {
        const j = JSON.parse(t);
        note = res.ok ? `“${(j.choices?.[0]?.message?.content ?? "").trim().slice(0, 20)}”` : `${j.detail ?? j.error?.message ?? t}`.slice(0, 90);
      } catch {
        note = t.slice(0, 90);
      }
      console.log(`${res.ok ? "OK  " : "FAIL"} ${String(res.status).padEnd(4)} ${((Date.now() - t0) / 1000).toFixed(1)}s ${id}  ${note}`);
    } catch (e) {
      console.log(`ERR  ---  ${id} ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
