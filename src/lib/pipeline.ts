// The Rootline core pipeline: Understand → Find relatives → Confirm → Mutations → Cluster → Lineage → Verdict.
import pLimit from "p-limit";
import { config, llmAvailable } from "./config";
import { guessPageType, heuristicMembership, heuristicMutations, heuristicUnderstanding, heuristicVerdict, validateMutations, dropCommentary, dropFragments, STRONG_TYPES, isStrong, looksLikeCommentary } from "./heuristics";
import { chatJson, RunContext, withFallback } from "./llm";
import { ClusterSchema, LineageSchema, MembershipSchema, MutationsSchema, ReviewSchema, UnderstandingSchema, VerdictSchema } from "./schemas";
import { extract, resolveDate, search, type SearchHit } from "./search";
import { bestExcerpt, clip, moneyCompatible, orgCompatible, sharedContentWords, splitSentences, stemCoverage, excerptStrictlyIn, hashString, speaksTo, normalizeInput, relatedness, snapExcerptToPage, tokenCoverage, truncate, wordCount } from "./text";
import { classifyInput, gatherReports, generalVerdict } from "./general";
import { baselineTree, candidatePairs, dedupeVariants, markSpread, repairTree, validateTree } from "./tree";
import type { ClaimResult, Confidence, PageType, ExtractedInput, LineageEdge, Mutation, SourceRef, Understanding, Variant, Verdict } from "./types";

/** Pages whose best passage scores below this against the claim are not worth a model call. */
export const PREFILTER_SCORE = 0.14;
/** A page must express at least this many distinct elements of the message (when the message has 2 or more). */
export const MIN_VERIFIED_ELEMENTS = 1;
/** A post/forward that shares no specific with the claim still counts as a copy if its wording is at least this similar. */
export const COPY_RESEMBLANCE = 0.3;
export const MIN_EXCERPT_WORDS = 8;
/** A rumor quoted on a fact-check page must be at least this long to count as a clean copy. */
export const MIN_QUOTE_WORDS = 6;
/** A fact-check "contradicts" a statement only if they share at least this many content words. */
export const MIN_CONTRADICTION_OVERLAP = 3;
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

