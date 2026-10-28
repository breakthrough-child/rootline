// The Rootline core pipeline: Understand → Find relatives → Confirm → Mutations → Cluster → Lineage → Verdict.
import pLimit from "p-limit";
import { config, llmAvailable } from "./config";
import { guessPageType, heuristicMembership, heuristicMutations, heuristicUnderstanding, heuristicVerdict, validateMutations } from "./heuristics";
import { chatJson, RunContext, withFallback } from "./llm";
import { ClusterSchema, LineageSchema, MembershipSchema, MutationsSchema, UnderstandingSchema, VerdictSchema } from "./schemas";
import { extract, resolveDate, search, type SearchHit } from "./search";
import { bestExcerpt, clip, excerptStrictlyIn, hashString, normalizeInput, relatedness, snapExcerptToPage, tokenCoverage, truncate, wordCount } from "./text";
import { baselineTree, candidatePairs, dedupeVariants, markSpread, repairTree, validateTree } from "./tree";
import type { ClaimResult, Confidence, ExtractedInput, LineageEdge, Mutation, SourceRef, Understanding, Variant, Verdict } from "./types";
import { MUTATION_TYPES } from "./types";

/** Pages whose best passage scores below this against the claim are not worth a model call. */
export const PREFILTER_SCORE = 0.14;
export const MIN_EXCERPT_WORDS = 8;
export const LIMITED_THRESHOLD = 3; // fewer confirmed relatives than this → "Limited family found"

const SYSTEM = `You are a careful misinformation analyst inside Rootline, a tool that traces how viral messages mutate.
Rules: never invent sources, dates, quotes or facts. Only use text you are given. Reply with a single JSON object and nothing else.`;

function userInputVariant(input: ExtractedInput, claimText: string): Variant {
  const ref = input.original.kind === "upload" ? `upload:${input.original.filename ?? input.sourceKind}` : "user:pasted";
  // A screenshot's visible timestamp is shown to the user but never used for ordering: it is unverified.
  const date = null;
  return {
    id: "you",
    text: claimText,
    excerpt: claimText,
    sources: [{ url: ref, title: "Your copy", excerpt: claimText, pageType: "user_input", date, dateProvenance: input.screenshot?.visible_timestamp ? "from_screenshot_unverified" : "unknown" }],
    date,
    dateProvenance: input.screenshot?.visible_timestamp ? "from_screenshot_unverified" : "unknown",
    pageType: "user_input",
    isUserInput: true,
  };
}

