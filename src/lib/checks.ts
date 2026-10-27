// "Does this post actually exist?" and "Is this official?" checks.
import { chatJson, RunContext, withFallback } from "./llm";
import { OfficialCompareSchema, OfficialFieldsSchema, PostCompareSchema } from "./schemas";
import { search, type SearchHit } from "./search";
import { bestExcerpt, canonical, relatedness, splitSentences, tokens, truncate } from "./text";
import type { ExtractedInput, OfficialCheck, PostExistsCheck, ScreenshotFields } from "./types";

const SYSTEM = "You verify whether content exists online. Never invent URLs or facts; only use the search results given. Reply with one JSON object.";

const PLATFORM_DOMAINS: Record<string, string[]> = {
  x: ["x.com", "twitter.com"],
  facebook: ["facebook.com"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
};

/** Exact word-level differences between the screenshot text and a found post. */
export function phraseDifferences(a: string, b: string): { before: string; after: string }[] {
  const sa = splitSentences(a);
  const sb = splitSentences(b);
  const out: { before: string; after: string }[] = [];
  for (const s of sa) {
    const best = sb.map((t) => ({ t, r: relatedness(s, t) })).sort((x, y) => y.r - x.r)[0];
    if (!best || best.r < 0.35) out.push({ before: s, after: "" });
    else if (canonical(best.t) !== canonical(s)) out.push({ before: best.t, after: s });
  }
  return out.slice(0, 6);
}

export async function checkPostExists(ctx: RunContext, shot: ScreenshotFields): Promise<PostExistsCheck | undefined> {
  if (!shot.handle && !shot.display_name) return undefined;
  ctx.stage("check", "Checking whether this post actually exists…");
  const handle = shot.handle ? shot.handle.replace(/^@?/, "@") : null;
  const words = shot.post_text.split(/\s+/).slice(0, 12).join(" ");
  const queries = [`"${words}" ${handle ?? ""} ${shot.display_name ?? ""}`.trim(), `${handle ?? shot.display_name} ${tokens(shot.post_text).slice(0, 8).join(" ")}`];
  const domains = PLATFORM_DOMAINS[shot.platform];
  const hits: SearchHit[] = [];
  for (const q of queries) {
    try {
      hits.push(...(await search(ctx, q, { maxResults: 8, stage: "check: post exists", includeDomains: undefined })));
      if (domains) hits.push(...(await search(ctx, q, { maxResults: 5, stage: "check: post exists", includeDomains: domains })));
    } catch {
      /* logged */
    }
  }
  const uniqueHits = [...new Map(hits.map((h) => [h.url, h])).values()];
  const h = canonical(handle ?? "").replace(/ /g, "");
  const byAccount = uniqueHits.filter((x) => h && canonical(`${x.url} ${x.title} ${x.content}`).replace(/ /g, "").includes(h));

  const fallback = (): PostExistsCheck => {
    const best = byAccount.map((x) => ({ x, r: relatedness(x.content, shot.post_text) })).sort((a, b) => b.r - a.r)[0];
    if (best && best.r > 0.75) return { outcome: "found_matching", handle, url: best.x.url, note: "A matching post from this account was found." };
    if (best && best.r > 0.35) return { outcome: "found_altered", handle, url: best.x.url, differences: phraseDifferences(shot.post_text, best.x.content), note: "A post from this account was found, but the wording differs." };
    return { outcome: "not_found", handle, note: "No evidence this post exists. It may be deleted, private or fabricated." };
  };
  if (!uniqueHits.length) return fallback();
  const { value } = await withFallback(ctx, "check: post exists", "nano", async () => {
    const out = await chatJson(ctx, PostCompareSchema, {
      tier: "nano",
      stage: "check: post exists",
      maxTokens: 600,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `A screenshot claims account ${handle ?? "(no handle)"} ("${shot.display_name ?? "?"}") on ${shot.platform} posted:\n"""${truncate(shot.post_text, 800)}"""\n\nSearch results:\n${uniqueHits
            .slice(0, 12)
            .map((x, i) => `[${i}] ${x.url}\n${truncate(x.content, 400)}`)
            .join("\n")}\n
Is there a result that IS this post by this same account? found_matching = same account, same wording. found_altered = same account, wording differs (list exact differences). not_found = no such post by that account (a different account quoting similar text does NOT count).
Return JSON: {"outcome": "found_matching"|"found_altered"|"not_found", "url": url from the results or null, "differences": [{"before": text in found post, "after": text in screenshot}]}`,
        },
      ],
    });
    const url = out.url && uniqueHits.some((x) => x.url === out.url) ? out.url : undefined;
    if (out.outcome !== "not_found" && !url) return fallback();
    return {
      outcome: out.outcome,
      handle,
      url,
      differences: out.outcome === "found_altered" ? out.differences : undefined,
      note:
        out.outcome === "found_matching"
          ? "A matching post from this account was found."
          : out.outcome === "found_altered"
            ? "A post from this account was found, but the wording differs."
            : "No evidence this post exists. It may be deleted, private or fabricated.",
    } satisfies PostExistsCheck;
  }, fallback);
  return value;
}

const OFFICIAL_HINTS = /\b(?:circular|memo(?:randum)?|press release|official|ref(?:erence)?\s*(?:no\.?|number|:)|ministry|office of|agency|commission|director[- ]general|permanent secretary|signed|letterhead|notice to|public notice)\b/i;

export function looksOfficial(text: string): boolean {
  return (text.match(new RegExp(OFFICIAL_HINTS.source, "gi")) ?? []).length >= 2;
}

