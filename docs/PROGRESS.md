# Progress

_Last updated: 2026-10-28_

**Provider:** the LLM client is provider-agnostic. Nebius Token Factory is the documented default; while Token Factory access is blocked by its billing-country restriction, develop against NVIDIA's API (build.nvidia.com) by setting `LLM_BASE_URL`, `LLM_API_KEY` and the `MODEL_*` IDs (see README → "Switching LLM providers"). Switching back is env-only.

## Status by tier

| Tier | Scope | Status |
|---|---|---|
| 1 · Core | text → pipeline (A–G) → animated tree → summary → reply card → routing panel → demo replay → deploy | **Works on real data** (NVIDIA API, real Tavily). Deploy pending your Vercel login ([guide](DEPLOY_VERCEL_NVIDIA.md)). |
| 2 · Screenshots | upload / drag-drop / clipboard paste, VLM or OCR path, "Does this post exist?" | **Works on real data.** VLM path (Nemotron 3.5 Super VL) read handle/name/timestamp/engagement exactly; post-exists check returned `not_found`. OCR path tested offline. |
| 3 · Voice notes | ASR interface, transcript review with clickable timestamps, cleanup + translation | **Code complete.** Needs `MODEL_ASR` or `ASR_ENDPOINT_URL`. No recording bundled for fixture 4 (see below). |
| 4 · PDF + DOCX | text layer, scanned PDF → vision/OCR, "Is this official?", claim selection, doc viewer | **Works on real data** for the fake circular (`no_official_record_found`; claims now full sentences). Parsers unit-tested. |
| 5 · Watchlist + share pages | `/watchlist`, re-run with "new since last run", `/r/[id]` | **Code complete.** Supabase or local-JSON fallback. |
| 6 · Video | ffmpeg audio → ASR, keyframes → vision/OCR, merge | **Code complete.** Not yet exercised end-to-end on a real video. |
| 7 · XLSX + PPTX | SheetJS labeled cells + notes, OOXML slides + speaker notes | **Code complete, parsers tested.** |

## Real-data test (NVIDIA API + real Tavily, 2026-10-28)

Run with `npm run real-test` (responses cached in `.cache/` via `DEV_CACHE`; ~190 of 1,000 Tavily credits were used in total — a fresh live trace costs ~16–20 credits). Models: Nano = `nemotron-3.5-lightning-30b-a3b`, Super/Vision = `nemotron-3.5-super-vl-120b-a12b`, Ultra = `nemotron-3-ultra-550b-a55b`.

| Case | Versions found | Edges (high/med/low) | Mutation labels | Excerpts verbatim | Earliest found | Cost* (all-Ultra*) | Notes |
|---|---|---|---|---|---|---|---|
| **Martinelli** WhatsApp hoax | 12 (15 sources) | 1 / 4 / 6 | 15 (11 correct on hand audit) | 15/15 | 2018-04-17 (Snopes, "An Garda") | $0.0097 ($0.074, 7.6×) | richest tree: An Garda → "IT colleague" + "Spread the word" → BBC-radio version → WhatsApp Gold → your "CNN and BBC" |
| **Perfume** kidnapping | 9 (9) | 0 / 1 / 8 | 9 (grounded) | 9/9 | 2001-11-03 (Snopes: *mailed* poisoned samples) | $0.0089 ($0.073, 8.3×) | strong story (2001 mailed poison → malls/filling stations/kidnap) but most edges are cross-story → low confidence, few mutations |
| **Screenshot** (fictional @kemi_reports_247) | 6 (6) | 0 / 1 / 5 | 13 (grounded) | 6/6 | 2023-03-31 | $0.0068 ($0.048, 7.0×) | vision read all fields exactly (5.8 s); **post-exists → `not_found`** ✔ |
| **Grant** ("FG N30,000 palliative") | 3 (3) | 1 / 1 / 1 | 14 (grounded) | 3/3 | 2020-07-07 (Daily Trust) | $0.0081 ($0.080, 10×) | thin: this wording is only covered by a few debunks |
| **5G / phones cause cancer** | 2 (2) | 0 / 0 / 2 | 0 | 2/2 | – | $0.0085 | correctly **limited**: a general science claim, not a discrete message chain (explainer pages are rejected) |
| **Fake circular** (PDF, fictional org) | 2 (2) | 0 / 0 / 2 | 0 | 2/2 | – | $0.0057 | `no_official_record_found` ✔; limited family; no unsupported claim cited |

\* Cost = logged tokens × Nebius Token Factory list prices (the NVIDIA API was used for the run); "all-Ultra" re-prices the same tokens at Ultra rates. Latency (successful calls): Nano p50 3.6 s / p95 12.8 s (n=235), Super p50 2.6 s, Ultra p50 14.3 s (n=6), Vision 5.8 s. A fresh live trace takes ~1–2.5 min on NVIDIA's free tier because Rootline throttles to 35 req/min; 41–58 model calls per trace ⇒ ≥ 70–100 s at that rate. Without the throttle (Nebius) the critical path is roughly 60–80 s (estimate, not measured).

**What real data exposed, and what was fixed**

