// The Rootline core pipeline: Understand → Find relatives → Confirm → Mutations → Cluster → Lineage → Verdict.
import pLimit from "p-limit";
import { config } from "./config";
import { guessPageType, heuristicMembership, heuristicMutations, heuristicUnderstanding, heuristicVerdict } from "./heuristics";
import { chatJson, RunContext, withFallback } from "./llm";
import { ClusterSchema, LineageSchema, MembershipSchema, MutationsSchema, UnderstandingSchema, VerdictSchema } from "./schemas";
import { extract, resolveDate, search, type SearchHit } from "./search";
import { bestExcerpt, excerptAppearsIn, hashString, normalizeInput, truncate, wordCount } from "./text";
import { baselineTree, candidatePairs, dedupeVariants, markSpread, validateTree } from "./tree";
import type { ClaimResult, ExtractedInput, LineageEdge, Mutation, SourceRef, Understanding, Variant, Verdict } from "./types";
import { MUTATION_TYPES } from "./types";

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
    };
  }, fallback);
  // Always include at least one verbatim distinctive phrase, deduped, capped.
  const h = fallback();
  const queries = [...new Set([...value.queries, ...h.queries.slice(0, 2)].map((q) => q.trim()).filter(Boolean))].slice(0, Math.max(4, config.limits.maxQueries));
  return { ...value, queries };
}

// ── Stage B ────────────────────────────────────────────────────────────────
interface CandidatePage {
  url: string;
  title: string;
  content: string;
  date: string | null;
  dateProvenance: SourceRef["dateProvenance"];
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
    return { url: hit.url, title: hit.title, content: page?.content || hit.content, date, dateProvenance: provenance };
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

async function confirmMembership(ctx: RunContext, claim: string, pages: CandidatePage[], claimId: string): Promise<Variant[]> {
  const limit = pLimit(config.limits.concurrency);
  let checked = 0;
  const results = await Promise.all(
    pages.map((p, idx) =>
      limit(async (): Promise<Variant | null> => {
        const h = heuristicMembership(p.content, claim);
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
Does this page contain a version of the SAME message or claim (possibly reworded, with different numbers/places)? A fact-check that quotes the message counts. A page that merely shares a topic does not.
Return JSON: {"contains_version": boolean, "excerpt": the exact passage copied character-for-character from the page (max 400 chars, "" if none), "normalized": the message version in plain words without commentary, "page_type": "debunk"|"news"|"social"|"forum"|"official"|"other"}`,
                },
              ],
            });
            // Honesty: an excerpt must really appear on the page.
            let excerpt = out.excerpt;
            if (out.contains_version && !excerptAppearsIn(excerpt, p.content)) {
              if (h.score >= 0.2) excerpt = h.excerpt;
              else return { contains: false, excerpt: "", normalized: "", pageType: out.page_type };
            }
            return { contains: out.contains_version, excerpt, normalized: out.normalized || excerpt, pageType: out.page_type };
          },
          () => ({ contains: h.contains, excerpt: h.excerpt, normalized: h.excerpt, pageType: guessPageType(p.url, p.title, p.content) }),
        );
        checked++;
        if (checked % 5 === 0 || checked === pages.length) ctx.stage("C", `Checking pages… ${checked}/${pages.length}`, claimId);
        if (!value.contains || !value.excerpt) return null;
        const excerpt = truncate(value.excerpt, 600);
        return {
          id: `v${idx}-${hashString(p.url).slice(0, 5)}`,
          text: value.normalized && wordCount(value.normalized) >= 4 ? truncate(normalizeInput(value.normalized), 600) : excerpt,
          excerpt,
          sources: [{ url: p.url, title: p.title, excerpt, pageType: value.pageType, date: p.date, dateProvenance: p.dateProvenance }],
          date: p.date,
          dateProvenance: p.dateProvenance,
          pageType: value.pageType,
        };
      }),
    ),
  );
  return results.filter((v): v is Variant => v !== null);
}

// ── Stage D ────────────────────────────────────────────────────────────────
const pairKey = (a: string, b: string) => `${a}>${b}`;

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
List how the LATER version differs. Types: ${MUTATION_TYPES.join(", ")}.
Return JSON: {"mutations": [{"type": one of the types, "before": short text from earlier ("" if added), "after": short text from later ("" if removed), "explanation": one short line}]}. Only list real differences; [] if they say the same thing.`,
                  },
                ],
              })
            ).mutations,
          () => heuristicMutations(pa.text, cb.text),
        );
        out.set(pairKey(a, b), value);
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
      const edges = out.edges.map((e) => ({ from: e.parent, to: e.child }));
      const valid = validateTree(variants, edges);
      if (!valid.ok) throw new Error(`Ultra tree rejected: ${valid.reason}`);
      if (!variants.some((v) => v.id === out.earliest_id)) throw new Error("Ultra earliest_id unknown");
      return { rootId: out.earliest_id as string | null, edges: out.edges.map((e) => ({ from: e.parent, to: e.child, confidence: e.confidence, reason: e.reason, mutations: [] as Mutation[] })), summary: out.evolution_summary };
    },
    () => ({ rootId: baseline.rootId, edges: baseline.edges, summary: "" }),
  );
  return { ...value, usedFallback };
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
  const confirmed = await confirmMembership(ctx, u.claim || claimText, pages, claimId);
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
  const lin = variants.length > 1 ? await lineage(ctx, variants, tree, mutations) : { rootId: tree.rootId, edges: [] as LineageEdge[], summary: "", usedFallback: true };
  if (lin.usedFallback && variants.length > 2) warnings.push("Lineage uses the algorithmic baseline tree (model refinement unavailable).");

  // Fill mutations for every final edge (heuristic for any pair the model didn't analyse).
  let edges: LineageEdge[] = lin.edges.map((e) => ({
    ...e,
    mutations: mutations.get(pairKey(e.from, e.to)) ?? heuristicMutations(variants.find((v) => v.id === e.from)!.text, variants.find((v) => v.id === e.to)!.text),
  }));
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