function heuristicOfficialFields(text: string) {
  const head = text.slice(0, 800);
  const org = head.match(/\b((?:federal |state |national )?(?:ministry|office|agency|commission|council|board|department|bureau)\s+(?:of|for)\s+[A-Z][\w]+(?:\s+[A-Z][\w]+){0,4})/i)?.[1] ?? null;
  const ref = text.match(/\bref(?:erence)?\.?\s*(?:no\.?|number)?\s*[:#]?\s*([A-Z0-9][A-Z0-9/\-.]{4,})/i)?.[1] ?? null;
  const title = splitSentences(text).find((s) => s.length > 30) ?? null;
  return { looks_official: looksOfficial(text), organization: org, reference: ref, signatory: null, date: null, title };
}

export async function checkOfficial(ctx: RunContext, input: ExtractedInput, mainClaim: string): Promise<OfficialCheck | undefined> {
  const metadataHints = Object.fromEntries(Object.entries(input.unverifiedMetadata).filter(([k]) => /creat|produc|author|modif|title/i.test(k)));
  const { value: fields } = await withFallback(
    ctx,
    "check: official fields",
    "nano",
    () =>
      chatJson(ctx, OfficialFieldsSchema, {
        tier: "nano",
        stage: "check: official fields",
        maxTokens: 400,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Document text:\n"""${truncate(input.text, 4000)}"""\nDoes this document present itself as official (letterhead, an organisation name, reference number, signatory, date)? Return JSON: {"looks_official": boolean, "organization": string|null, "reference": string|null, "signatory": string|null, "date": string|null, "title": short subject line|null}`,
          },
        ],
      }),
    () => heuristicOfficialFields(input.text),
  );
  if (!fields.looks_official && !looksOfficial(input.text)) return undefined;
  ctx.stage("check", "Checking whether this document is official…");
  const org = fields.organization;
  const queries = [
    [org, fields.title ?? truncate(mainClaim, 80)].filter(Boolean).join(" "),
    fields.reference ? `"${fields.reference}"` : null,
    `${org ?? ""} ${truncate(mainClaim, 80)} fake OR false OR fact check`.trim(),
  ].filter((q): q is string => !!q);
  const hits: SearchHit[] = [];
  for (const q of queries) {
    try {
      hits.push(...(await search(ctx, q, { maxResults: 8, stage: "check: official" })));
    } catch {
      /* logged */
    }
  }
  try {
    hits.push(...(await search(ctx, queries[0], { maxResults: 6, stage: "check: official (gov domains)", includeDomains: ["gov.ng", "gov", "gov.in", "gov.br", "gov.uk", "int"] })));
  } catch {
    /* logged */
  }
  const uniqueHits = [...new Map(hits.map((h) => [h.url, h])).values()];
  const base = { organization: org, reference: fields.reference, metadataHints };

  const fallback = (): OfficialCheck => {
    const orgC = canonical(org ?? "");
    const debunk = uniqueHits.find((x) => /fact|false|fake|hoax|scam|debunk/i.test(`${x.url} ${x.title}`) && relatedness(x.content, mainClaim) > 0.3 && (!orgC || canonical(x.content).includes(orgC) || relatedness(x.content, mainClaim) > 0.45));
    if (debunk) return { ...base, outcome: "already_debunked", url: debunk.url, note: "A fact-check of this claim was found." };
    const official = uniqueHits.find((x) => /\.gov|\.int\b/.test(new URL(x.url).hostname) && orgC && canonical(x.content).includes(orgC) && relatedness(x.content, mainClaim) > 0.4);
    if (official) {
      const ex = bestExcerpt(official.content, mainClaim);
      return ex.score > 0.7
        ? { ...base, outcome: "official_match_found", url: official.url, note: "A matching notice was found on an official site." }
        : { ...base, outcome: "official_version_differs", url: official.url, differences: phraseDifferences(mainClaim, ex.excerpt).map((d) => `${d.before} → ${d.after}`), note: "An official notice exists but says something different." };
    }
    return { ...base, outcome: "no_official_record_found", note: "No official record found. Verify directly with the organization before acting." };
  };
  if (!uniqueHits.length) return fallback();

  const { value } = await withFallback(ctx, "check: official", "nano", async () => {
    const out = await chatJson(ctx, OfficialCompareSchema, {
      tier: "nano",
      stage: "check: official",
      maxTokens: 600,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `A document claims to be from "${org ?? "unknown organisation"}"${fields.reference ? ` (ref ${fields.reference})` : ""} and says:\n"""${truncate(mainClaim, 700)}"""\n\nSearch results:\n${uniqueHits
            .slice(0, 14)
            .map((x, i) => `[${i}] ${x.url}\n${truncate(x.content, 400)}`)
            .join("\n")}\n
Prefer official domains of that organisation and reputable news. Outcomes: official_match_found (the organisation itself published the same notice), official_version_differs (it published a notice on this but details differ), already_debunked (a fact-check or the organisation says this document/claim is false), no_official_record_found (none of the above).
Return JSON: {"outcome": ..., "url": url from results or null, "differences": [short lines]}`,
        },
      ],
    });
    const url = out.url && uniqueHits.some((x) => x.url === out.url) ? out.url : undefined;
    if (out.outcome !== "no_official_record_found" && !url) return fallback();
    const notes: Record<string, string> = {
      official_match_found: "A matching notice was found on an official site.",
      official_version_differs: "An official notice exists but says something different.",
      already_debunked: "A fact-check of this claim was found.",
      no_official_record_found: "No official record found. Verify directly with the organization before acting.",
    };
    return { ...base, outcome: out.outcome, url, differences: out.differences.length ? out.differences : undefined, note: notes[out.outcome] } satisfies OfficialCheck;
  }, fallback);
  return value;
}
