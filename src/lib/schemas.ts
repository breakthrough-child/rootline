// Zod schemas for every model output. Lenient on shape (coercion, defaults), strict on meaning.
import { z } from "zod";
import { MUTATION_TYPES } from "./types";

const str = z.string().trim();
const strList = z.array(z.coerce.string()).default([]);
const nullableStr = z.union([z.string(), z.null()]).optional().transform((v) => (v && v.trim() ? v.trim() : null));

export const UnderstandingSchema = z.object({
  claim: str.min(3),
  entities: strList,
  numbers: strList,
  places: strList,
  authorities: strList,
  call_to_action: nullableStr,
  language: z.string().default("en"),
  queries: z.array(str.min(2)).min(2).max(12),
  // Distinctive parts of the message (lure/offer, claimed effect, claimed harm, demanded action) used to verify page membership.
  key_elements: z.array(z.coerce.string().trim().min(3)).max(6).default([]),
});

// The model sees the page as numbered sentences and answers with sentence numbers, so every quote is verbatim by construction.
const range = z
  .union([z.array(z.coerce.number().int()).min(1).max(2), z.null()])
  .optional()
  .catch(null)
  .transform((v) => (v && v.length ? ([v[0], v[v.length - 1]] as [number, number]) : null));

export const MembershipSchema = z.object({
  contains_version: z.boolean(),
  // same_message / reworded count as a version; related_only (same topic, different story) and unrelated do not.
  relation: z.enum(["same_message", "reworded", "related_only", "unrelated"]).catch("reworded").default("reworded"),
  // Same specific claim/programme (not merely the same topic or a different scheme/event)?
  same_specific_claim: z.boolean().catch(true).default(true),
  // For each message element the page expresses: the number of the sentence that expresses it.
  // Tolerant: a null/garbled number becomes -1 and is ignored (one bad entry must not discard the whole answer).
  evidence: z.array(z.object({ element: z.coerce.number().int().catch(-1), sentence: z.coerce.number().int().catch(-1) })).default([]),
  // [first, last] sentence numbers of the passage that best shows the message (at most 4 sentences).
  excerpt_sentences: range,
  // [first, last] sentence numbers of the rumor exactly as quoted/forwarded on the page, WITHOUT the page's own commentary (null if only described).
  quoted_sentences: range,
  page_type: z.enum(["debunk", "news", "social", "forum", "official", "other"]).catch("other"),
});

export const MutationSchema = z.object({
  type: z.enum(MUTATION_TYPES).catch("other"),
  before: z.coerce.string().default(""),
  after: z.coerce.string().default(""),
  explanation: z.coerce.string().default(""),
});
export const MutationsSchema = z.object({ mutations: z.array(MutationSchema).max(12).default([]) });

/** Super's one-line description of what differs between a parent and a child text. */
export const ChangeNoteSchema = z.object({ note: z.coerce.string().default("") });

/** Super's review of one parent→child pair's labels: it may keep, retype or drop each label, never add one. */
export const ReviewSchema = z.object({
  labels: z.array(
    z.object({
      index: z.coerce.number().int(),
      verdict: z.enum(["keep", "retype", "drop"]).catch("keep"),
      type: z.enum(MUTATION_TYPES).optional().catch(undefined),
      reason: z.coerce.string().default(""),
    }),
  ),
});

export const ClusterSchema = z.object({
  merges: z.array(z.object({ keep: str, merge: str })).default([]),
  branches: z.array(z.object({ name: str, variant_ids: z.array(str) })).default([]),
  label_fixes: z.array(z.object({ from: str, to: z.enum(MUTATION_TYPES) })).default([]),
});

export const LineageSchema = z.object({
  edges: z.array(
    z.object({
      parent: str,
      child: str,
      confidence: z.enum(["low", "medium", "high"]).catch("low"),
      reason: z.coerce.string().default(""),
    }),
  ),
  earliest_id: str,
  evolution_summary: z.coerce.string().default(""),
});

export const VerdictSchema = z.object({
  summary: str.min(10),
  what_changed: strList,
  unsupported: z.array(z.object({ statement: str, source_urls: z.array(str).default([]) })).default([]),
  confidence: z.enum(["low", "medium", "high"]).catch("low"),
  reply_card: str.min(10),
});

export const ScreenshotSchema = z.object({
  platform: z.enum(["x", "facebook", "instagram", "tiktok", "whatsapp", "news_site", "meme", "unknown"]).catch("unknown"),
  display_name: nullableStr,
  handle: nullableStr,
  post_text: z.string().default(""),
  visible_timestamp: nullableStr,
  engagement: nullableStr,
  embedded_image_description: nullableStr,
});

export const PostCompareSchema = z.object({
  outcome: z.enum(["found_matching", "found_altered", "not_found"]),
  url: nullableStr,
  differences: z.array(z.object({ before: z.coerce.string(), after: z.coerce.string() })).default([]),
});

export const OfficialFieldsSchema = z.object({
  looks_official: z.boolean(),
  organization: nullableStr,
  reference: nullableStr,
  signatory: nullableStr,
  date: nullableStr,
  title: nullableStr,
});

export const OfficialCompareSchema = z.object({
  outcome: z.enum(["official_match_found", "official_version_differs", "no_official_record_found", "already_debunked"]),
  url: nullableStr,
  differences: strList,
});

export const ClaimsSchema = z.object({
  claims: z.array(z.object({ text: str.min(8), location: nullableStr })).max(20),
});

export const RankSchema = z.object({
  ranked: z.array(z.object({ index: z.coerce.number().int(), score: z.coerce.number().min(0).max(1), reason: z.coerce.string().default("") })),
});

export const CleanupSchema = z.object({
  cleaned: z.string(),
  language: z.string().default("unknown"),
  english: z.string().default(""),
});