export async function confirmMembership(ctx: RunContext, claim: string, elements: string[], pages: CandidatePage[], claimId: string, anchorText = claim): Promise<Variant[]> {
  // The specific-claim gates (amount, organisation) read the ORIGINAL text too: the model's paraphrase may drop a name or amount.
  const anchors = `${anchorText}\n${claim}`;
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
        const { value } = await withFallback<{ contains: boolean; excerpt: string; normalized: string; pageType: Exclude<PageType, "user_input">; quoted?: string }>(
          ctx,
          "C: confirm",
          "nano",
          async () => {
            const window = focusWindow(p.content, claim);
            const sents = splitSentences(window).slice(0, 70); // full sentences: quotes built from them stay verbatim (only the prompt view is clipped)
            const out = await chatJson(ctx, MembershipSchema, {
              tier: "nano",
              stage: "C: confirm",
              maxTokens: 500,
              messages: [
                { role: "system", content: SYSTEM },
                {
                  role: "user",
                  content: `Claim being traced:\n"""${truncate(claim, 1200)}"""\n\nWeb page (${p.url}), as numbered sentences:\n${sents.map((x) => clip(x, 500)).map((x, i) => `[${i}] ${x}`).join("\n")}\n
${elements.length ? `The message's distinctive elements (a reworded copy still expresses them):\n${elements.map((e, i) => `${i}. ${e}`).join("\n")}\n\n` : ""}Does this page contain a version of the SAME message (the same warning/offer/rumor, even if reworded or with different numbers, places or names)?
- "same_message" or "reworded": the page quotes, forwards or reposts this message, or a fact-check quotes/describes this very message. These count.
- "related_only": same topic but not this message: a news report of one specific incident, a product page, general advice, or a general health/science/consumer explainer that never quotes or describes this circulating message. These do NOT count.
- "unrelated": not about this at all.
"same_specific_claim" is true for the same rumor in another country, city, language or wording, and for copies with different numbers or names. It is false ONLY when the page is about a different named programme, scheme, organisation, product or event that merely resembles this claim (e.g. a different government cash programme, a different company's offer, a different disease or incident).
Answer with SENTENCE NUMBERS from the list above, never with copied text.
Return JSON: {"relation": "same_message"|"reworded"|"related_only"|"unrelated", "contains_version": true only for same_message/reworded, "same_specific_claim": true|false,${elements.length ? ' "evidence": [{"element": element number, "sentence": number of the sentence that expresses it}] listing ONLY elements the page really expresses,' : ""} "excerpt_sentences": [first, last] numbers of the passage (at most 4 sentences) that best shows the message, "quoted_sentences": [first, last] numbers of the rumor exactly as quoted or forwarded on the page WITHOUT the page's own commentary, or null if the page only describes it, "page_type": "debunk"|"news"|"social"|"forum"|"official"|"other"}`,
                },
              ],
            });
            const inRange = (k: number) => Number.isInteger(k) && k >= 0 && k < sents.length;
            const pick = (r: [number, number] | null, max: number) => {
              if (!r || !inRange(r[0]) || !inRange(r[1]) || r[1] < r[0]) return "";
              return sents.slice(r[0], Math.min(r[1], r[0] + max - 1) + 1).join(" ");
            };
            // A real version must express at least two distinct elements, each tied to a real sentence of the page that
            // actually shares words with the element (rejects pages that merely share the topic or a few keywords).
            const verifiedByModel = out.evidence.filter((e) => e.element >= 0 && e.element < elements.length && inRange(e.sentence) && sharedContentWords(sents[e.sentence], elements[e.element]) >= 1).map((e) => e.element);
            // Fallback that does not depend on the model pointing at the right sentence: an element is also expressed if any
            // 3-sentence span of the page covers at least two thirds of its content words.
            const spans = sents.map((_, i) => sents.slice(i, i + 3).join(" "));
            const verifiedByText = elements.map((el, i) => (spans.some((sp) => stemCoverage(el, sp) >= 0.67) ? i : -1)).filter((i) => i >= 0);
            const verified = new Set([...verifiedByModel, ...verifiedByText]);
            const enoughEvidence = elements.length < 2 || verified.size >= MIN_VERIFIED_ELEMENTS;
            // Same specific claim/programme: the model must say so, and a money offer must involve an amount in the same currency.
            const sameClaim = out.same_specific_claim !== false && moneyCompatible(anchors, window) && orgCompatible(anchors, window);
            const counts = out.contains_version && (out.relation === "same_message" || out.relation === "reworded") && enoughEvidence && sameClaim;
            ctx.trace?.push({ kind: "membership", url: p.url, contains: out.contains_version, relation: out.relation, sameSpecificClaim: out.same_specific_claim, moneyOk: moneyCompatible(anchors, window), verifiedElements: verified.size, elements: elements.length, pageType: out.page_type, counts, quotedSentences: out.quoted_sentences, ev: out.evidence.map((e) => `${e.element}->${e.sentence}:${(sents[e.sentence] ?? "OUT_OF_RANGE").slice(0, 60)}`), els: elements });
            if (!counts) return { contains: false, excerpt: "", normalized: "", pageType: out.page_type };
            // A page that merely explains the topic (health, science, shopping) is not a copy of a circulating message.
            if (messageMarkers(window) < 2 && out.page_type !== "social" && out.page_type !== "forum") return { contains: false, excerpt: "", normalized: "", pageType: out.page_type };
            let excerpt: string | null = pick(out.excerpt_sentences, 4) || (h.score >= 0.25 ? h.excerpt : null);
            // The excerpt must show the message, not boilerplate: prefer the passage around the evidence sentences if it resembles the claim more.
            const evSents = [...new Set(out.evidence.filter((e) => inRange(e.sentence)).map((e) => e.sentence))].sort((a, b) => a - b);
            if (evSents.length) {
              const around = sents.slice(evSents[0], Math.min(evSents[evSents.length - 1], evSents[0] + 3) + 1).join(" ");
              if (around && (!excerpt || relatedness(around, claim) > relatedness(excerpt, claim) + 0.05)) excerpt = around;
            }
            // A quoted message is sentence-length; a menu label or slogan is not a version of it.
            if (excerpt && !excerptStrictlyIn(excerpt, p.content)) excerpt = snapExcerptToPage(excerpt, p.content);
            if (!excerpt || wordCount(excerpt) < MIN_EXCERPT_WORDS) return { contains: false, excerpt: "", normalized: "", pageType: out.page_type };
            // A page (fact-check, news, official or post) is a version only if its passage speaks to THIS claim's specifics (names, numbers),
            // not to a different video, story or incident on the same topic.
            const isCommentaryPage = ["debunk", "news", "official"].includes(out.page_type);
            // Fact-check/news/official pages MUST speak to the claim's specifics. A post or forward may also qualify by closely
            // resembling the message's own wording (older copies often lack specifics that were added later).
            const resembles = relatedness(excerpt, claim) >= COPY_RESEMBLANCE;
            if (!speaksTo(anchors, excerpt, 3) && (isCommentaryPage || !resembles)) return { contains: false, excerpt: "", normalized: "", pageType: out.page_type };
            // Fact-check/news/official pages: the node text is ONLY the rumor as quoted on the page, never the article's commentary.
            let quoted = pick(out.quoted_sentences, 4);
            if (quoted && !excerptStrictlyIn(quoted, p.content)) quoted = snapExcerptToPage(quoted, p.content) ?? "";
            return { contains: true, excerpt, normalized: excerpt, pageType: out.page_type, quoted: quoted && wordCount(quoted) >= MIN_QUOTE_WORDS && !looksLikeCommentary(quoted) ? quoted : "" };
          },
          // With a model configured, a page the model could not confirm is NOT admitted on heuristics alone
          // (only the no-model/offline path may rely on them): unverified pages must not enter the tree.
          () => ({ contains: !llmAvailable("nano") && h.contains, excerpt: h.excerpt, normalized: h.excerpt, pageType: guessPageType(p.url, p.title, p.content), quoted: "" }),
        );
        checked++;
        if (checked % 5 === 0 || checked === pages.length) ctx.stage("C", `Checking pages… ${checked}/${pages.length}`, claimId);
        if (!value.contains || !value.excerpt) return null;
        const commentaryPage = ["debunk", "news", "official"].includes(value.pageType);
        const quoted = commentaryPage && value.quoted ? clip(value.quoted, 600) : "";
        // A fact-check page without a clean quoted copy stays as a dated evidence node (no changes are labelled on its edges).
        const isCopy = !commentaryPage || !!quoted;
        const excerpt = quoted || clip(value.excerpt, 600);
        // Use the model's normalized wording only if it is really the page's wording; otherwise the verbatim excerpt.
        const normalized = value.normalized ? clip(normalizeInput(value.normalized), 600) : "";
        const useNormalized = !commentaryPage && wordCount(normalized) >= 4 && tokenCoverage(normalized, p.content) >= 0.85;
        return {
          id: `v${idx}-${hashString(p.url).slice(0, 5)}`,
          text: quoted || (useNormalized ? normalized : excerpt),
          excerpt,
          sources: [{ url: p.url, title: p.title, excerpt, pageType: value.pageType, date: p.date, dateProvenance: p.dateProvenance }],
          date: p.date,
          dateProvenance: p.dateProvenance,
          pageType: value.pageType,
          isCopy,
        };
      }),
    ),
  );
  if (skipped) ctx.stage("C", `${skipped} of ${pages.length} pages skipped (no passage resembling the claim)`, claimId);
  return results.filter((v): v is Variant => v !== null);
}