// ── Stage A ────────────────────────────────────────────────────────────────
async function understand(ctx: RunContext, claimText: string, input: ExtractedInput): Promise<Understanding> {
  const english = input.englishText && input.englishText !== input.text ? input.englishText : undefined;
  const fallback = () => heuristicUnderstanding(claimText, english, input.language);
  const { value } = await withFallback(ctx, "A: understand", "nano", async () => {
    const out = await chatJson(ctx, UnderstandingSchema, {
      tier: "nano",
      stage: "A: understand",
      maxTokens: 900,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Message (language: ${input.language}):\n"""${truncate(claimText, 3000)}"""\n${english ? `English translation:\n"""${truncate(english, 3000)}"""\n` : ""}
Extract the core checkable claim and plan web searches that would find EARLIER and PARALLEL copies of this message (mutated copies reword things, change numbers and places).
Return JSON: {"claim": string, "entities": string[], "numbers": string[], "places": string[], "authorities": string[], "call_to_action": string|null, "language": string,
"key_elements": 3-4 short phrases, each naming a DIFFERENT distinctive part of the message in general words that a reworded copy would still match (e.g. the lure or offer, the claimed effect on the victim, the claimed harm, the demanded action),
"queries": 4-8 strings — mix 2-3 exact distinctive phrases in double quotes copied verbatim from the message, 2-3 paraphrases without quotes, and 1 query ending in "fact check"${english ? "; include queries in both the original language and English" : ""}}`,
        },
      ],
    });
    return {
      claim: out.claim,
      entities: out.entities,
      numbers: out.numbers,
      places: out.places,
      authorities: out.authorities,
      callToAction: out.call_to_action,
      language: out.language,
      queries: out.queries,
      keyElements: out.key_elements,
    };
  }, fallback);
  // Always include at least one verbatim distinctive phrase, deduped, capped.
  const h = fallback();
  const queries = [...new Set([...value.queries, ...h.queries.slice(0, 2)].map((q) => q.trim()).filter(Boolean))].slice(0, Math.max(4, config.limits.maxQueries));
  return { ...value, queries };
}

// ── Stage B ────────────────────────────────────────────────────────────────
export interface CandidatePage {
  url: string;
  title: string;
  content: string;
  date: string | null;
  dateProvenance: SourceRef["dateProvenance"];
}

/** Words that show a passage is about a circulating message/claim (forward, viral, hoax, chain…), not just the topic. */
const MESSAGE_MARKER_RE = /\b(?:viral|circulat\w*|forward\w*|whatsapp|chain|rumou?rs?|hoax(?:es)?|claim(?:s|ed|ing)?|message(?:s)?|warning|fake|myth|false|fact[- ]?check\w*|debunk\w*|urban legend|scam|spreading|shared|going around|post(?:ed)?|alert)\b/gi;
export function messageMarkers(text: string): number {
  return new Set((text.match(MESSAGE_MARKER_RE) ?? []).map((m) => m.toLowerCase())).size;
}

async function findRelatives(ctx: RunContext, u: Understanding, claimId: string): Promise<CandidatePage[]> {
  const limit = pLimit(4);
  const hitsByUrl = new Map<string, { hit: SearchHit; votes: number }>();
  let done = 0;
  await Promise.all(
    u.queries.map((q) =>
      limit(async () => {
        try {
          const hits = await search(ctx, q, { maxResults: 10, stage: "B: search" });
          for (const h of hits) {
            const key = h.url.replace(/[#?].*$/, "").replace(/\/$/, "");
            const cur = hitsByUrl.get(key);
            if (cur) cur.votes++;
            else hitsByUrl.set(key, { hit: h, votes: 1 });
          }
        } catch {
          /* logged */
        }
        done++;
        ctx.stage("B", `Searching… ${done}/${u.queries.length} queries · ${hitsByUrl.size} sources`, claimId);
      }),
    ),
  );
  const ranked = [...hitsByUrl.values()].sort((a, b) => b.votes - a.votes || b.hit.score - a.hit.score).slice(0, config.limits.maxPages);
  if (!ranked.length) return [];
  ctx.stage("B", `Reading ${ranked.length} pages…`, claimId);
  const pages = await extract(ctx, ranked.map((r) => r.hit.url), u.claim);
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  return ranked.map(({ hit }) => {
    const page = byUrl.get(hit.url);
    const { date, provenance } = resolveDate(hit.publishedDate, page?.metaDate ?? null);
    const content = page?.content || hit.content; // search snippet when the page could not be extracted
    ctx.pages?.set(hit.url, content);
    return { url: hit.url, title: hit.title, content, date, dateProvenance: provenance };
  });
}

// ── Stage C ────────────────────────────────────────────────────────────────
/** Window of page text most likely to contain the claim, to keep prompts small. */
function focusWindow(content: string, claim: string, size = 5000): string {
  if (content.length <= size) return content;
  const { excerpt } = bestExcerpt(content, claim);
  const at = excerpt ? content.indexOf(excerpt) : 0;
  const start = Math.max(0, at - size / 2);
  return content.slice(start, start + size);
}

export async function confirmMembership(ctx: RunContext, claim: string, elements: string[], pages: CandidatePage[], claimId: string): Promise<Variant[]> {
  const limit = pLimit(config.limits.concurrency);
  let checked = 0;
  let skipped = 0;
  const results = await Promise.all(
    pages.map((p, idx) =>
      limit(async (): Promise<Variant | null> => {
        const h = heuristicMembership(p.content, claim);
        // Local relevance pre-filter: skip the model call for pages with no passage anywhere near the claim.
        if (h.score < PREFILTER_SCORE) {
          checked++;
          skipped++;
          return null;
        }
        const { value } = await withFallback(
          ctx,
          "C: confirm",
          "nano",
          async () => {
            const out = await chatJson(ctx, MembershipSchema, {
              tier: "nano",
              stage: "C: confirm",
              maxTokens: 600,
              messages: [
                { role: "system", content: SYSTEM },
                {
                  role: "user",
                  content: `Claim being traced:\n"""${truncate(claim, 1200)}"""\n\nWeb page (${p.url}):\n"""${focusWindow(p.content, claim)}"""\n
${elements.length ? `The message's distinctive elements (a reworded copy still expresses them):\n${elements.map((e, i) => `${i}. ${e}`).join("\n")}\n\n` : ""}Does this page contain a version of the SAME message (the same warning/offer/rumor, even if reworded or with different numbers, places or names)?
- "same_message" or "reworded": the page quotes, forwards or reposts this message, or a fact-check quotes/describes this very message. These count.
- "related_only": same topic but not this message: a news report of one specific incident, a product page, general advice, or a general health/science/consumer explainer that never quotes or describes this circulating message. These do NOT count.
- "unrelated": not about this at all.
Return JSON: {"relation": "same_message"|"reworded"|"related_only"|"unrelated", "contains_version": true only for same_message/reworded, "excerpt": ONE continuous passage copied character-for-character from the page (max 400 chars; no ellipses; "" if none), "normalized": the message as it appears there, in plain words, copying the page's wording and omitting commentary,${elements.length ? ' "evidence": [{"element": element number, "phrase": the exact words copied from the page that express that element}] listing ONLY elements the page really expresses,' : ""} "page_type": "debunk"|"news"|"social"|"forum"|"official"|"other"}`,
                },
              ],
            });
            // A real version must express at least two distinct elements of the message, each backed by a phrase that
            // is verifiably on the page (this is what rejects pages that merely share the topic or a few keywords).
            const verified = new Set(out.evidence.filter((e) => e.element >= 0 && e.element < elements.length && excerptStrictlyIn(e.phrase, p.content)).map((e) => e.element));
            const enoughEvidence = elements.length < 2 || verified.size >= 2;
            const counts = out.contains_version && (out.relation === "same_message" || out.relation === "reworded") && enoughEvidence;
            if (!counts) return { contains: false, excerpt: "", normalized: "", pageType: out.page_type };
            // Honesty: the excerpt must be a verbatim passage of the page. Snap it, else use the best real passage, else reject.
            const window = focusWindow(p.content, claim);
            // A page that merely explains the topic (health, science, shopping) is not a copy of a circulating message.
            if (messageMarkers(window) < 2 && out.page_type !== "social" && out.page_type !== "forum") return { contains: false, excerpt: "", normalized: "", pageType: out.page_type };
            let excerpt = snapExcerptToPage(out.excerpt, p.content);
            if (!excerpt) excerpt = h.score >= 0.25 ? h.excerpt : null;
            // The excerpt must show the message, not boilerplate: if the passage around the verified evidence resembles the claim more, quote that instead.
            const evidence = out.evidence.filter((e) => excerptStrictlyIn(e.phrase, p.content)).map((e) => e.phrase);
            if (evidence.length) {
              const around = bestExcerpt(p.content, evidence.join(". "), 4).excerpt;
              if (around && (!excerpt || relatedness(around, claim) > relatedness(excerpt, claim) + 0.05)) excerpt = around;
            }
            // A quoted message is sentence-length; a menu label or slogan is not a version of it.
            if (!excerpt || wordCount(excerpt) < MIN_EXCERPT_WORDS) return { contains: false, excerpt: "", normalized: "", pageType: out.page_type };
            return { contains: true, excerpt, normalized: out.normalized || excerpt, pageType: out.page_type };
          },
          // With a model configured, a page the model could not confirm is NOT admitted on heuristics alone
          // (only the no-model/offline path may rely on them): unverified pages must not enter the tree.
          () => ({ contains: !llmAvailable("nano") && h.contains, excerpt: h.excerpt, normalized: h.excerpt, pageType: guessPageType(p.url, p.title, p.content) }),
        );
        checked++;
        if (checked % 5 === 0 || checked === pages.length) ctx.stage("C", `Checking pages… ${checked}/${pages.length}`, claimId);
        if (!value.contains || !value.excerpt) return null;
        const excerpt = clip(value.excerpt, 600);
        // Use the model's normalized wording only if it is really the page's wording; otherwise the verbatim excerpt.
        const normalized = value.normalized ? clip(normalizeInput(value.normalized), 600) : "";
        const useNormalized = wordCount(normalized) >= 4 && tokenCoverage(normalized, p.content) >= 0.85;
        return {
          id: `v${idx}-${hashString(p.url).slice(0, 5)}`,
          text: useNormalized ? normalized : excerpt,
          excerpt,
          sources: [{ url: p.url, title: p.title, excerpt, pageType: value.pageType, date: p.date, dateProvenance: p.dateProvenance }],
          date: p.date,
          dateProvenance: p.dateProvenance,
          pageType: value.pageType,
        };
      }),
    ),
  );
  if (skipped) ctx.stage("C", `${skipped} of ${pages.length} pages skipped (no passage resembling the claim)`, claimId);
  return results.filter((v): v is Variant => v !== null);
}

