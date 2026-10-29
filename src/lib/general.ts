// General statements about current events are not forwarded messages: Rootline traces how MESSAGES spread, so for
// these it builds no lineage and implies no doubt. It reports what reputable sources say, neutrally, with links.
import pLimit from "p-limit";
import { z } from "zod";
import { chatJson, RunContext, withFallback } from "./llm";
import { search, resolveDate, type SearchHit } from "./search";
import { clip, splitSentences, stemCoverage, wordCount } from "./text";
import type { ExtractedInput, SourceReport, Verdict } from "./types";

export type InputKind = "circulating_message" | "general_statement";

export const GENERAL_LEAD = "This looks like a general statement about current events, not a forwarded message. Rootline traces how messages spread. Here's what reputable sources report:";

// ── Heuristics (also the no-model fallback) ──────────────────────────────────
const CHAIN_CTA = /\b(?:forward(?:ed)?(?: this| it)?|share (?:this|it|with|to)|pass (?:it|this) on|pass this|send this|tell (?:everyone|every|all|your)|spread the word|broadcast|copy (?:and|&) paste|repost|retweet|don'?t keep (?:quiet|silent)|please share)\b/i;
const CHAIN_ALARM = /\b(?:urgent|warning|alert|beware|breaking|confirmed by|hurry|last chance|before (?:friday|midnight)|click (?:here|the link|below)|register now|apply now)\b/i;

/** Signs that a text is a chain forward / scam / hoax-style warning rather than a plain statement. */
export function chainMarkers(text: string): { strong: boolean; count: number } {
  const caps = (text.match(/\b[A-Z]{4,}\b/g) ?? []).length;
  const exclam = (text.match(/!/g) ?? []).length;
  const strong = CHAIN_CTA.test(text);
  const count = (strong ? 2 : 0) + (CHAIN_ALARM.test(text) ? 1 : 0) + (caps >= 2 ? 1 : 0) + (exclam >= 3 ? 1 : 0);
  return { strong, count };
}

const SENSITIVE_RE = /\b(?:fulani|herdsm[ae]n|herders?|farmers?[- ]herders?|boko haram|iswap|bandits?|militants?|militias?|terror\w*|jihad\w*|genocide|ethnic|tribal|tribe|communal|sectarian|christians?|muslims?|hindus?|sikhs?|jews?|jewish|islamist|insurgen\w*|massacre|clash(?:es|ing)?|killings?|kidnap\w*|abduct\w*|attacks? on|religious|igbo|hausa|yoruba|biafra|ipob|kashmir|gaza|israel|palestin\w*|rohingya|caste)\b/i;
/** Topics where wording must stay neutral and factual: ethnic, religious, conflict and security subjects. */
export const isSensitiveText = (text: string) => SENSITIVE_RE.test(text);

export function heuristicKind(text: string): InputKind {
  const m = chainMarkers(text);
  return m.strong || m.count >= 2 ? "circulating_message" : "general_statement";
}

// ── Stage A0: classify the input ─────────────────────────────────────────────
const ClassifySchema = z.object({
  input_kind: z.enum(["circulating_message", "general_statement"]).catch("general_statement"),
  sensitive: z.boolean().catch(false),
  news_queries: z.array(z.coerce.string().trim().min(3)).max(4).default([]),
});

export interface Classification {
  kind: InputKind;
  sensitive: boolean;
  newsQueries: string[];
}

/**
 * Circulating message (chain forward, viral post, hoax-style warning, scam offer, specific claim with distinctive wording)
 * vs general statement about ongoing events. Only plain pasted text is classified: screenshots and documents are always
 * treated as messages. A clear chain-forward marker always wins over the model, so real forwards are never downgraded.
 */
export async function classifyInput(ctx: RunContext, claimText: string, input: ExtractedInput): Promise<Classification> {
  const sensitiveByWords = isSensitiveText(claimText);
  if (input.sourceKind !== "text") return { kind: "circulating_message", sensitive: sensitiveByWords, newsQueries: [] };
  const markers = chainMarkers(claimText);
  const { value } = await withFallback(
    ctx,
    "A0: classify input",
    "nano",
    () =>
      chatJson(ctx, ClassifySchema, {
        tier: "nano",
        stage: "A0: classify input",
        maxTokens: 300,
        messages: [
          { role: "system", content: "You classify pasted text for a rumor-tracing tool. Reply with one JSON object and nothing else." },
          {
            role: "user",
            content: `Text:\n"""${clip(claimText, 1500)}"""\n
Classify it:
- "circulating_message": a chain forward, viral post, hoax-style warning, scam offer, or a specific claim with distinctive wording that people copy and forward (calls to share, urgent warnings, specific numbers, names or quotes).
- "general_statement": a general factual or news-style statement about ongoing events or conditions, with no sign of being a copied forward.
If unsure, choose "general_statement": a wrong guess there only means we show reputable reports instead of a lineage tree.
"sensitive": true if it concerns ethnic, religious or communal groups, conflict, terrorism, or security violence.
"news_queries": 2-3 short neutral search queries (no quotation marks) that would find reputable news or official reporting on the topic.
Return JSON: {"input_kind": "circulating_message"|"general_statement", "sensitive": boolean, "news_queries": string[]}`,
          },
        ],
      }),
    () => ({ input_kind: heuristicKind(claimText), sensitive: sensitiveByWords, news_queries: [] as string[] }),
  );
  const kind: InputKind = markers.strong || markers.count >= 2 ? "circulating_message" : value.input_kind;
  return { kind, sensitive: value.sensitive || sensitiveByWords, newsQueries: value.news_queries.map((q) => q.replace(/"/g, "")) };
}

// ── Reputable-source reports for general statements ──────────────────────────
const NOT_REPUTABLE_HOST = /(^|\.)(facebook|instagram|twitter|x|tiktok|youtube|youtu|reddit|quora|medium|substack|linkedin|pinterest|telegram|t|wordpress|blogspot|tumblr|nairaland|scribd)\.(com|be|me|co|net)$/i;
const OFFICIAL_HOST = /(^|\.)(un\.org|unhcr\.org|ochaopt\.org|unocha\.org|reliefweb\.int|who\.int|worldbank\.org|state\.gov|europa\.eu)$|\.gov(\.[a-z]{2})?$|\.int$/i;
const KNOWN_REPUTABLE = new RegExp(`${OFFICIAL_HOST.source}|(^|\\.)(bbc\\.(com|co\\.uk)|reuters\\.com|apnews\\.com|aljazeera\\.com|dw\\.com|theguardian\\.com|nytimes\\.com|washingtonpost\\.com|cnn\\.com|france24\\.com|voanews\\.com|channelstv\\.com|punchng\\.com|premiumtimesng\\.com|thecable\\.ng|vanguardngr\\.com|guardian\\.ng|thehindu\\.com|indianexpress\\.com|folha\\.uol\\.com\\.br|g1\\.globo\\.com)$`, "i");
const FACT_CHECK_HOST = /snopes|factcheck|fact-check|africacheck|dubawa|politifact|fullfact|boomlive|altnews|factly|newsmeter|logically|misbar/i;

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const ReportsSchema = z.object({
  reports: z
    .array(
      z.object({
        index: z.coerce.number().int().catch(-1),
        relevant: z.boolean().catch(false),
        kind: z.enum(["news", "official", "research", "opinion", "social", "fact_check", "other"]).catch("other"),
        summary: z.coerce.string().default(""),
      }),
    )
    .default([]),
});

export const MAX_REPORTS = 5;

/** Is this sentence-level summary traceable to the source text (rather than the model's own words or opinions)? */
export function summaryIsGrounded(summary: string, source: string): boolean {
  return wordCount(summary) >= 4 && wordCount(summary) <= 45 && stemCoverage(summary, source) >= 0.55;
}

function snippetSummary(hit: SearchHit): string {
  const s = splitSentences(hit.content).find((x) => wordCount(x) >= 6) ?? hit.title;
  return `According to ${hostOf(hit.url)}: ${clip(s, 220)}`;
}

export async function gatherReports(ctx: RunContext, claimText: string, extraQueries: string[], sensitive: boolean, claimId: string): Promise<SourceReport[]> {
  const base = claimText.replace(/\s+/g, " ").slice(0, 160);
  const queries = [...new Set([...extraQueries, base].map((q) => q.trim()).filter(Boolean))].slice(0, 3);
  ctx.stage("B", `Looking for reputable reports (${queries.length} searches)…`, claimId);
  const limit = pLimit(3);
  const hits = new Map<string, SearchHit>();
  await Promise.all(
    queries.map((q, i) =>
      limit(async () => {
        try {
          for (const h of await search(ctx, q, { maxResults: 8, topic: i < 2 ? "news" : "general", stage: "B: reports" })) {
            const host = hostOf(h.url);
            if (NOT_REPUTABLE_HOST.test(host) || FACT_CHECK_HOST.test(host)) continue; // never social/blog posts or fact-checks of other stories
            if (!hits.has(h.url)) hits.set(h.url, h);
          }
        } catch {
          /* logged */
        }
      }),
    ),
  );
  const list = [...hits.values()].slice(0, 10);
  if (!list.length) return [];

  ctx.stage("C", `Reading ${list.length} candidate reports…`, claimId);
  const { value: judged } = await withFallback(
    ctx,
    "C: reports",
    "nano",
    () =>
      chatJson(ctx, ReportsSchema, {
        tier: "nano",
        stage: "C: reports",
        maxTokens: 1000,
        timeoutMs: 120_000,
        messages: [
          { role: "system", content: "You select and neutrally summarise reputable reporting. Use only the text given. Reply with one JSON object and nothing else." },
          {
            role: "user",
            content: `Statement a user pasted:\n"""${clip(claimText, 600)}"""\n
Candidate search results (index | publisher | title | excerpt):
${list.map((h, i) => `${i} | ${hostOf(h.url)} | ${clip(h.title, 120)} | ${clip(h.content, 450)}`).join("\n")}\n
For each result decide:
- "relevant": true only if it directly reports on the topic of the statement (same events, place and period).
- "kind": "news" (a recognised news organisation reporting), "official" (a government, UN or intergovernmental body, or an established NGO's own statement or report), "research" (a study or institute report), or "opinion", "social", "fact_check", "other". Opinion pieces, commentary, advocacy, social or blog posts, forums and fact-checks of a specific video or story are NOT acceptable sources.
- "summary": ONE neutral sentence (at most 30 words) saying what that source reports, attributed to it ("According to X, …" or "X reports that …"), using only what its excerpt says. No judgement of whether the statement is true or false, no characterisation of any ethnic, religious or other group, no speculation, no adjectives not in the excerpt.${sensitive ? "\nThis topic is sensitive (ethnic, religious, conflict or security). Keep the wording strictly factual and neutral; do not repeat inflammatory language; attribute every figure to its source." : ""}
Return JSON: {"reports": [{"index": number, "relevant": boolean, "kind": string, "summary": string}]}`,
          },
        ],
      }),
    // Without a model we cannot judge reputation or relevance: only hosts that are recognisably established news or
    // official sources are kept, with a plain quote of their own words.
    () => ({
      reports: list
        .map((h, i) => ({ index: i, relevant: KNOWN_REPUTABLE.test(hostOf(h.url)), kind: (OFFICIAL_HOST.test(hostOf(h.url)) ? "official" : "news") as "news" | "official", summary: snippetSummary(h) }))
        .filter((r) => r.relevant),
    }),
  );

  const out: SourceReport[] = [];
  const seenHosts = new Set<string>();
  for (const j of judged.reports) {
    const h = list[j.index];
    if (!h || !j.relevant || !["news", "official", "research"].includes(j.kind)) continue;
    const host = hostOf(h.url);
    if (seenHosts.has(host)) continue;
    const source = `${h.title}. ${h.content}`;
    const summary = summaryIsGrounded(j.summary, source) ? clip(j.summary.trim(), 260) : snippetSummary(h);
    const { date, provenance } = resolveDate(h.publishedDate, null);
    seenHosts.add(host);
    out.push({ url: h.url, title: clip(h.title, 160), publisher: host, kind: j.kind as SourceReport["kind"], date, dateProvenance: provenance, summary, excerpt: clip(h.content, 400) });
    if (out.length >= MAX_REPORTS) break;
  }
  return out;
}

// ── Neutral verdict: never implies doubt without a source that directly contradicts the claim ──
export function generalVerdict(reports: SourceReport[]): Verdict {
  const names = reports.slice(0, 3).map((r) => r.publisher);
  const replyCard = reports.length
    ? `I looked into this. It reads as a general statement about current events, not a forwarded rumor. News and official sources report on it, for example ${names.join(", ")}. It's worth reading them directly before sharing.`
    : "I looked into this. It reads as a general statement about current events, not a forwarded rumor, and Rootline couldn't find reputable reports to cite. That doesn't mean it is true or false. Worth checking trusted news outlets directly before sharing.";
  return {
    summary: reports.length ? GENERAL_LEAD : `${GENERAL_LEAD.replace("Here's what reputable sources report:", "")}Rootline did not find reputable reports to cite. That is not evidence that the statement is true or false.`.trim(),
    whatChanged: [],
    unsupported: [],
    confidence: "low",
    replyCard,
  };
}