// ── Stage D ────────────────────────────────────────────────────────────────
const SOURCE_LABEL: Record<string, string> = { debunk: "fact-check article", news: "news article", official: "official page", social: "social post", forum: "forum post", user_input: "the message you received", other: "web page" };

/** Label definitions shared by the mutation prompt (Stage D) and the review pass (D2). */
const MUTATION_DEFINITIONS = `- number_changed: a quantity, count, amount, price or percentage differs (200 → 2,000; N30,000 → N50,000). Only for numbers.
- location_changed: a place name differs (Ibadan → Lagos).
- authority_added / authority_removed: a named person, organisation, official body or expert (police, WHO, a doctor, CNN, a ministry) is newly cited as a source or confirmer / is no longer cited.
- urgency_added: new time pressure (urgent, immediately, before Friday).
- date_changed: a date, day or time reference differs.
- target_changed: the group of people said to be at risk or eligible differs (women → children).
- call_to_action_added: a new instruction to forward, share, click, apply, call or register.
- emotional_framing_added: new fear, outrage or pity wording.
- detail_added / detail_removed: a material fact appears or disappears and no label above fits.
- other: only if nothing above fits.`;

/** Map entries in a stable order, so prompts (and the dev cache) don't depend on async completion order. */
const sortedEntries = <V,>(m: Map<string, V>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b));

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
        // Changes are only detected between copies of the message; evidence pages have no clean quoted copy.
        if (pa.isCopy === false || cb.isCopy === false) {
          out.set(pairKey(a, b), []);
          return;
        }
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
${MUTATION_DEFINITIONS}
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


