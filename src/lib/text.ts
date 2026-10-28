// Text normalization and similarity utilities (pure, unit-tested).

const FORWARD_JUNK = [
  /^\s*\[?\d{1,2}[/.]\d{1,2}[/.]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]m)?\]?\s*(?:-\s*)?[^:\n]{1,40}:\s*/gim, // WhatsApp export prefix
  /^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/gim,
  /^\s*forwarded( many times| as received)?\s*$/gim,
  /^\s*(?:copied|copy and paste|as received|received as is)\s*\.?\s*$/gim,
  /^\s*(?:fwd|fw)\s*:\s*/gim,
];

// Pictographic emoji, variation selectors, ZWJ and skin tones.
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍️]/gu;

/** Strip forwarding junk, chat formatting and emoji noise from a pasted message. */
export function normalizeInput(raw: string): string {
  let s = raw.replace(/\r\n?/g, "\n");
  for (const re of FORWARD_JUNK) s = s.replace(re, "");
  s = s.replace(EMOJI, " ");
  // WhatsApp/Telegram formatting markers: *bold*, _italic_, ~strike~, ```mono```
  s = s.replace(/```/g, "");
  s = s.replace(/(^|[\s(])[*_~]+(\S[^\n]*?\S|\S)[*_~]+(?=[\s.,!?)]|$)/g, "$1$2");
  // Repeated punctuation like "!!!!" or "....."
  s = s.replace(/([!?])\1{1,}/g, "$1").replace(/\.{4,}/g, "...");
  s = s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Lowercased, punctuation-free form used for comparison only (never displayed as a quote). */
export function canonical(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const STOPWORDS = new Set(
  "a an the and or but if of to in on at by for with from as is are was were be been being this that these those it its into than then so such not no do does did have has had you your yours we our us they them their he she his her i me my all any every some will would can could should may might must just also very please there here what which who whom when where why how about over after before up out more most other only own same too s t don now dey go make una abeg na".split(
    " ",
  ),
);

export function tokens(s: string): string[] {
  return canonical(s).split(" ").filter(Boolean);
}

export function contentTokens(s: string): string[] {
  return tokens(s).filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

function shingles(s: string, n = 3): Set<string> {
  const c = canonical(s).replace(/ /g, "_");
  const out = new Set<string>();
  if (c.length < n) {
    if (c) out.add(c);
    return out;
  }
  for (let i = 0; i <= c.length - n; i++) out.add(c.slice(i, i + n));
  return out;
}

/** Jaccard similarity over character trigrams, 0..1. Robust to small rewordings. */
export function similarity(a: string, b: string): number {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Token-set overlap (containment of the smaller in the larger), 0..1. */
export function tokenOverlap(a: string, b: string): number {
  const A = new Set(contentTokens(a));
  const B = new Set(contentTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** Combined score used for membership and distances. */
export function relatedness(a: string, b: string): number {
  return 0.5 * similarity(a, b) + 0.5 * tokenOverlap(a, b);
}

export function splitSentences(s: string): string[] {
  return s
    .replace(/\n+/g, "\n")
    .split(/(?<=[.!?])\s+|\n/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/**
 * Find the window of consecutive sentences in `page` that best matches `claim`.
 * Returns the exact substring from the page (so excerpts are always real quotes).
 */
export function bestExcerpt(page: string, claim: string, maxSentences = 6): { excerpt: string; score: number } {
  const sents = splitSentences(page).slice(0, 600);
  let best = { excerpt: "", score: 0 };
  for (let i = 0; i < sents.length; i++) {
    let acc = "";
    for (let k = 0; k < maxSentences && i + k < sents.length; k++) {
      acc = acc ? `${acc} ${sents[i + k]}` : sents[i + k];
      if (acc.length > 900) break;
      const score = relatedness(acc, claim);
      if (score > best.score + 0.005) best = { excerpt: acc, score };
    }
  }
  return best;
}

/** True if `excerpt` really appears in `page` (whitespace/case/punctuation-insensitive). */
export function excerptAppearsIn(excerpt: string, page: string): boolean {
  const e = canonical(excerpt);
  if (e.length < 12) return false;
  const p = canonical(page);
  if (p.includes(e)) return true;
  // allow the model to trim the ends slightly: check that 90% of a sliding prefix matches
  const words = e.split(" ");
  if (words.length < 6) return false;
  const head = words.slice(0, Math.ceil(words.length * 0.5)).join(" ");
  const tail = words.slice(Math.floor(words.length * 0.5)).join(" ");
  return p.includes(head) && p.includes(tail);
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Word-level diff summary: words only in a, words only in b (order-preserving, de-duplicated). */
export function wordDiff(a: string, b: string): { removed: string[]; added: string[] } {
  const A = tokens(a);
  const B = tokens(b);
  const setA = new Set(A);
  const setB = new Set(B);
  const removed = [...new Set(A.filter((w) => !setB.has(w)))];
  const added = [...new Set(B.filter((w) => !setA.has(w)))];
  return { removed, added };
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

export function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Remove phone numbers and emails (privacy: never keep unrelated private details). */
export function redactPrivate(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email removed]")
    .replace(/(?:\+?\d[\d\s-]{8,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "[number removed]" : m));
}

/** Strict check: the excerpt appears in the page after case/punctuation/whitespace normalisation (no trimmed-ends leniency). */
export function excerptStrictlyIn(excerpt: string, page: string): boolean {
  const e = canonical(excerpt);
  return e.length >= 12 && canonical(page).includes(e);
}

/**
 * Make a model-provided excerpt verbatim: strip ellipses and, if the excerpt stitched together separate
 * passages ("A ... B"), keep the longest segment that really appears on the page. Returns null if none does.
 */
export function snapExcerptToPage(excerpt: string, page: string): string | null {
  const trimmed = excerpt.trim().replace(/^[.…\s]+|[.…\s]+$/g, (m) => (/[.!?]$/.test(m.trim()) && m.trim().length === 1 ? m : ""));
  if (excerptStrictlyIn(trimmed, page)) return trimmed;
  const segs = excerpt
    .split(/\.{3,}|…|\[\.\.\.\]|\s\|\s/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 30 && excerptStrictlyIn(x, page))
    .sort((a, b) => b.length - a.length);
  return segs[0] ?? null;
}

/** Clip to at most n characters at a word boundary, WITHOUT appending an ellipsis (quotes must stay verbatim). */
export function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).trimEnd();
}

/** Share of the content tokens of `a` that also occur in `b`. */
export function tokenCoverage(a: string, b: string): number {
  const A = contentTokens(a);
  if (!A.length) return 0;
  const B = new Set(contentTokens(b));
  return A.filter((t) => B.has(t)).length / A.length;
}

/** Very light stemmer for overlap checks only (plurals, -ing/-ed). */
export function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}

/** Number of distinct (stemmed) content words two texts share. */
export function sharedContentWords(a: string, b: string): number {
  const A = new Set(contentTokens(a).map(stem));
  return new Set(contentTokens(b).map(stem).filter((t) => A.has(t))).size;
}

/** The statement's specifics: tokens with digits, and capitalised words that don't merely start a sentence. */
export function specificTokens(statement: string): string[] {
  const out: string[] = [];
  const sentences = statement.split(/(?<=[.!?])\s+/);
  for (const sent of sentences) {
    const words = sent.split(/\s+/).filter(Boolean);
    words.forEach((w, i) => {
      const clean = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (clean.length < 2) return;
      if (/\d/.test(clean) || (i > 0 && /^\p{Lu}/u.test(clean) && !/^(?:I|The|A|An|And|Of|In|On|At|To|For|It|This|That|Please)$/.test(clean))) out.push(stem(canonical(clean)));
    });
  }
  return [...new Set(out)].filter(Boolean);
}

/**
 * Does `source` really speak to `statement`? It must share enough general content words, and, if the statement names
 * specifics (an organisation, a number, a date), at least one of those specifics must appear in the source too.
 */
export function speaksTo(statement: string, source: string, minShared = 3): boolean {
  if (sharedContentWords(statement, source) < minShared) return false;
  const spec = specificTokens(statement);
  if (!spec.length) return true;
  const src = new Set(canonical(source).split(" ").map(stem));
  return spec.some((t) => src.has(t));
}

/** Like tokenCoverage but compares stems ("hacks" ~ "hack", "samples" ~ "sample"). */
export function stemCoverage(a: string, b: string): number {
  const A = [...new Set(contentTokens(a).map(stem))];
  if (!A.length) return 0;
  const B = new Set(contentTokens(b).map(stem));
  return A.filter((t) => B.has(t)).length / A.length;
}

const CURRENCY_RE = /(₦|\bNGN\s?|\bN(?=\s?\d)|\$|£|€|\bRs\.?\s?|\bR\$\s?|\bUSD\s?|\bGHS\s?|\bKES\s?)\s?\d[\d,.]*/gi;
function currencyFamily(sym: string): string {
  const x = sym.trim().toLowerCase().replace(/\s/g, "");
  if (x === "₦" || x === "ngn" || x === "n") return "ngn";
  if (x.startsWith("rs")) return "inr";
  if (x === "r$") return "brl";
  if (x === "$" || x === "usd") return "usd";
  return x;
}
/** Currencies (as families) in which a text states an amount, e.g. "N30,000" → ngn. */
export function currenciesIn(text: string): Set<string> {
  return new Set([...text.matchAll(CURRENCY_RE)].map((m) => currencyFamily(m[1])));
}
/**
 * Money-offer claims ("the government is giving N30,000") are only the same claim as a page that talks about an amount
 * in the same currency. A page whose only amounts are in another currency/programme (e.g. "$322.5m recovered funds")
 * is a different story. Claims with no currency amount are unconstrained.
 */
export function moneyCompatible(claim: string, page: string): boolean {
  const need = currenciesIn(claim);
  if (!need.size) return true;
  const have = currenciesIn(page);
  return [...need].some((c) => have.has(c));
}

const ORG_RE = /\b((?:[A-Z][A-Za-z]+\s+){0,5}(?:Office|Ministry|Agency|Commission|Department|Council|Board|Bureau|Authority|Institute|Corporation|Committee)(?:\s+(?:of|for)\s+(?:[A-Z][A-Za-z]+\s*){1,4})?)/g;
const ORG_GENERIC = new Set("federal national state office ministry department agency commission council board bureau authority institute corporation committee of for the and public government nigeria nigerian ghana kenya india indian brazil united".split(" "));
/** Distinctive words of organisations named in a claim ("Federal Office of Civic Readiness" → civic, readines). */
export function orgTokens(claim: string): string[] {
  const out = new Set<string>();
  for (const m of claim.matchAll(ORG_RE)) for (const w of canonical(m[1]).split(" ")) if (w.length > 2 && !ORG_GENERIC.has(w)) out.add(stem(w));
  return [...out];
}
/**
 * If the claim names an issuing organisation (typical for circulars and notices), a page can only be about the same
 * specific claim if it mentions a distinctive word of that organisation's name; a different body's similar announcement is not a version.
 */
export function orgCompatible(claim: string, page: string): boolean {
  const need = orgTokens(claim);
  if (!need.length) return true;
  const have = new Set(canonical(page).split(" ").map(stem));
  // The whole distinctive name must appear (a page that only shares one word, like "civic", is a different body).
  const hits = need.filter((t) => have.has(t)).length;
  return hits >= (need.length <= 3 ? need.length : Math.ceil(need.length * 0.6));
}