| Problem seen | Fix |
|---|---|
| `nemotron-nano-3-30b-a3b` and `nemotron-3-super-120b-a12b` are *listed* by NVIDIA but return `404 Function not found for account` for this key → every Nano call failed silently | `npm run probe` (calls every model); `.env.local` model IDs corrected; fallbacks now record *why* |
| Default Nemotron 3.x "thinking" burns 400–600 tokens and 3–13 s per call | `enable_thinking:false` verified on all callable models (already sent; auto-dropped on HTTP 400) |
| 429/503 under parallel load on the free API | shared throttle (`LLM_RPM`, 35 on NVIDIA), 5 retries with backoff/Retry-After |
| Truncated JSON (`unterminated JSON`) silently dropped pages | retry now doubles the output budget |
| Excerpts not verbatim (ellipses, stitched passages, trailing "…") | strict check + snap-to-page; no `…` appended; unverifiable ⇒ page rejected (audit: 100% verbatim on all runs) |
| Junk "versions" (TikTok hashtags, Reddit threads, health explainers, shop pages) | evidence-based membership: ≥2 message elements, each quoted from the page and verified in code; "circulating message" marker gate; ≥8-word excerpts; relevance pre-filter (saves ~40% of Nano calls) |
| Mutation labels like `number_changed(seven women died → a person)`, `authority_added("Click the link below")` | exact label definitions in the prompt + code validation: text must appear in parent/child *and* fit the label type; rule-based fallback held to the same validator (audit: 100% grounded; ~73% semantically correct on a 15-label hand audit — remaining slips are e.g. a "call to action" that describes scammer behaviour) |
| Overconfident edges (2001 → 2026 "high") and "wider spread" with no data | confidence capped by wording similarity; spread flag needs ≥3 *dated* later sources |
| Ultra's tree rejected whole → silent baseline | `repairTree`: keep every valid Ultra parent, repair only the broken ones |
| Fact-check of a *different* rumor cited as contradicting a claim | a source contradicts only if it speaks to the statement's specifics (names, numbers) |
| Document claims were fragments ("Lassa variant X outbreak") | claims must be full sentences (≥8 words); limited family with no evidence ⇒ plain honest verdict |
| Tesseract wrote `eng.traineddata` into the read-only working dir (breaks on Vercel) | cache path = temp dir |

**Nano-tier decision.** `nemotron-nano-3-30b-a3b` could not be tested (404 for this account). Compared on the Martinelli membership stage and end to end: Lightning (30B-A3B) vs Nano-Omni-30B (thinking off) vs Bolt-e4b. Models agree on ~11 of 15 accepted pages (differences are borderline pages). Nano-Omni is slower (p50 5.7 s, p95 19.9 s). Bolt has similar p50 (3.4 s) and better p95 but end to end **missed the 2018 Snopes origin** (earliest 2020), found fewer versions (9 vs 12) and fewer mutations (12 vs 21). **Decision: Lightning for the Nano tier** (small sample; the margin is not statistically strong, but "earliest version found" is the core promise).

**Demo recommendation (richest and most accurate trees on real data)**
1. **WhatsApp "Martinelli" warning** — 12 versions across 2018–2026 with real mutations (An Garda → "IT colleague", "Spread the word", the BBC-radio version, WhatsApp Gold, your copy's "CNN and BBC"), 15/15 verbatim excerpts, the only case with high-confidence edges. Not Nigeria-specific, but it is the cleanest demonstration of the product.
2. **Perfume-sample kidnapping** (paste, then the screenshot variant) — the most striking origin story (a 2001 email about *mailed* poisoned samples became filling-station kidnappings) and it is the Nigeria-relevant one. Show it as a screenshot to get the **"No evidence this post exists"** moment (vision read verified). Expect mostly low-confidence edges: say so on camera, it supports the honesty message.
3. **The fake circular** — for the **"No official record found"** beat only (limited family, no cited contradiction). Don't present its tree.
Avoid as headline demos: **5G/cancer** (a general science topic, correctly "limited") and the **generic grant text** (only 3 versions). If you want a stronger scam demo, test a specific Nigerian forward (exact amount/agency wording) with `npm run real-test` first.

## Verified in this build

- `npm run lint`, `npm run typecheck`, `npm test` (68 tests) and `npm run build` pass.
- Real APIs exercised: NVIDIA chat completions (4 models + vision), Tavily search/extract, Supabase (server round-trips; anon key blocked by RLS).
- Browser-checked earlier (offline fixtures): replay, tree, node panel (desktop + 375 px), dark/light, share page, Watchlist add + re-run.
- **Not verified:** the new real-data results in the browser UI (checked via JSON/logs and audits only); video adapter on a real clip; voice-note ASR; Vercel deployment; Nebius Token Factory itself (no account access); Supabase-backed share page in the UI.

## Blocked on you

- **Nebius Token Factory**: still the hackathon requirement. A teammate with access follows [TEAMMATE_DEPLOY.md](TEAMMATE_DEPLOY.md) (own key, never shared), runs `npm run fixtures` against Nebius and deploys. The committed fixtures were generated offline against a fictional corpus (labelled in the UI); `npm run fixtures` now also adds a live-only "Martinelli" demo.
- **Vercel deploy** and **GitHub repo creation** need your login (commands in README / final summary).
- **Voice-note fixture**: no TTS was available in the build environment, so fixture 4 uses the transcript text. Record a short clip of yourself (or a clearly synthetic voice) reading `fixtures/files/voice-note-transcript.txt` and save it as `fixtures/files/voice-note.ogg`.

## Cut / deferred

- Supabase magic-link auth (Watchlist is shared per deployment).
- Nebius Serverless deployment of Parakeet NIM was documented, not performed (needs NGC + Nebius accounts).
- Media processing on a Nebius job for long videos (Vercel function limits apply; ≤3 min videos only).
