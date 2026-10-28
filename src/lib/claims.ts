// Claim selection for documents, video and long audio: Nano extracts, Super ranks.
import { findAuthorities, findNumbers, findPlaces, findUrgency } from "./heuristics";
import { chatJson, RunContext, withFallback } from "./llm";
import { ClaimsSchema, RankSchema } from "./schemas";
import { canonical, splitSentences, truncate, wordCount } from "./text";
import type { CandidateClaim, ExtractedInput } from "./types";

/** A checkable claim is a full sentence: fragments like "Lassa variant X outbreak" trace unrelated pages. */
export const MIN_CLAIM_WORDS = 8;

const SYSTEM = "You extract checkable factual claims from documents. Copy claims closely from the text; never add facts. Reply with one JSON object.";

/** Short inputs (a forward, a post) are traced as a single claim. */
export function needsClaimSelection(input: ExtractedInput): boolean {
  return ["pdf", "docx", "xlsx", "pptx", "video"].includes(input.sourceKind) || wordCount(input.text) > 180;
}

export function locationFor(input: ExtractedInput, claim: string): string | undefined {
  const at = canonical(input.text).indexOf(canonical(claim).slice(0, 40));
  if (at < 0) return undefined;
  // map canonical offset approximately back via proportion
  const ratio = at / Math.max(1, canonical(input.text).length);
  const pos = Math.floor(ratio * input.text.length);
  return input.locations.find((l) => pos >= l.start && pos <= l.end)?.label;
}

export function heuristicClaims(input: ExtractedInput): CandidateClaim[] {
  const sents = splitSentences(input.text).filter((s) => wordCount(s) >= MIN_CLAIM_WORDS && wordCount(s) <= 80);
  return sents
    .map((s, i) => {
      const score = Math.min(1, 0.15 + 0.25 * Math.min(2, findNumbers(s).length) + 0.2 * Math.min(1, findAuthorities(s).length) + 0.15 * Math.min(1, findPlaces(s).length) + 0.1 * Math.min(1, findUrgency(s).length));
      return { id: `k${i}`, text: s, location: locationFor(input, s), score: Number(score.toFixed(2)), reason: "contains numbers / authorities / places" };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

export async function extractClaims(ctx: RunContext, input: ExtractedInput): Promise<CandidateClaim[]> {
  if (!needsClaimSelection(input)) return [{ id: "k0", text: input.text, score: 1 }];
  ctx.stage("claims", "Finding checkable claims…");
  const { value: extracted } = await withFallback<CandidateClaim[]>(
    ctx,
    "claims: extract",
    "nano",
    async () => {
      const out = await chatJson(ctx, ClaimsSchema, {
        tier: "nano",
        stage: "claims: extract",
        maxTokens: 1500,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Text (with location markers like [page 2]):\n"""${truncate(withMarkers(input), 12000)}"""\nList up to 12 checkable factual claims. Each claim must be ONE complete, self-contained sentence (at least 8 words) asserting something that web sources could confirm or refute (an event, an offer, a number, an official decision), written close to the original wording and including who/what/where/when if the text gives it. Do NOT list headings, titles, reference numbers, the document's own date, signatures, greetings, bare topics or instructions.
Return JSON: {"claims":[{"text": the full-sentence claim, "location": marker label or null}]}`,
          },
        ],
      });
      const full = out.claims.filter((c) => wordCount(c.text) >= MIN_CLAIM_WORDS);
      if (!full.length) throw new Error("no full-sentence claims");
      return full.map((c, i) => ({ id: `k${i}`, text: c.text, location: c.location ?? locationFor(input, c.text), score: 0.5 }));
    },
    () => heuristicClaims(input),
  );
  if (extracted.length <= 1) return extracted;
  const { value } = await withFallback(
    ctx,
    "claims: rank",
    "super",
    async () => {
      const out = await chatJson(ctx, RankSchema, {
        tier: "super",
        stage: "claims: rank",
        maxTokens: 800,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Rank these claims by checkability (could web sources confirm or contradict it?) and significance (could it cause harm, panic or loss if false?).\n${extracted.map((c, i) => `${i}. ${c.text}`).join("\n")}\nReturn JSON: {"ranked":[{"index": number, "score": 0-1, "reason": short}]}`,
          },
        ],
      });
      return out.ranked
        .filter((r) => extracted[r.index])
        .map((r) => ({ ...extracted[r.index], score: r.score, reason: r.reason }))
        .sort((a, b) => b.score - a.score);
    },
    () => [...extracted].sort((a, b) => b.score - a.score),
  );
  return value;
}

function withMarkers(input: ExtractedInput): string {
  if (!input.locations.length) return input.text;
  return input.locations.map((l) => `[${l.label}] ${input.text.slice(l.start, l.end)}`).join("\n");
}