// ── Stage D2: review ───────────────────────────────────────────────────────
/**
 * Super reviews each edge's labels against the exact parent/child text and the label definitions. It may keep,
 * retype or drop a label; it cannot add one or change any text. Every surviving label must still pass the
 * code-level grounding/type checks (validateMutations), so a model "correction" can never invent anything.
 */
export async function reviewMutations(ctx: RunContext, variants: Variant[], edges: LineageEdge[], claimId: string): Promise<{ edges: LineageEdge[]; stats: { reviewed: number; kept: number; retyped: number; dropped: number } }> {
  const stats = { reviewed: 0, kept: 0, retyped: 0, dropped: 0 };
  const byType = (ms: Mutation[]): Mutation[] => ms.map((m) => ({ ...m, strength: STRONG_TYPES.has(m.type) ? "strong" : "weak" }));
  // Without a review model, strength follows the label type alone.
  if (!llmAvailable("super")) return { edges: edges.map((e) => ({ ...e, mutations: byType(e.mutations) })), stats };
  const byId = new Map(variants.map((v) => [v.id, v]));
  const todo = edges.filter((e) => e.mutations.length);
  if (!todo.length) return { edges, stats };
  ctx.stage("D", `Reviewing ${todo.length} edges' mutation labels…`, claimId);
  const limit = pLimit(config.limits.concurrency);
  const reviewed = new Map<string, Mutation[]>();
  await Promise.all(
    todo.map((e) =>
      limit(async () => {
        const earlier = byId.get(e.from)!.text;
        const later = byId.get(e.to)!.text;
        try {
          const out = await chatJson(ctx, ReviewSchema, {
            tier: "super",
            stage: "D2: review labels",
            maxTokens: 700,
            messages: [
              { role: "system", content: SYSTEM },
              {
                role: "user",
                content: `You are reviewing mutation labels between two versions of a circulating message.
EARLIER version (${SOURCE_LABEL[byId.get(e.from)!.pageType] ?? "web page"}):\n"""${truncate(earlier, 900)}"""\nLATER version (${SOURCE_LABEL[byId.get(e.to)!.pageType] ?? "web page"}):\n"""${truncate(later, 900)}"""\n
Note: a fact-check, news or official page mixes the message it quotes with its OWN commentary (calling the message a hoax, advice to readers, the history or spread of the hoax, "no evidence"). Only the message itself counts as content; the page's commentary never does.

Label definitions:
${MUTATION_DEFINITIONS}

Proposed labels (index. type: what EARLIER says → what LATER says):
${e.mutations.map((m, i) => `${i}. ${m.type}: ${m.before ? `EARLIER says "${m.before}"` : "EARLIER has nothing like it"} → ${m.after ? `LATER says "${m.after}"` : "LATER no longer has it"}`).join("\n")}

For EACH label decide:
- "keep": the change is real, the "after" content is asserted in the LATER version as part of the message, it is NOT already conveyed in the EARLIER version (even in other words), and the type is correct.
- "retype": the change is real but the type is plainly wrong for the words involved; give the single correct type. If the proposed type already fits, keep it; never retype between two types that both fit.
- "drop": any of these: the content is already in the EARLIER version (restated or reworded); it is commentary about the message (a fact-checker or page saying "this is a hoax", "no evidence") rather than part of the message; it describes what scammers or the hoax do rather than telling the reader to act (not call_to_action_added); a product, app or platform name labelled as an authority or a place; a trivial or meaningless difference; for detail_removed, authority_removed or number changes, the LATER version still conveys the same thing in other words or only drops a name or number while keeping the claim (a removal means the idea is really absent from the LATER version). A source that was cited in the EARLIER version and is truly not cited in the LATER one IS a valid authority_removed: keep it.
You may only judge the labels listed: do not add labels and do not change any text. Return JSON: {"labels":[{"index": number, "verdict": "keep"|"retype"|"drop", "type": new type only when retyping, "reason": "five words"}]}`,
              },
            ],
          });
          const verdicts = new Map(out.labels.map((l) => [l.index, l]));
          const kept: Mutation[] = [];
          ctx.trace?.push({ kind: "review", from: e.from, to: e.to, earlier, later, labels: e.mutations.map((m, i) => ({ type: m.type, before: m.before, after: m.after, verdict: verdicts.get(i)?.verdict ?? "keep(unreviewed)", retype: verdicts.get(i)?.type, reason: verdicts.get(i)?.reason })) });
          e.mutations.forEach((m, i) => {
            stats.reviewed++;
            const v = verdicts.get(i);
            // strong = Super confirmed it unchanged AND it is a high-signal type; a retyped or unreviewed label is weak.
            if (!v || v.verdict === "keep") {
              kept.push({ ...m, strength: v && STRONG_TYPES.has(m.type) ? "strong" : "weak" });
              stats.kept++;
            } else if (v.verdict === "retype" && v.type && v.type !== m.type) {
              // A retyped label must still be grounded and fit its new type, otherwise it is dropped.
              const fixed = validateMutations([{ ...m, type: v.type }], earlier, later);
              if (fixed.length) {
                kept.push({ ...fixed[0], strength: "weak" });
                stats.retyped++;
              } else stats.dropped++;
            } else if (v.verdict === "retype") {
              kept.push({ ...m, strength: STRONG_TYPES.has(m.type) ? "strong" : "weak" });
              stats.kept++;
            } else stats.dropped++;
          });
          reviewed.set(`${e.from}>${e.to}`, kept);
        } catch {
          /* review unavailable for this edge: keep the validated labels as they are */
        }
      }),
    ),
  );
  // Edges whose review call failed keep their validated labels, all marked weak (unconfirmed).
  return { edges: edges.map((e) => ({ ...e, mutations: reviewed.get(`${e.from}>${e.to}`) ?? e.mutations.map((m) => ({ ...m, strength: "weak" as const })) })), stats };
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
            content: `Variants of one viral message (id | date | text):\n${variants.map((v) => `${v.id} | ${v.date ?? "unknown"} | ${truncate(v.text, 220)}`).join("\n")}\n\nPairwise mutations found:\n${sortedEntries(mutations)
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
        timeoutMs: 170_000, // Ultra can queue for a minute or more on shared/free tiers
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `You are refining a likely-lineage tree of one viral message. Nodes (id | date | date provenance | source type | text):
${variants.map((v) => `${v.id} | ${v.date ?? "unknown"} | ${v.dateProvenance} | ${v.isCopy === false ? "EVIDENCE" : v.pageType} | ${truncate(v.text, 260)}`).join("\n")}

Baseline tree (minimum spanning tree on wording, parent never later than child when both dated):
${baseline.edges.map((e) => `${e.from} -> ${e.to}`).join("\n")}

Mutations between candidate pairs:
${sortedEntries(mutations).slice(0, 80).map(([k, ms]) => `${k}: ${ms.map((m) => m.type).join(", ") || "none"}`).join("\n")}

Refine parent edges using mutation logic (a child usually inherits its parent's changes and adds new ones). Constraints: use ONLY the ids above, do NOT add nodes, exactly one root, every other node has exactly one parent, a parent can never be dated after its child, EXCEPT that pages marked EVIDENCE are not copies of the message: they must be leaves, hang under the copy they discuss, and may be dated before it. "you" is the user's copy and must be a leaf.
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
async function verdict(ctx: RunContext, claim: string, variants: Variant[], edges: LineageEdge[], earliestId: string | null, limited: boolean, evolution: string, u_sensitive = false): Promise<Verdict> {
  const strongEdges = edges.map((e) => ({ ...e, mutations: e.mutations.filter(isStrong) }));
  const fallback = () => heuristicVerdict(variants, strongEdges, earliestId, limited);
  // A limited family with no fact-check/official source gives a model nothing real to summarise; say so plainly
  // instead of letting it narrate unrelated pages. (Finding little is not evidence the claim is true or false.)
  const hasEvidence = variants.some((v) => !v.isUserInput && v.sources.some((s) => s.pageType === "debunk" || s.pageType === "official"));
  if (limited && !hasEvidence) return fallback();
  const sourcesByUrl = new Map(variants.flatMap((v) => v.sources.map((s) => [s.url, s] as const)));
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
Detected changes along the tree: ${edges.flatMap((e) => e.mutations.filter(isStrong).map((m) => `${m.type}: ${m.before}→${m.after}`)).slice(0, 25).join("; ") || "none recorded"}
Evidence from fact-check/official/news sources:\n${evidence.join("\n") || "(none found)"}
Family size: ${variants.length - 1} related versions found${limited ? " (LIMITED family)" : ""}.

${limited ? "The family is LIMITED: say plainly that few earlier versions were found and that this does not show the claim is true or false. Do not describe pages that are not about this claim.\n" : ""}${u_sensitive ? "This topic is sensitive (ethnic, religious, conflict or security): use strictly neutral, factual wording, attribute every claim to its source, never characterise a group, and do not repeat inflammatory language.\n" : ""}Never suggest the claim is false, doubtful or "just a rumor" unless a listed source directly contradicts this exact claim; pages about a different video, story or incident do not count. Write a calm, non-preachy verdict. Say "earliest version found" (not "origin"). Only mark statements as unsupported if a listed source contradicts them, and cite those exact URLs. Never call anything definitely fake.
reply_card: under 60 words, for a family WhatsApp group; kind, never condescending, no links.
Return JSON: {"summary": 2-3 sentences, "what_changed": [short lines], "unsupported": [{"statement": string, "source_urls": [url]}], "confidence": "low"|"medium"|"high", "reply_card": string}`,
          },
        ],
      });
      if (wordCount(out.reply_card) > 60) throw new Error("reply card over 60 words");
      return {
        summary: out.summary,
        whatChanged: out.what_changed,
        // A source only "contradicts" a statement if it is a fact-check/official page that shares the statement's specifics.
        unsupported: out.unsupported
          .map((u) => ({
            statement: u.statement,
            sourceUrls: u.source_urls.filter((x) => {
              const src = sourcesByUrl.get(x);
              return !!src && (src.pageType === "debunk" || src.pageType === "official") && speaksTo(u.statement, src.excerpt, MIN_CONTRADICTION_OVERLAP);
            }),
          }))
          .filter((u) => u.sourceUrls.length),
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
  // Stage A0: is this a circulating message, or a general statement about current events?
  const cls = await classifyInput(ctx, claimText, input);
  if (cls.kind === "general_statement") {
    // Rootline traces how MESSAGES spread. A plain statement about ongoing events gets no lineage tree and no implied doubt:
    // only what reputable sources report, with links.
    const reports = await gatherReports(ctx, claimText, cls.newsQueries, cls.sensitive, claimId);
    const user = userInputVariant(input, claimText);
    return {
      claimId,
      claim: claimText,
      kind: "general",
      reports,
      understanding: { claim: claimText, entities: [], numbers: [], places: [], authorities: [], callToAction: null, queries: cls.newsQueries, keyElements: [], language: input.language, inputKind: "general_statement", sensitive: cls.sensitive },
      variants: [user],
      edges: [],
      earliestId: null,
      limited: false,
      verdict: generalVerdict(reports),
      branches: [],
      stats: { queries: cls.newsQueries.length, pagesSearched: reports.length, pagesConfirmed: reports.length, pairsCompared: 0 },
      warnings: [],
    };
  }
  const u = { ...(await understand(ctx, claimText, input)), inputKind: "circulating_message" as const, sensitive: cls.sensitive };

  ctx.stage("B", `Searching the web with ${u.queries.length} queries…`, claimId);
  const pages = await findRelatives(ctx, u, claimId);
  if (!pages.length) warnings.push("Search returned no pages. Check your search configuration or try different wording.");

  ctx.stage("C", `Checking ${pages.length} pages for versions of this message…`, claimId);
  const confirmed = await confirmMembership(ctx, u.claim || claimText, u.keyElements, pages, claimId, claimText);
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

  // Ultra may re-parent nodes: run the same model-based change detection on any final copy→copy edge Stage D never compared.
  const unanalysed = lin.edges.filter((e) => !mutations.has(pairKey(e.from, e.to)) && variants.find((v) => v.id === e.from)?.isCopy !== false && variants.find((v) => v.id === e.to)?.isCopy !== false);
  if (unanalysed.length) {
    const extra = await analyseMutations(ctx, variants, unanalysed.map((e) => [e.from, e.to] as [string, string]), claimId);
    for (const [k, v] of extra) mutations.set(k, v);
  }
  // Fill mutations for every final edge (heuristic for any pair the model didn't analyse).
  let edges: LineageEdge[] = lin.edges.map((e) => ({
    ...e,
    // Pairs the model never saw (Ultra re-parented a node) get rule-based labels, held to the same validator.
    mutations:
      mutations.get(pairKey(e.from, e.to)) ??
      validateMutations(
        heuristicMutations(variants.find((v) => v.id === e.from)!.text, variants.find((v) => v.id === e.to)!.text),
        variants.find((v) => v.id === e.from)!.text,
        variants.find((v) => v.id === e.to)!.text,
      ),
  }));
  // No changes are labelled on edges that touch an evidence page without a clean quoted copy.
  edges = edges.map((e) => {
    const ends = [variants.find((v) => v.id === e.from), variants.find((v) => v.id === e.to)];
    return ends.some((v) => v?.isCopy === false) ? { ...e, mutations: [], evidenceOnly: true } : e;
  });
  // Drop labels that are a fact-checker's own commentary rather than message content, then let Super review the rest.
  edges = edges.map((e) => ({ ...e, mutations: dropFragments(dropCommentary(e.mutations, variants.find((v) => v.id === e.to)?.pageType ?? "other", variants.find((v) => v.id === e.from)?.pageType)) }));
  const review = await reviewMutations(ctx, variants, edges, claimId);
  edges = review.edges.map((e) => capConfidence(e, variants));
  edges = markSpread(variants, edges);
  for (const e of edges) ctx.emit({ type: "edge", claimId, edge: e });
  for (const b of branches) for (const id of b.variantIds) {
    const v = variants.find((x) => x.id === id);
    if (v && !v.branch) v.branch = b.name;
  }

  ctx.stage("G", "Writing summary and reply card…", claimId);
  // "Earliest version found" is the earliest dated page of any kind (a copy or an evidence page); the tree's root is a copy.
  // On sensitive topics (ethnic, religious, conflict, security) a social/forum post by another party is never presented as the "earliest version".
  const datedPages = variants.filter((v) => !v.isUserInput && v.date && !(u.sensitive && ["social", "forum", "other"].includes(v.pageType))).sort((a, b) => a.date!.localeCompare(b.date!));
  const earliestId = datedPages[0]?.id ?? (!u.sensitive && lin.rootId && !variants.find((v) => v.id === lin.rootId)?.isUserInput ? lin.rootId : null);
  const v = await verdict(ctx, claimText, variants, edges, earliestId, limited, lin.summary, !!u.sensitive);

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
    stats: { queries: u.queries.length, pagesSearched: pages.length, pagesConfirmed: confirmed.length, pairsCompared: pairs.length, mutationReview: review.stats },
    warnings,
  };
}
