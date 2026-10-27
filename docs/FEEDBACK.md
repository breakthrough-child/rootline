# Feedback: Nebius Token Factory, Nemotron, NVIDIA speech/vision, Nebius Serverless, Tavily

Collected while building Rootline (Oct 27–30, 2026). Each item says what we hit, where, and what would have helped. Items marked **[pre-key]** were found from the public docs before we had an API key; **[live]** items come from real calls.

> Honest status: at the time of writing, the build was done without API keys in the build environment, so the live-call sections (latency, JSON reliability, model behaviour) are not filled in yet. Add them after `npm run fixtures` with real keys — see the TODOs below. Nothing here is invented.

## Nebius Token Factory

1. **[pre-key] No public model catalogue in the docs.** The inference overview links to "the full list of available models" on the (JS-rendered, login-gated) console, and the API reference shows `GET /v1/models` with Llama examples only. To find Nemotron IDs we had to read `nebius/token-factory-cookbook/models/nemotron/*.md` on GitHub. A static, crawlable table of model IDs, modalities, context and prices in the docs would save every hackathon team this detour.
2. **[pre-key] Inconsistent model-ID casing for the same family.** The cookbook README links `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` while the model page's code uses `nvidia/nvidia-nemotron-3-nano-30b-a3b`; Super is `nvidia/nemotron-3-super-120b-a12b` (lowercase) but Ultra is `nvidia/Nemotron-3-Ultra-550b-a55b` (mixed case), and Lightning uses an underscore (`nvidia/Nemotron-3_5-Lightning`). If IDs are case-sensitive, this is a guaranteed 404 for someone. Either normalise IDs or accept case-insensitive matches.
3. **[pre-key] Two base URLs, documented inconsistently.** Docs and most integrations use `https://api.tokenfactory.nebius.com/v1/`; the marketing page's snippet uses `https://api.tokenfactory.nebius.com` (no `/v1`); the Nemotron 3 Nano Omni example uses a regional host `https://api.tokenfactory.us-central1.nebius.com/v1/`. Nothing explains when a regional host is required. We had to add a separate `NEBIUS_VISION_BASE_URL` just in case.
4. **[pre-key] Availability tier is unclear per model.** Nebius' Nemotron page lists Nemotron 3 Nano Omni as dedicated-endpoint-only with no price, while the cookbook shows it called on the shared API. A "serverless / dedicated-only" column in the catalogue would prevent wasted integration time.
5. **[pre-key] Deprecations are hard to find.** A third-party repo mentions Token Factory retiring the Nano and Super serverless IDs on Nov 9, 2026 in favour of Nemotron 3.5 Lightning / Super VL. We found no deprecation page in the docs. For anyone building on Nano during this hackathon, that is critical. A `/deprecations` page plus a `deprecation` field in `/v1/models` would help.
6. **[pre-key] Super pricing.** The Nemotron pricing page lists Nemotron 3.5 Super VL ($0.30 / $0.90 per 1M) but not Nemotron 3 Super 120B, which the cookbook features. We default the routing panel to the Super VL price and make it overridable.
7. **[pre-key] No speech endpoint.** Docs cover chat completions, embeddings and image generation, but there is no `/v1/audio/transcriptions` and no NVIDIA speech model (Parakeet/Canary) in the docs. For apps serving WhatsApp users, voice notes are a primary input. We built an ASR provider interface and documented deploying Parakeet NIM / a Whisper server on a Nebius endpoint instead.
8. **[pre-key] Structured output docs are good.** The JSON page is clear and its tip — put the schema in the prompt *and* in `response_format` — is practical. It would help to state per model whether `json_schema` uses guided decoding or is best-effort, and how reasoning (`<think>`) interacts with JSON mode for Nemotron 3.
9. **[pre-key] Reasoning toggle.** Nemotron 3 models reason by default. We send `chat_template_kwargs: {"enable_thinking": false}` (the vLLM convention) for structured calls and retry without it on HTTP 400. The docs don't say whether Token Factory supports this parameter for Nemotron; one line per model on how to turn reasoning off and on would help.
10. **TODO [live]:** p50/p95 latency per tier from our routing logs; JSON validity rate before and after retry per stage; any 429s at `MODEL_CONCURRENCY=6`; time to first token on Ultra; `usage` field accuracy.

## NVIDIA Nemotron (model behaviour)

- **TODO [live]:** whether Nano follows the "copy the excerpt character-for-character" instruction (we measure this: every excerpt is checked against the page and the rejection rate is visible in logs); whether Ultra respects "do not add nodes" (validated, fallback counted); tone of Super's reply cards; Pidgin translation quality.

## NVIDIA vision / speech models

- **[pre-key]** Unclear which NVIDIA VLM is serverless on Token Factory (Super VL vs Nano Omni), and under what exact ID. `npm run models` in this repo filters `/v1/models` for NVIDIA models to make this quick.
- **TODO [live]:** screenshot field extraction accuracy vs Tesseract fallback on the fixture screenshot.

## Nebius Serverless / AI Cloud

- **TODO:** steps and friction deploying Parakeet NIM (NGC auth, GPU type, cold start). If not attempted before the deadline, say so here.

## Tavily

1. **[pre-key] Clear, complete docs.** Parameter tables, error codes and limits (20 URLs per extract, `failed_results` returned on HTTP 200) were all where we expected. The `exact_match` flag is a great fit for tracing verbatim phrases.
2. **[pre-key] `published_date` semantics.** The docs say it is "Tavily's best estimate of when the source was published or last updated" and can be later than the original date. For provenance-sensitive apps, separate `published_date` and `last_updated` fields (or a `date_source` hint) would be valuable; today we have to label both as "reported by the source".
3. **[pre-key] Extract + query.** `query` + `chunks_per_source` on `/extract` reduces the text we send to Nano; it would help to document the max total characters returned per URL.
4. **TODO [live]:** recall for verbatim quoted phrases vs paraphrases; how often `published_date` was present; latency per call.

## Developer environment note (not a vendor issue)

On our Ubuntu machine, Node 22's "happy eyeballs" (`autoSelectFamily`) timed out against registry.npmjs.org while `curl` worked; `NODE_OPTIONS=--no-network-family-autoselection` fixed both `npm install` and outbound `fetch`. Worth knowing if Token Factory or Tavily calls time out locally but work with curl.
