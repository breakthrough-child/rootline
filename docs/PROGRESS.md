# Progress (final)

_Last updated: 2026-10-29 (after the general-statement fix)_

**What is left is deployment on Nebius Token Factory by a teammate with their own key** (`docs/TEAMMATE_DEPLOY.md`). Everything else is built, tested and committed.

**Provider:** the app is provider-agnostic (env vars only). Our account could not use Nebius Token Factory (billing-country restriction), so all development, measurements and the saved demo runs used **NVIDIA's hosted API** (same Nemotron family). Each saved run states which provider produced it, read from its own call log.

## What works / what is hidden / what was cut

| Area | Status |
|---|---|
| Text forwards, full pipeline (A–G), animated tree, timeline, side panel, summary, reply card (PNG, copy, WhatsApp), routing drawer, replay of saved runs | **Works on real data** (NVIDIA API + real Tavily) |
| Screenshots (vision model read handle/name/timestamp/engagement exactly; OCR fallback) + "Does this post exist?" | **Works on real data** (`not_found` on the fictional account) |
| PDF/DOCX + "Is this official?" + claim selection | **Works on real data** (fake circular → `no_official_record_found`; honest empty family). Scanned PDF + OCR unit-tested |
| XLSX/PPTX | Parsers unit-tested; not run through the full pipeline on real data |
| Watchlist, share pages `/r/[id]` | **Works** (browser-checked with local storage; Supabase server round-trips verified, RLS blocks the public key) |
| Detected changes: copies only, strong first, weaker behind a toggle, Super review pass | **Works; accuracy measured below** (modest) |
| **Voice notes and video** | **Hidden behind a feature flag (OFF by default)**: appears only when `ASR_ENDPOINT_URL` is set; **untested** against a real speech endpoint; the README and UI do not claim otherwise |
| Nebius Token Factory | **Not tested by us** (blocked). `npm run verify-nebius` is the teammate's PASS/FAIL checker; it passed everything except the expected "provider is not Nebius" warning when run against the NVIDIA API |
| Cut | Supabase magic-link auth (the Watchlist is shared per deployment); Nebius Serverless speech deployment; long-video processing off-Vercel |

## Saved demo runs (real, `npm run fixtures`)

| Fixture | Nodes (copies / evidence pages) | Edges high/med/low (without labels) | Detected changes shown | Earliest found | Cost* (all-Ultra*) | Check |
|---|---|---|---|---|---|---|
| Perfume forward | 6 (2 / 3) | see fixture | 2 (1 strong) | 2001-11-03 (a fact-check quoting "Seven women have died after inhaling a free perfume sample that was mailed to them") | $0.0076 ($0.057, 7.6×) | n/a |
| Screenshot (fictional @kemi_reports_247) | 1 (empty family after the same-claim fix) | none | 0 | none (limited) | $0.0070 ($0.041, 5.9×) | **No evidence this post exists** |
| WhatsApp "Martinelli" | 16 (2 / 13) | see fixture | 3 | 2018-04-17 (Snopes quoting "Warning from An Garda…") | $0.0121 ($0.075, 6.2×) | n/a |
| Fake circular (fictional org) | 1 (0 / 0) | none | 0 | none (limited) | $0.0041 ($0.063) | **No official record found** |
| General statement (Fulani sentence) | no tree (4 reputable reports) | none | none | n/a | under $0.001 | neutral reply card |

\* Logged tokens × Nebius Token Factory list prices (the NVIDIA API served the runs); "all-Ultra" re-prices the same tokens at Ultra rates. Latency of successful calls in these runs: Nano p50 5.1 s / p95 15.6 s (n=120), Super p50 3.5 s / p95 12.7 s (n=11), Ultra p50 18.7 s / p95 25.1 s (n=3), vision 5.8 s (n=1). A fresh live trace takes roughly 1–3 minutes on NVIDIA's free tier (rate-limited to ~30 requests/min); `npm run verify-nebius` on the NVIDIA API took 138 s. Unthrottled Nebius timing is unmeasured.

## Detected-change accuracy (hand-scored, strict rubric, against the full parent/child texts)