// ── Stage D ────────────────────────────────────────────────────────────────
const pairKey = (a: string, b: string) => `${a}>${b}`;
/** Below this wording relatedness two texts are treated as different stories (no mutation labels, low confidence). */
const MUTATION_MIN_RELATEDNESS = 0.2;

async function analyseMutations(ctx: RunContext, variants: Variant[], pairs: [string, string][], claimId: string): Promise<Map<string, Mutation[]>> {
  const byId = new Map(variants.map((v) => [v.id, v]));
  const out = new Map<string, Mutation[]>();
  const limit = pLimit(config.limits.concurrency);
  ctx.stage("D", `Comparing ${pairs.length} pairs…`, claimId);
  await Promise.all(
    pairs.map(([a, b]) =>
      limit(async () => {
        const pa = byId.get(a)!;
        const cb = byId.get(b)!;
        // Texts that share almost nothing are different stories, not parent/child: don't force labels onto them.
        if (relatedness(pa.text, cb.text) < MUTATION_MIN_RELATEDNESS) {
          out.set(pairKey(a, b), []);
          return;
        }
        const { value } = await withFallback(
          ctx,
          "D: mutations",
          "nano",
          async () =>
            (
              await chatJson(ctx, MutationsSchema, {
                tier: "nano",
                stage: "D: mutations",
                maxTokens: 700,
                messages: [
                  { role: "system", content: SYSTEM },
                  {
                    role: "user",
                    content: `EARLIER version:\n"""${truncate(pa.text, 900)}"""\nLATER version:\n"""${truncate(cb.text, 900)}"""\n
List the meaningful ways the LATER version differs from the EARLIER one. Use exactly these labels:
- number_changed: a quantity, count, amount, price or percentage differs (200 → 2,000; N30,000 → N50,000). Only for numbers.
- location_changed: a place name differs (Ibadan → Lagos).
- authority_added / authority_removed: a named person, organisation, official body or expert (police, WHO, a doctor, CNN, a ministry) is newly cited as a source or confirmer / is no longer cited.
- urgency_added: new time pressure (urgent, immediately, before Friday).
- date_changed: a date, day or time reference differs.
- target_changed: the group of people said to be at risk or eligible differs (women → children).
- call_to_action_added: a new instruction to forward, share, click, apply, call or register.
- emotional_framing_added: new fear, outrage or pity wording.
- detail_added / detail_removed: a material fact appears or disappears and no label above fits.
- other: only if nothing above fits.
Rules: "before" = the exact words copied from the EARLIER text ("" if the item is new); "after" = the exact words copied from the LATER text ("" if the item was dropped); each at most 8 words. Do not report style, punctuation, greetings or rewording that keeps the meaning. Do not report something that appears in both. One entry per change, at most 5.
Return JSON: {"mutations": [{"type": label, "before": string, "after": string, "explanation": "one short line"}]}. If nothing meaningful changed, return {"mutations": []}.`,
                  },
                ],
              })
            ).mutations,
          () => heuristicMutations(pa.text, cb.text),
        );
        const valid = validateMutations(value, pa.text, cb.text);
        out.set(pairKey(a, b), valid);
        return;
      }),
    ),
  );
  return out;
}

