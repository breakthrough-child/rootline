# Feedback: Nebius Token Factory, NVIDIA Nemotron, Nebius Serverless and Tavily

Gathered while building Rootline (Oct 27–30, 2026). Every item says how we know it:

- **[measured]**: we hit it in real calls (NVIDIA's hosted API or Tavily), with numbers from our run logs.
- **[docs]**: from reading public documentation only; **we did not test it**.
- **[blocked]**: we could not try it.

> **Important context.** We were **not able to use Nebius Token Factory at all**: our billing country is not supported, so account creation/billing was blocked. Everything marked [measured] for Nemotron comes from **NVIDIA's hosted API (build.nvidia.com)**, which serves the same model family. A teammate with access will run the Token Factory checks (`npm run verify-nebius`) and this file should be amended with those results. Nothing here is invented.

## Nebius Token Factory

1. **[blocked] Billing-country restriction.** We could not sign up/pay from our country. This was the single biggest blocker for a global hackathon whose required platform is Token Factory. Suggestions: show supported billing countries *before* account creation; offer hackathon credits that bypass the billing-country check; say so in the hackathon brief.
2. **[docs] No crawlable model catalogue.** The inference overview points to the console's model list (JS-rendered, login-gated); the API reference shows `GET /v1/models` with Llama examples only. We found Nemotron IDs only by reading `nebius/token-factory-cookbook/models/nemotron/*.md` on GitHub. A static table of model IDs, modalities, context, price and "serverless vs dedicated-only" would save every team an hour.
3. **[docs] Inconsistent model-ID casing for the same family:** `nvidia/Nemotron-3-Ultra-550b-a55b` (mixed case), `nvidia/nemotron-3-super-120b-a12b` (lowercase), `nvidia/Nemotron-3_5-Lightning` (underscore), and the cookbook README vs the model page disagree on Nano's ID. If IDs are case-sensitive this is a guaranteed 404 for someone.
4. **[docs] Two base URLs shown:** `https://api.tokenfactory.nebius.com/v1/` (docs, most integrations), the same host without `/v1` (marketing snippet), and a regional host (`api.tokenfactory.us-central1.nebius.com/v1/`) in the Nano-Omni example. Nothing explains when the regional host is required.
5. **[docs] Vision model ID not published.** Nebius' Nemotron pricing page lists "NVIDIA Nemotron 3.5 Super VL" but the cookbook has no ID for it; Nano-Omni is "dedicated-only" with no price. We did not guess an ID: our `verify-nebius` script discovers candidates from `/v1/models`.
6. **[docs] Deprecations.** A third-party repo mentions Nano/Super serverless IDs being retired on Nov 9, 2026; we found no deprecation page. For anyone building during the hackathon this matters.
7. **[docs] No speech endpoint.** The documented surface is chat completions (plus embeddings/images); no `/v1/audio/transcriptions` and no NVIDIA speech model in the docs. For apps serving WhatsApp users (voice notes) that is a gap; our voice/video feature is therefore behind a flag that needs an external speech endpoint, and is untested.
8. **[docs] Structured output** page is clear (schema in the prompt *and* `response_format`). Please state per model whether `json_schema` is guided decoding or best-effort, and how reasoning interacts with JSON mode for Nemotron 3.
9. **[docs] How to turn reasoning off.** See the NVIDIA finding below: the toggle we rely on (`chat_template_kwargs.enable_thinking`) is a vLLM convention; please document whether Token Factory supports it per Nemotron model. Rootline auto-drops it on HTTP 400.

## NVIDIA hosted API (build.nvidia.com), same Nemotron family

1. **[measured] `/v1/models` lists models a key cannot call.** `nvidia/nemotron-nano-3-30b-a3b`, `nvidia/nemotron-3-super-120b-a12b` and four older Nemotron instruct models are listed but return `404 {"detail":"Function '…': Not found for account '…'"}`. Callable for us: Lightning 30B-A3B, Super-VL 120B-A12B, Ultra 550B, Nano-Omni 30B (reasoning), Bolt-e4b. The error body is an opaque function id; a "model not enabled for your account" message and a `/models` filter for what the key can invoke would have saved an hour (we built `npm run probe`).
2. **[measured] Thinking is on by default and costly.** Without `chat_template_kwargs:{"enable_thinking":false}`, a ~40-token JSON answer used 478–600 completion tokens and took 3–13 s on Lightning, Nano-Omni and Super-VL; Ultra put its reasoning *inside `content`* (no `reasoning_content` split), which corrupts naive JSON parsing. With the toggle: 26–35 tokens, 0.8–3.4 s. This belongs in every Nemotron 3.x model card. `response_format: {"type":"json_object"}` worked on all callable models.
3. **[measured] Rate limits.** The free tier returned `429 Too Many Requests` (no `Retry-After`) at about 40 requests/min and, under bursts, `503 ResourceExhausted: Worker local total request limit reached (16/16)`. Even a client-side throttle of 35/min still saw occasional 429s, so we retry with backoff and default to 30/min. Publishing numeric limits per model would help. We also saw sporadic `fetch failed` connection drops and one 61 s queueing delay on Ultra.
4. **[measured] Latency (successful calls, our real runs):** Lightning p50 3.6 s / p95 12.8 s (n=235; p95 includes provider queueing); Super-VL p50 2.6 s / p95 4.2 s (n=11); Ultra p50 14.3 s / p95 18.5 s (n=6); vision (Super-VL, one screenshot) 5.8 s. Nano-Omni with thinking off: p50 5.7 s / p95 19.9 s. Bolt-e4b: p50 3.4 s / p95 5.0 s.
5. **[measured] Behaviour of the small model (Lightning).** (a) Asked to copy an excerpt or evidence phrase "character-for-character", it often echoed the *instruction text* or stitched passages; it was reliable when it only had to answer with **sentence numbers** from a numbered list, so Rootline's quotes are verbatim by construction. (b) It over-accepted topical pages (health explainers, shop pages) as "the same message". (c) JSON was truncated at the output limit about 3 times per run before we raised the retry budget. (d) Hand-scored change labels were mostly wrong without validation (see `docs/PROGRESS.md` for the numbers). (e) Ultra's refined lineage trees were sometimes invalid (unknown/duplicate parent, parent dated after child), so we repair them edge by edge instead of discarding them. (f) Bolt-e4b paraphrased instead of quoting and, end to end, missed a 2018 origin that Lightning found.
6. **[measured] Vision works well.** Super-VL read a screenshot's handle, display name, timestamp, engagement counts and post text exactly on the first try (5.8 s).
7. **[measured] Model IDs differ between NVIDIA and Nebius for the same weights** (case and word order, e.g. `nemotron-nano-3-30b-a3b` vs `nvidia-nemotron-3-nano-30b-a3b`), so "switch provider" needs a different `MODEL_*` set, not just a base URL.

## Nebius Serverless / AI Cloud

- **[blocked]** We did not deploy Parakeet/Canary or Whisper on a Serverless endpoint (no access). Our speech support is an OpenAI-compatible endpoint hook behind a feature flag, untested.

## Tavily [measured]

1. **Docs were clear and complete** (parameter tables, error codes, 20 URLs per extract, `failed_results` on HTTP 200). `exact_match` fits tracing verbatim phrases.
2. **`published_date` semantics.** It is documented as "best estimate of when the source was published or last updated". We saw it on only **46% of 729 search results**. For provenance-sensitive apps, separate `published_date` / `last_updated` fields or a `date_source` hint would help; today we label it "reported by the source".
3. **Extraction coverage.** `/extract` failed for **190 of 576 URLs**: Facebook alone 91, then africacheck.org, reddit, instagram, quora. We fall back to the search snippet, which is stitched with "…", so we split on those to keep quotes verbatim.
4. **Search quality.** Quoted distinctive phrases found real copies of a message; paraphrase queries more often returned general explainers (qualitative impression, not measured).
5. **Latency:** search p50 about 2–3 s; extract of up to 20 URLs about 7–10 s.
6. **Credits.** One fresh live trace costs about 16–20 credits (8 searches + about 8 for extracting 40 pages); our whole test campaign used about 190–260 of 1,000. A remaining-credits response header (and `include_usage` on by default) would help budget-conscious demos; we estimate instead.

## Developer environment (not a vendor issue)

On our Ubuntu machine, Node 22's "happy eyeballs" (`autoSelectFamily`) timed out against registry.npmjs.org and some APIs while `curl` worked; `NODE_OPTIONS=--no-network-family-autoselection` fixed both `npm install` and outbound `fetch`. Worth knowing if Token Factory or Tavily calls time out locally but work with curl.