**Rubric.** A label is correct only if it describes a change in the *message content* that is genuinely new in the later text, with the right type. Fact-checker commentary ("this is a hoax", where it circulated, officials' denials) is not message content. Borderline cases count as wrong (strict).

**Correction.** An earlier "11 of 15" figure was too generous (I compared against truncated parent text); scored properly the old labels were ~35% correct.

| Configuration | Labels given to the final stage | Correct before review | Labels shown | Correct shown |
|---|---|---|---|---|
| Old pipeline: label validator only (Martinelli + perfume) | 26 | 9 (35%) | 26 | 9 of 26 = **35%** |
| + Super review pass and guards (all four cases) | 34 | 14 (41%) | 24 | 13 of 24 = **54%** |
| **Final: copies only, evidence pages as leaves, strong/weak labels** (all four cases) | 9 | 5 (56%) | 7 | 5 of 7 = **71%** (Martinelli 3/5, perfume 2/2, screenshot and grant: no labels) |

**How to read this.**
- The final 71% is on **7 labels**. That is far too few to be a reliable rate (the plausible range is roughly 30–95%). The honest summary is "about half to three quarters of the changes shown are right, and we show few".
- **The strict rules trade volume for precision**: shown labels fell from 24 to 7, and most edges now carry no labels because one end is an *evidence page* (a fact-check without a clean quoted copy of the rumor): 14 of 17 edges in Martinelli, 3 of 6 in perfume, 5 of 8 in the screenshot case.
- **Untuned cases** (screenshot, grant) end up with **zero** labels, so their accuracy cannot be measured. Before the copies-only rule, a grant case scored 4 of 4 on its user-copy edge, then lost its labels when the tree's structure changed; this fragility is real.
- The page-admission gates fixed the grant case: the "Swiss recovered funds / World Bank" rebuttal of a *different* programme is no longer admitted (a naira offer needs an amount in naira), and the circular no longer matches an unrelated US county's school-closure post (a claim naming an organisation needs the whole distinctive name on the page).
- Remaining errors seen: a "removed" label where the later text still names the thing in other words, and a call-to-action that is a reworded repeat.

## General statements vs forwarded messages (added after a real-world test)

**Problem found by a real test.** A plain news-style sentence ("Fulani herdsmen are clashing with farmers in Nigeria and it is causing deaths…") was treated as a rumor: an unrelated opinion post became the "earliest version", a fact-check of a *different* video was attached as evidence, and the reply card implied doubt.

**What changed**
1. **Stage A0 classification** (`src/lib/general.ts`): a small Nano call labels plain text *circulating message* or *general statement* (and flags sensitive topics). Chain-forward markers always win over the model; screenshots/documents are always messages. It is a separate call, so Stage A prompts, caches and the existing demo runs are unchanged.
2. **General statements get no lineage tree and no implied doubt.** Tavily news search (3 searches), one Nano call selects only news/official/research pages that directly report on the topic (never social/blog/forum posts, opinion, or fact-checks of other stories), each with a one-sentence neutral, attributed summary that must be traceable to the source text (else the source's own sentence is quoted). 1–5 sources are shown with dates and provenance. The reply card is deterministic and neutral (no "rumor/false/doubt" wording; unit-tested).
3. **Fact-checks attach only when they address the same claim.** Fact-check/news/official pages must speak to the claim's specifics; posts and forwards pass on the same test *or* by closely resembling the message's wording (older copies often lack later-added specifics). The verdict prompt now forbids suggesting a claim is false or doubtful unless a listed source directly contradicts that exact claim, and the rule-based reply card no longer says "details have changed… hold off" without a source.
4. **Sensitive topics** (ethnic, religious, conflict, security): neutral, attributed wording for summaries and verdicts; a social/forum/other page is never offered as the "earliest version" (the earliest fact-check/news/official page is).

**Test results (real APIs, NVIDIA provider)**
- **Fulani sentence** → classified *general statement*, 0 lineage nodes, 4 sources (latimes.com 2019, cnn.com 2018, bisi.org.uk research 2025, dw.com 2023) with neutral attributed summaries; neutral reply card; no fact-check or opinion pages. (One sentence is a small test of the classifier: it is a guardrail plus a model judgement, not a measured accuracy.)
- **Perfume forward and Martinelli** still work as before: same earliest versions (2001-11-03; 2018-04-17), same number of detected changes (2 and 3 vs 2 and 5), 6 and 16 nodes (was 7 and 18: a few off-topic pages are now excluded).
- **Fake circular:** unchanged (empty family, `no official record found`).
- **Screenshot demo:** the family is now **empty** (was 8 pages). The removed pages were fact-checks of the same rumor in other places and two unrelated posts about *selling fake perfumes*; none speaks to this post's specifics (Lagos, Abuja, 2,000). The "No evidence this post exists" check is unchanged. This is the strictness trade-off: fewer, safer versions.
- 98 tests pass (new: classification, sensitivity, neutral verdict, grounded summaries, different-story fact-checks).

## What real data exposed, and what was done (selected)

| Problem | Fix |
|---|---|
| Models listed by NVIDIA returned `404 Function not found for account` → silent failures | `npm run probe`; fallbacks record the reason |
| Default "thinking" burns hundreds of tokens per call | `enable_thinking:false` (auto-dropped on HTTP 400) |
| 429 / 5xx / dropped connections on the free API | shared throttle (30/min on NVIDIA), backoff, network retry |
| Small model could not copy quotes; echoed instructions | model answers with **sentence numbers**; quotes are verbatim by construction, re-checked |
| Junk "versions" (hashtags, explainers, rebuttals of other schemes, other organisations' notices) | relation + same-specific-claim + money-currency + organisation + circulating-message + minimum-length gates |
| Mutation labels grounded but wrong | review pass + guards (above); copies-only rule |
| Overconfident edges / unsupported "wider spread" / commentary cited as contradiction | confidence cap, dated-evidence rule, specificity check |
| Ultra's tree sometimes invalid | repaired edge by edge; evidence pages forced to be leaves |
| Tree layout broke when "earliest" moved off the root | layout roots at the node with no parent; canvas grows with the tree |
| Tesseract wrote into a read-only dir on Vercel | temp-dir cache path |

**Nano-tier decision.** `nemotron-nano-3-30b-a3b` returned 404 for our key, so we compared Lightning, Nano-Omni (thinking off) and Bolt-e4b: Lightning found the 2018 origin that Bolt missed and was faster than Nano-Omni. Lightning is the default Nano model on both providers.

## Demo

See `docs/DEMO_SCRIPT.md`. Perfume gives the strongest origin story; Martinelli the deepest tree (mostly evidence pages around a few copies: say so); the screenshot and circular give the two honest "No evidence / No official record" moments.

## Verified in this build

- `npm run lint`, `typecheck`, `test` (98 tests) and `build` pass; no secrets in the repo or git history.
- Real APIs: NVIDIA chat completions (Nano/Super/Ultra/vision), Tavily search + extract, Supabase (server round-trips; anon key blocked).
- Browser-checked with the real fixtures: home (voice/video hidden), replay, tree, side panel with detected changes, post-exists panel, official panel, reply card, routing drawer, Watchlist, share page, dark mode, 375 px.
- **Not verified:** anything on Nebius Token Factory; voice/video/speech; a Vercel deployment; XLSX/PPTX end to end.

## Still to do (people)

See the final report / `docs/TEAMMATE_DEPLOY.md` Step 8: deploy on Nebius, run `npm run verify-nebius`, `npm run fixtures`, re-record the shots marked in `docs/DEMO_SCRIPT.md`, resolve the `[CONFIRM AFTER NEBIUS RUN]` lines in `docs/SUBMISSION.md`, add the URLs, submit.

## Roots-in-soil lineage view
The lineage is drawn as roots growing through layered soil: surface = today (your copy on the grass, "You are here"), roots run down into older versions, the deepest point is the earliest version found. Time gaps are compressed ("··· 5 years deeper ···"). Each version is a readable card (big year, source type + domain, excerpt, expandable full text, a plain-English "What changed" line); evidence pages are labelled stones ("Snopes · 2018 · fact-check") that still open the side panel. A verdict banner above the soil is built only from saved data. "What changed" is one Super call per copy→copy edge (stage D3, `describeChanges` in `src/lib/pipeline.ts`); every quoted part must appear in the parent or child text and verdict words are rejected, otherwise nothing is shown. Ordering/lanes/geometry: `src/lib/soilLayout.ts` (tests in `tests/soilLayout.test.ts`); renderer: `src/components/TreeView.tsx`. Fixtures were regenerated (real runs, NVIDIA API) so they carry the notes.