// ── Stage E ────────────────────────────────────────────────────────────────
async function cluster(ctx: RunContext, variants: Variant[], mutations: Map<string, Mutation[]>) {
  const ids = new Set(variants.map((v) => v.id));
  const { value } = await withFallback(
    ctx,
    "E: cluster",
    "super",
    async () =>
      chatJson(ctx, ClusterSchema, {
        tier: "super",
        stage: "E: cluster",
        maxTokens: 1200,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Variants of one viral message (id | date | text):\n${variants.map((v) => `${v.id} | ${v.date ?? "unknown"} | ${truncate(v.text, 220)}`).join("\n")}\n\nPairwise mutations found:\n${[...mutations.entries()]
              .slice(0, 60)
              .map(([k, ms]) => `${k}: ${ms.map((m) => `${m.type}(${truncate(m.before, 30)}→${truncate(m.after, 30)})`).join("; ") || "none"}`)
              .join("\n")}\n
Tasks: (1) merges: pairs of ids that are the SAME version (near-identical wording); never merge "you". (2) branches: group variants into 1-4 named branches by their distinguishing mutation (e.g. "N50,000 + ministry"). (3) label_fixes: mutation type labels that should be standardized.
Use only the ids listed. Return JSON: {"merges":[{"keep":id,"merge":id}],"branches":[{"name":string,"variant_ids":[id]}],"label_fixes":[{"from":string,"to":type}]}`,
          },
        ],
      }),
    () => ({ merges: [], branches: [], label_fixes: [] }),
  );
  const merges = value.merges.filter((m) => ids.has(m.keep) && ids.has(m.merge) && m.keep !== m.merge && m.keep !== "you" && m.merge !== "you");
  const branches = value.branches.map((b) => ({ name: b.name, variantIds: b.variant_ids.filter((i) => ids.has(i)) })).filter((b) => b.variantIds.length);
  return { merges, branches };
}

function applyMerges(variants: Variant[], merges: { keep: string; merge: string }[]): Variant[] {
  const byId = new Map(variants.map((v) => [v.id, { ...v, sources: [...v.sources] }]));
  for (const { keep, merge } of merges) {
    const k = byId.get(keep);
    const m = byId.get(merge);
    if (!k || !m) continue;
    for (const s of m.sources) if (!k.sources.some((x) => x.url === s.url)) k.sources.push(s);
    if (m.date && (!k.date || m.date < k.date)) {
      k.date = m.date;
      k.dateProvenance = m.dateProvenance;
      k.excerpt = m.excerpt;
    }
    byId.delete(merge);
  }
  return [...byId.values()];
}

// ── Stage F ────────────────────────────────────────────────────────────────
async function lineage(ctx: RunContext, variants: Variant[], baseline: ReturnType<typeof baselineTree>, mutations: Map<string, Mutation[]>) {
  const { value, usedFallback } = await withFallback(
    ctx,
    "F: lineage",
    "ultra",
    async () => {
      const out = await chatJson(ctx, LineageSchema, {
        tier: "ultra",
        stage: "F: lineage",
        maxTokens: 2000,
        timeoutMs: 90_000,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `You are refining a likely-lineage tree of one viral message. Nodes (id | date | date provenance | source type | text):
${variants.map((v) => `${v.id} | ${v.date ?? "unknown"} | ${v.dateProvenance} | ${v.pageType} | ${truncate(v.text, 260)}`).join("\n")}

Baseline tree (minimum spanning tree on wording, parent never later than child when both dated):
${baseline.edges.map((e) => `${e.from} -> ${e.to}`).join("\n")}

Mutations between candidate pairs:
${[...mutations.entries()].slice(0, 80).map(([k, ms]) => `${k}: ${ms.map((m) => m.type).join(", ") || "none"}`).join("\n")}

Refine parent edges using mutation logic (a child usually inherits its parent's changes and adds new ones). Constraints: use ONLY the ids above, do NOT add nodes, exactly one root, every other node has exactly one parent, a parent can never be dated after its child. "you" is the user's copy and must be a leaf.
Return JSON: {"edges":[{"parent":id,"child":id,"confidence":"low"|"medium"|"high","reason":"one short line"}],"earliest_id":id,"evolution_summary":"2-3 plain sentences"}`,
          },
        ],
      });
      // Ultra may refine but never invent: keep each of its valid parent choices, repair the rest from the baseline.
      const { edges: repaired, rejected } = repairTree(variants, out.edges.map((e) => ({ from: e.parent, to: e.child, confidence: e.confidence, reason: e.reason })), baseline.edges, out.earliest_id);
      const valid = validateTree(variants, repaired);
      if (!valid.ok) throw new Error(`Ultra tree rejected: ${valid.reason}`);
      const root = variants.find((v) => !repaired.some((e) => e.to === v.id))!.id;
      return {
        rootId: root as string | null,
        edges: repaired.map((e) => ({ ...e, mutations: [] as Mutation[], reason: e.reason || "" })),
        summary: out.evolution_summary,
        repaired: rejected,
      };
    },
    () => ({ rootId: baseline.rootId, edges: baseline.edges, summary: "", repaired: 0 }),
  );
  return { ...value, usedFallback };
}

/** A model's stated confidence may not exceed what the wording evidence supports. */
export function capConfidence(e: LineageEdge, variants: Variant[]): LineageEdge {
  const p = variants.find((v) => v.id === e.from);
  const c = variants.find((v) => v.id === e.to);
  if (!p || !c) return e;
  const r = relatedness(p.text, c.text);
  const cap: Confidence = r < 0.35 ? "low" : r < 0.55 ? "medium" : "high";
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[e.confidence] > rank[cap] ? { ...e, confidence: cap, reason: `${e.reason}${e.reason ? " " : ""}(Confidence capped: wording similarity ${r.toFixed(2)}.)`.trim() } : e;
}

// ── Stage G ────────────────────────────────────────────────────────────────
async function verdict(ctx: RunContext, claim: string, variants: Variant[], edges: LineageEdge[], earliestId: string | null, limited: boolean, evolution: string): Promise<Verdict> {
  const fallback = () => heuristicVerdict(variants, edges, earliestId, limited);
  const knownUrls = new Set(variants.flatMap((v) => v.sources.map((s) => s.url)));
  const evidence = variants
    .flatMap((v) => v.sources.filter((s) => ["debunk", "official", "news"].includes(s.pageType)))
    .slice(0, 8)
    .map((s) => `${s.url} (${s.pageType}, ${s.date ?? "undated"}): ${truncate(s.excerpt, 300)}`);
  const { value } = await withFallback(
    ctx,
    "G: verdict",
    "super",
    async () => {
      const out = await chatJson(ctx, VerdictSchema, {
        tier: "super",
        stage: "G: verdict",
        maxTokens: 900,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Claim the user received:\n"""${truncate(claim, 800)}"""
Earliest version found (${earliestId}): ${truncate(variants.find((v) => v.id === earliestId)?.text ?? "none", 300)} — dated ${variants.find((v) => v.id === earliestId)?.date ?? "unknown"}
Lineage summary: ${evolution || "(none)"}
Mutations along the tree: ${edges.flatMap((e) => e.mutations.map((m) => `${m.type}: ${m.before}→${m.after}`)).slice(0, 25).join("; ") || "none recorded"}
Evidence from fact-check/official/news sources:\n${evidence.join("\n") || "(none found)"}
Family size: ${variants.length - 1} related versions found${limited ? " (LIMITED family)" : ""}.

Write a calm, non-preachy verdict. Say "earliest version found" (not "origin"). Only mark statements as unsupported if a listed source contradicts them, and cite those exact URLs. Never call anything definitely fake.
reply_card: under 60 words, for a family WhatsApp group; kind, never condescending, no links.
Return JSON: {"summary": 2-3 sentences, "what_changed": [short lines], "unsupported": [{"statement": string, "source_urls": [url]}], "confidence": "low"|"medium"|"high", "reply_card": string}`,
          },
        ],
      });
      if (wordCount(out.reply_card) > 60) throw new Error("reply card over 60 words");
      return {
        summary: out.summary,
        whatChanged: out.what_changed,
        unsupported: out.unsupported.map((u) => ({ statement: u.statement, sourceUrls: u.source_urls.filter((x) => knownUrls.has(x)) })).filter((u) => u.sourceUrls.length),
        confidence: limited ? "low" : out.confidence,
        replyCard: out.reply_card,
      };
    },
    fallback,
  );
  return value;
}

