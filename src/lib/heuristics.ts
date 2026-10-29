// Deterministic fallbacks for every model stage. Used when a model is not configured, when a
// call fails validation twice, and in OFFLINE_MOCK mode. They are conservative by design.
import { bestExcerpt, canonical, clip, stemCoverage, contentTokens, relatedness, splitSentences, tokens, truncate, wordCount, wordDiff } from "./text";
import type { Confidence, LineageEdge, Mutation, PageType, Understanding, Variant, Verdict } from "./types";

const NUMBER_RE = /(?:[₦$£€]|\bN|\bNGN\s?|\bRs\.?\s?|\bR\$\s?)?\d[\d,.]*(?:\s?(?:k|m|bn|million|billion|thousand|%|percent))?/gi;
const AUTHORITY_RE =
  /\b(?:WHO|UN|UNICEF|police|army|government|federal government|ministry(?: of [A-Z][\w]+(?: [A-Z][\w]+)*)?|minister|president|governor|senator|commissioner|doctor|dr\.? [A-Z][\w-]+(?: [A-Z][\w-]+)?|professor|prof\.? [A-Z][\w-]+|hospital|university|board|council|agency|commission|bureau|office of [A-Z][\w]+(?: [A-Z][\w]+)*)\b/gi;
const URGENCY_RE = /\b(?:urgent|urgently|immediately|tonight|before (?:friday|monday|tuesday|wednesday|thursday|saturday|sunday|midnight|[\w]+ ends)|deadline|last chance|breaking|act fast|hurry|within \d+ (?:hours|days))\b/gi;
const CTA_RE = /\b(?:forward|share|send (?:this|it)|click|apply|register|call|tell (?:everyone|every|your)|broadcast|pass (?:it|this) on|don'?t (?:ignore|keep quiet))\b[^.!?\n]*/gi;
const EMOTION_RE = /\b(?:shocking|horrible|terrifying|evil|wicked|heartbreaking|god help us|may god|pray|beware|be careful|scary|devastating|abeg|chai)\b/gi;
const DATE_RE = /\b(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2}|(?:mon|tues|wednes|thurs|fri|satur|sun)day|this month|this week|next week)\b/gi;

// Small gazetteer used only for "location_changed" detection; anything capitalised after a
// locative preposition is also treated as a place.
const PLACES = ["lagos", "abuja", "kano", "ibadan", "port harcourt", "enugu", "kaduna", "lekki", "ikeja", "benin", "jos", "delhi", "mumbai", "kolkata", "bangalore", "chennai", "são paulo", "sao paulo", "rio de janeiro", "rio", "brasília", "brasilia", "accra", "nairobi", "london", "johannesburg", "onitsha", "owerri", "calabar", "warri", "aba", "ilorin", "zaria", "maiduguri", "uyo", "akure", "abeokuta"];

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const norm = (xs: string[]) => uniq(xs.map((x) => x.trim().replace(/\s+/g, " ")).filter(Boolean));

export function findNumbers(s: string): string[] {
  return norm((s.match(NUMBER_RE) ?? []).filter((x) => /\d/.test(x) && x.replace(/\D/g, "").length >= 1)).filter((x) => !/^\d{4}$/.test(x) || Number(x) < 1900 || Number(x) > 2100);
}
export function findAuthorities(s: string): string[] {
  return norm(s.match(AUTHORITY_RE) ?? []).map((x) => x.replace(/\s+/g, " "));
}
export function findUrgency(s: string): string[] {
  return norm((s.match(URGENCY_RE) ?? []).map((x) => x.toLowerCase()));
}
export function findCta(s: string): string[] {
  return norm((s.match(CTA_RE) ?? []).map((x) => truncate(x.trim(), 60)));
}
export function findEmotion(s: string): string[] {
  return norm((s.match(EMOTION_RE) ?? []).map((x) => x.toLowerCase()));
}
export function findDates(s: string): string[] {
  return norm((s.match(DATE_RE) ?? []).map((x) => x.toLowerCase()));
}
export function findPlaces(s: string): string[] {
  const c = ` ${canonical(s)} `;
  const fromList = PLACES.filter((p) => c.includes(` ${p} `));
  const fromPrep = [...s.matchAll(/\b(?:in|at|around|across|near|from)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/g)]
    .map((m) => m[1])
    .filter((p) => !PLATFORM_WORDS.has(p.toLowerCase()) && !/^(?:The|This|That|Our|Your|My|Every|All|Nigeria's|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)$/.test(p.split(" ")[0]));
  return norm([...fromList.map((p) => p.replace(/\b\w/g, (m) => m.toUpperCase())), ...fromPrep]);
}

/** Distinctive phrases: the content-heaviest 4–7 word windows from the text. */
export function distinctivePhrases(text: string, n = 3): string[] {
  const scored: { p: string; s: number }[] = [];
  for (const sent of splitSentences(text)) {
    const words = sent.replace(/\s+/g, " ").split(" ").filter(Boolean);
    for (let len = 5; len <= 7; len++)
      for (let i = 0; i + len <= Math.max(words.length, len); i += 2) {
        const p = words.slice(i, i + len).join(" ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
        if (!p || /https?:|www\.|\.example/i.test(p)) continue;
        const ct = contentTokens(p);
        scored.push({ p, s: ct.length / len + (ct.some((t) => /\d/.test(t)) ? 0.2 : 0) });
      }
  }
  scored.sort((a, b) => b.s - a.s);
  const out: string[] = [];
  for (const { p } of scored) {
    if (out.length >= n) break;
    if (out.some((o) => relatedness(o, p) > 0.35)) continue;
    out.push(p);
  }
  return out;
}

export function heuristicUnderstanding(text: string, englishText?: string, language = "en"): Understanding {
  const base = englishText || text;
  const sents = splitSentences(base);
  const claim = truncate(sents.slice(0, 3).join(" "), 300) || truncate(base, 300);
  const keyTerms = uniq(contentTokens(base)).slice(0, 8).join(" ");
  const phrases = distinctivePhrases(text, 3);
  const queries = uniq([
    ...phrases.map((p) => `"${p}"`),
    keyTerms,
    ...(englishText && englishText !== text ? distinctivePhrases(englishText, 2).map((p) => `"${p}"`) : []),
    `${uniq(contentTokens(base)).slice(0, 5).join(" ")} fact check`,
  ]).slice(0, 8);
  const ctas = findCta(base);
  return {
    claim,
    entities: findAuthorities(base),
    numbers: findNumbers(base),
    places: findPlaces(base),
    authorities: findAuthorities(base),
    callToAction: ctas[0] ?? null,
    queries: queries.length >= 2 ? queries : [base.slice(0, 80), `${base.slice(0, 60)} fact check`],
    keyElements: [],
    language,
  };
}

const DEBUNK_RE = /\b(?:fact[- ]?check|false|fake|hoax|debunk|misleading|no evidence|untrue|not true|rumou?r|baseless|misinformation|disinformation|clarif)/i;
const OFFICIAL_RE = /(?:\.gov(?:\.\w\w)?|\.gob\.|gov\.ng|\.mil|official)/i;

export function guessPageType(url: string, title: string, content: string): Exclude<PageType, "user_input"> {
  const u = url.toLowerCase();
  if (DEBUNK_RE.test(title) || /factcheck|fact-check|snopes|africacheck|dubawa|boomlive|altnews|aosfatos|factline|verify/.test(u)) return "debunk";
  if (OFFICIAL_RE.test(u)) return "official";
  if (/twitter\.com|\bx\.com|facebook\.com|instagram\.com|tiktok\.com|whatsapp|t\.me|social|chirp\.example|friendsbook\.example/.test(u)) return "social";
  if (/forum|nairaland|reddit|quora|board|thread|community/.test(u)) return "forum";
  if (/news|times|post|daily|herald|guardian|tribune|punch|vanguard|bbc|cnn|reuters/.test(u)) return "news";
  if (DEBUNK_RE.test(content.slice(0, 300)) && /\b(?:fact[- ]?check|debunk|hoax)/i.test(content.slice(0, 300))) return "debunk";
  return "other";
}

/** Decide whether a page contains a version of the claim, returning an exact excerpt. */
export function heuristicMembership(content: string, claim: string): { contains: boolean; excerpt: string; score: number } {
  const { excerpt, score } = bestExcerpt(content, claim);
  const overlap = excerpt ? contentTokens(excerpt).filter((t) => contentTokens(claim).includes(t)).length : 0;
  return { contains: score >= 0.3 && overlap >= 4, excerpt, score };
}

function diffSets(type: Mutation["type"], a: string[], b: string[], label: string): Mutation[] {
  const ca = a.map(canonical);
  const cb = b.map(canonical);
  const removed = a.filter((x, i) => !cb.includes(ca[i]));
  const added = b.filter((x, i) => !ca.includes(cb[i]));
  if (!removed.length && !added.length) return [];
  return [{ type, before: removed.join(", "), after: added.join(", "), explanation: `${label} ${removed.length && added.length ? "changed" : added.length ? "added" : "removed"}` }];
}

export function heuristicMutations(parent: string, child: string): Mutation[] {
  const out: Mutation[] = [];
  out.push(...diffSets("number_changed", findNumbers(parent), findNumbers(child), "Number"));
  out.push(...diffSets("location_changed", findPlaces(parent), findPlaces(child), "Location"));
  out.push(...diffSets("date_changed", findDates(parent), findDates(child), "Date/time reference"));
  const ap = findAuthorities(parent);
  const ac = findAuthorities(child);
  const addedAuth = ac.filter((a) => !ap.map(canonical).includes(canonical(a)));
  const removedAuth = ap.filter((a) => !ac.map(canonical).includes(canonical(a)));
  if (addedAuth.length) out.push({ type: "authority_added", before: "", after: addedAuth.join(", "), explanation: `Cites ${addedAuth.join(", ")}, which the earlier version did not.` });
  if (removedAuth.length) out.push({ type: "authority_removed", before: removedAuth.join(", "), after: "", explanation: "Drops an authority named in the earlier version." });
  const up = findUrgency(parent);
  const newUrg = findUrgency(child).filter((u) => !up.includes(u));
  if (newUrg.length) out.push({ type: "urgency_added", before: "", after: newUrg.join(", "), explanation: "Adds time pressure." });
  const cp = findCta(parent).map(canonical);
  const newCta = findCta(child).filter((c) => !cp.some((p) => relatedness(p, canonical(c)) > 0.5));
  if (newCta.length) out.push({ type: "call_to_action_added", before: "", after: newCta[0], explanation: "Adds an instruction to act or forward." });
  const ep = findEmotion(parent);
  const newEmo = findEmotion(child).filter((e) => !ep.includes(e));
  if (newEmo.length) out.push({ type: "emotional_framing_added", before: "", after: newEmo.join(", "), explanation: "Adds emotional framing." });
  if (!out.length) {
    const { removed, added } = wordDiff(parent, child);
    const addC = added.filter((w) => contentTokens(w).length);
    const remC = removed.filter((w) => contentTokens(w).length);
    if (addC.length >= 3 && wordCount(child) > wordCount(parent)) out.push({ type: "detail_added", before: "", after: addC.slice(0, 6).join(" "), explanation: "Adds details not in the earlier version." });
    else if (remC.length >= 3 && wordCount(child) < wordCount(parent)) out.push({ type: "detail_removed", before: remC.slice(0, 6).join(" "), after: "", explanation: "Drops details from the earlier version." });
    else if (addC.length || remC.length) out.push({ type: "other", before: remC.slice(0, 4).join(" "), after: addC.slice(0, 4).join(" "), explanation: "Reworded." });
  }
  return out.slice(0, 8);
}

export function mutationChip(m: Mutation): string {
  const change = (fallback: string) => (m.before && m.after ? `${m.before} → ${m.after}` : m.after ? `+ ${m.after}` : m.before ? `− ${m.before}` : fallback);
  const short = (s: string) => truncate(s, 28);
  switch (m.type) {
    case "number_changed":
    case "location_changed":
    case "date_changed":
      return short(change("changed"));
    case "target_changed":
      return short(change("target changed"));
    case "authority_added":
      return short(`+ ${m.after || "authority"}`);
    case "authority_removed":
      return short(`− ${m.before || "authority"}`);
    case "urgency_added":
      return "+ urgency";
    case "call_to_action_added":
      return '+ "forward / act"';
    case "emotional_framing_added":
      return "+ emotion";
    case "detail_added":
      return "+ detail";
    case "detail_removed":
      return "− detail";
    default:
      return "reworded";
  }
}

export function heuristicVerdict(variants: Variant[], edges: LineageEdge[], earliestId: string | null, limited: boolean): Verdict {
  const earliest = variants.find((v) => v.id === earliestId);
  const debunks = variants.flatMap((v) => v.sources.filter((s) => s.pageType === "debunk" || s.pageType === "official"));
  const changes = edges.flatMap((e) => e.mutations).filter((m) => m.type !== "other");
  const whatChanged = uniq(
    changes.map((m) => {
      const e = m.explanation.replace(/\.$/, "");
      const detail = m.before && m.after ? `${m.before} → ${m.after}` : m.after || m.before;
      return detail && !e.includes(detail) ? `${e}: ${detail}` : e;
    }),
  ).slice(0, 6);
  const dateTxt = earliest?.date ? `from ${earliest.date.slice(0, 10)}` : "with no reliable date";
  const summary = limited
    ? `Rootline found ${variants.filter((v) => !v.isUserInput).length === 0 ? "no earlier versions" : `only ${variants.filter((v) => !v.isUserInput).length} related version${variants.filter((v) => !v.isUserInput).length === 1 ? "" : "s"}`} of this message online, so the family is limited. Finding little is not evidence that the message is true or false.${earliest ? ` The earliest found is ${dateTxt}.` : ""}`.trim()
    : `The earliest version found is ${dateTxt}. As it was forwarded, it changed ${changes.length} time${changes.length === 1 ? "" : "s"}${whatChanged.length ? ` (for example, ${whatChanged[0].charAt(0).toLowerCase()}${whatChanged[0].slice(1)})` : ""}.${debunks.length ? ` ${debunks.length} fact-check or official source${debunks.length === 1 ? "" : "s"} address it.` : ""}`;
  const unsupported = debunks.length
    ? [{ statement: "The claim is disputed by the fact-check/official sources found.", sourceUrls: uniq(debunks.map((d) => d.url)).slice(0, 3) }]
    : [];
  const confidence: Confidence = limited ? "low" : edges.some((e) => e.confidence === "high") ? "medium" : "low";
  const relatives = variants.filter((v) => !v.isUserInput).length;
  const replyCard = debunks.length
    ? `I looked this up before forwarding. Versions of this message have circulated since ${earliest?.date?.slice(0, 4) ?? "earlier"}, and the details keep changing. Fact-checkers say it isn't supported. Maybe let's not forward it until there's an official source. 🙏`
    : relatives < 2
      ? `I tried to trace this message before forwarding and couldn't find earlier copies or a fact-check that addresses it. That doesn't mean it's true or false, so it's worth checking an official source before sharing it. 🙏`
      : `I looked this up before forwarding. I found ${relatives} similar versions of this message online, but no fact-check or official source that addresses it directly. That doesn't make it true or false, so it's worth checking an official source before sharing it. 🙏`;
  return { summary, whatChanged, unsupported, confidence, replyCard };
}

export function looksLikeQuestion(s: string) {
  return tokens(s).length < 4;
}

const NUMBER_WORDS = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozens?|several|many|half)\b/i;

const ADDED_TYPES = new Set(["authority_added", "urgency_added", "call_to_action_added", "emotional_framing_added", "detail_added"]);
const REMOVED_TYPES = new Set(["authority_removed", "detail_removed"]);
/** An added item is dropped if at least this share of its content words already occur in the earlier text. */
export const ALREADY_PRESENT = 0.8;
/** A removed item is dropped if at least this share of its content words still occur in the later text. */
export const STILL_PRESENT = 0.6;
const PLATFORM_WORDS = new Set(["whatsapp", "facebook", "twitter", "instagram", "youtube", "tiktok", "telegram", "google", "x", "email", "sms"]);
const AUTHORITY_WORDS = /\b(?:police|government|govt|ministry|minister|president|governor|army|military|officials?|authorities|doctors?|dr\.?|professors?|experts?|scientists?|researchers?|hospital|university|institute|agency|commission|council|department|bureau|office|sheriff|garda|who|unicef|nafdac|ncdc|cnn|bbc|reuters|nasa|fbi|cdc)\b/i;
const URGENCY_WORDS = /\b(?:urgent(?:ly)?|immediately|hurry|quickly|asap|deadline|closes|closing|expires?|expiring|last chance|right away|at once|breaking|tonight|before (?:friday|monday|tuesday|wednesday|thursday|saturday|sunday|midnight|the end|it'?s too late)|within \d+ (?:hours?|minutes?|days?)|\d+ (?:hours?|minutes?) (?:left|only))\b/i;
const CTA_WORDS = /\b(?:forward|share|send|click|tap|apply|register|sign ?up|call|text|tell|inform|alert|warn|spread|pass|circulate|broadcast|post|repost|retweet|contact|visit|join|subscribe|download|follow|reply|delete|ignore|avoid|stop|don'?t|do not|never|please)\b/i;
const EMOTION_WORDS = /\b(?:beware|careful|danger(?:ous)?|deadly|fatal|terrif\w*|scar(?:y|ed)|shock\w*|horr\w*|evil|wicked|pray|god|please|sad|heartbreaking|panic|kill\w*|die[ds]?|death|dead|victims?|children|innocent|warning|alert|urgent|help)\b|!/i;
const DATE_WORDS = /\d|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:today|tomorrow|tonight|yesterday|week|month|year|weekend)\b/i;

/** Does `phrase` look like a named person/organisation/official body (a capitalised word that isn't just a sentence start, or an authority term)? */
function looksLikeAuthority(phrase: string): boolean {
  if (AUTHORITY_WORDS.test(phrase)) return true;
  // "WhatsApp Gold version" is a product, not an authority.
  if (new RegExp(`\\b(?:${[...PLATFORM_WORDS].join("|")})\\b`, "i").test(phrase)) return false;
  const words = phrase.split(/\s+/).filter(Boolean);
  return words.slice(1).some((w) => /^[A-Z][A-Za-z'’.-]+$/.test(w) && !/^(?:The|A|An|And|Of|In|On|At|To|For|It|This|That|Please|I|We|You)$/.test(w)) || /^[A-Z]{2,}$/.test(words[0] ?? "");
}
function looksLikePlace(phrase: string): boolean {
  const toks = phrase.split(/[\s,]+/).filter(Boolean);
  const caps = toks.filter((w) => /^[A-Z][A-Za-z'’.-]+$/.test(w) && !PLATFORM_WORDS.has(w.toLowerCase()));
  return caps.length > 0;
}

/**
 * Honesty gate for mutation labels: a mutation survives only if its "before" really occurs in the earlier text,
 * its "after" really occurs in the later text, and its label is consistent with what changed. Anything the
 * model invented or mislabelled is dropped rather than shown.
 */
export function validateMutations(ms: Mutation[], earlier: string, later: string, max = 6): Mutation[] {
  const E = canonical(earlier);
  const L = canonical(later);
  const parts = (x: string) => x.split(/\s*(?:,|;|\|)\s*/).map((y) => canonical(y)).filter((y) => y.length > 1);
  const seen = new Set<string>();
  const out: Mutation[] = [];
  for (const m of ms) {
    const before = m.before.trim();
    const after = m.after.trim();
    if (!before && !after) continue;
    if (canonical(before) === canonical(after)) continue;
    if (parts(before).some((p) => !E.includes(p))) continue;
    if (parts(after).some((p) => !L.includes(p))) continue;
    const hasNum = (x: string) => /\d/.test(x) || NUMBER_WORDS.test(x);
    // Each label must be consistent with the words it points at (a grounded phrase can still be mislabelled).
    switch (m.type) {
      case "number_changed":
        if ((before && !hasNum(before)) || (after && !hasNum(after))) continue;
        break;
      case "authority_added":
        if (!after || !looksLikeAuthority(after)) continue;
        break;
      case "authority_removed":
        if (!before || !looksLikeAuthority(before)) continue;
        break;
      case "urgency_added":
        if (!after || !URGENCY_WORDS.test(after)) continue;
        break;
      case "call_to_action_added":
        if (!after || !CTA_WORDS.test(after)) continue;
        break;
      case "emotional_framing_added":
        if (!after || !EMOTION_WORDS.test(after)) continue;
        break;
      case "detail_added":
        if (!after) continue;
        break;
      case "detail_removed":
        if (!before) continue;
        break;
      case "location_changed":
        if ((before && !looksLikePlace(before)) || (after && !looksLikePlace(after)) || (!before && !after)) continue;
        break;
      case "date_changed":
        if ((before && !DATE_WORDS.test(before)) || (after && !DATE_WORDS.test(after)) || (!before && !after)) continue;
        break;
      case "target_changed":
        if (!before || !after) continue;
        break;
    }
    // "Added" content must really be new (not already in the earlier text in other words); "removed" content must
    // really be gone (not merely reworded in the later text).
    if (ADDED_TYPES.has(m.type) && !before && stemCoverage(after, earlier) >= ALREADY_PRESENT) continue;
    if (REMOVED_TYPES.has(m.type) && !after && stemCoverage(before, later) >= STILL_PRESENT) continue;
    const key = `${m.type}|${canonical(before)}|${canonical(after)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...m, before: clip(before, 80), after: clip(after, 80), explanation: clip(m.explanation, 140) });
    if (out.length >= max) break;
  }
  return out;
}

/** Words that mark a fact-checker's/journalist's own commentary about a message rather than the message itself. */
const COMMENTARY_RE = /\b(?:hoax(?:es)?|myth|fake|falsely|debunk\w*|fact[- ]?check\w*|no evidence|non-existent|nonexistent|long-running|circulat\w*|resurfac\w*|versions?|translated|known (?:scam|hoax)|urban legend|rumou?rs?)\b/i;

/**
 * Fact-check, news and official pages mix the message they quote with their own commentary (calling it a hoax,
 * describing its history or spread). A label whose text is that commentary is not a mutation of the message.
 * Posts and the user's own copy are exempt: there such words are part of the message.
 */
export function dropCommentary(ms: Mutation[], laterPageType: string, earlierPageType?: string): Mutation[] {
  const commentary = (t: string) => COMMENTARY_RE.test(t);
  return ms.filter((m) => {
    const addedSide = ["debunk", "news", "official"].includes(laterPageType) ? m.after : "";
    const removedSide = earlierPageType && ["debunk", "news", "official"].includes(earlierPageType) ? m.before : "";
    return !(addedSide && commentary(addedSide)) && !(removedSide && commentary(removedSide));
  });
}

/** A call to action is an instruction, not a single word: "click" alone is a fragment of something else. */
export function dropFragments(ms: Mutation[]): Mutation[] {
  return ms.filter((m) => !(m.type === "call_to_action_added" && wordCount(m.after) < 2));
}

/** Label types that carry a clear, checkable signal. the detail_ labels and "other" are the noisiest and are "weak" by default. */
export const STRONG_TYPES = new Set(["number_changed", "location_changed", "authority_added", "authority_removed", "urgency_added", "call_to_action_added", "emotional_framing_added", "date_changed", "target_changed"]);
export const isStrong = (m: Mutation) => m.strength === "strong";

const QUOTE_COMMENTARY_RE = /\b(?:no verified|not aware of|there (?:are|is) (?:currently )?no (?:verified|credible|evidence|reports?)|first saw this|has been dismissed|dismissed as|according to (?:the )?(?:sheriff|police|snopes|fact)|fact check|fact-check|is a (?:known )?(?:hoax|scam|myth|rumou?r))\b/i;
/**
 * A "quoted rumor" taken from a fact-check/news/official page must read like the message, not like the page's own
 * commentary about it. Text that calls the message a hoax, reports officials' denials, or describes its history is rejected.
 */
export function looksLikeCommentary(text: string): boolean {
  return COMMENTARY_RE.test(text) || QUOTE_COMMENTARY_RE.test(text);
}