// ── Orchestration ──────────────────────────────────────────────────────────
export interface RunClaimOptions {
  previousSourceUrls?: Set<string>; // watchlist re-run: mark variants with new sources
}

export async function runClaim(ctx: RunContext, claimId: string, claimText: string, input: ExtractedInput, opts: RunClaimOptions = {}): Promise<ClaimResult> {
  const warnings: string[] = [];
  ctx.stage("A", "Understanding the claim…", claimId);
  const u = await understand(ctx, claimText, input);

  ctx.stage("B", `Searching the web with ${u.queries.length} queries…`, claimId);
  const pages = await findRelatives(ctx, u, claimId);
  if (!pages.length) warnings.push("Search returned no pages. Check your search configuration or try different wording.");

  ctx.stage("C", `Checking ${pages.length} pages for versions of this message…`, claimId);
  const confirmed = await confirmMembership(ctx, u.claim || claimText, u.keyElements, pages, claimId);
  let variants = dedupeVariants([...confirmed, userInputVariant(input, claimText)]);
  if (opts.previousSourceUrls)
    variants = variants.map((v) => ({ ...v, isNew: !v.isUserInput && v.sources.every((s) => !opts.previousSourceUrls!.has(s.url)) }));
  const relatives = variants.filter((v) => !v.isUserInput).length;
  const limited = relatives < LIMITED_THRESHOLD;
  ctx.stage("C", `${relatives} related version${relatives === 1 ? "" : "s"} confirmed`, claimId);
  const sorted = [...variants].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  for (const v of sorted) ctx.emit({ type: "node", claimId, variant: v });

  let mutations = new Map<string, Mutation[]>();
  let branches: { name: string; variantIds: string[] }[] = [];
  let tree = baselineTree(variants);
  let pairs: [string, string][] = [];
  if (variants.length > 1) {
    pairs = candidatePairs(variants, tree.edges, config.limits.maxPairs);
    mutations = await analyseMutations(ctx, variants, pairs, claimId);

    if (variants.length > 3) {
      ctx.stage("E", "Grouping variants into branches…", claimId);
      const c = await cluster(ctx, variants, mutations);
      if (c.merges.length) {
        variants = applyMerges(variants, c.merges);
        tree = baselineTree(variants);
      }
      branches = c.branches.map((b) => ({ ...b, variantIds: b.variantIds.filter((id) => variants.some((v) => v.id === id)) })).filter((b) => b.variantIds.length);
    }
  }

  ctx.stage("F", "Building lineage…", claimId);
  const lin = variants.length > 1 ? await lineage(ctx, variants, tree, mutations) : { rootId: tree.rootId, edges: [] as LineageEdge[], summary: "", usedFallback: true, repaired: 0 };
  if (lin.repaired) warnings.push(`${lin.repaired} lineage edge${lin.repaired > 1 ? "s were" : " was"} repaired from the baseline tree (the refined tree proposed an invalid parent).`);
  if (lin.usedFallback && variants.length > 2) warnings.push("Lineage uses the algorithmic baseline tree (model refinement unavailable).");

  // Fill mutations for every final edge (heuristic for any pair the model didn't analyse).
  let edges: LineageEdge[] = lin.edges.map((e) => ({
    ...e,
    mutations: mutations.get(pairKey(e.from, e.to)) ?? heuristicMutations(variants.find((v) => v.id === e.from)!.text, variants.find((v) => v.id === e.to)!.text),
  }));
  edges = edges.map((e) => capConfidence(e, variants));
  edges = markSpread(variants, edges);
  for (const e of edges) ctx.emit({ type: "edge", claimId, edge: e });
  for (const b of branches) for (const id of b.variantIds) {
    const v = variants.find((x) => x.id === id);
    if (v && !v.branch) v.branch = b.name;
  }

  ctx.stage("G", "Writing summary and reply card…", claimId);
  const earliestId = lin.rootId && !variants.find((v) => v.id === lin.rootId)?.isUserInput ? lin.rootId : null;
  const v = await verdict(ctx, claimText, variants, edges, earliestId, limited, lin.summary);

  return {
    claimId,
    claim: claimText,
    understanding: u,
    variants,
    edges,
    earliestId,
    limited,
    verdict: { ...v, whatChanged: v.whatChanged.length ? v.whatChanged : lin.summary ? [lin.summary] : [] },
    branches,
    stats: { queries: u.queries.length, pagesSearched: pages.length, pagesConfirmed: confirmed.length, pairsCompared: pairs.length },
    warnings,
  };
}
