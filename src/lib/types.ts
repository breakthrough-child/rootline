// Shared domain types for Rootline.

export type SourceKind =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx";

export type DateProvenance =
  | "published_date"
  | "page_metadata"
  | "from_screenshot_unverified"
  | "pdf_metadata_unverified"
  | "unknown";

export type PageType = "debunk" | "news" | "social" | "forum" | "official" | "other" | "user_input";

export type Confidence = "low" | "medium" | "high";

export const MUTATION_TYPES = [
  "number_changed",
  "location_changed",
  "authority_added",
  "authority_removed",
  "urgency_added",
  "date_changed",
  "target_changed",
  "call_to_action_added",
  "emotional_framing_added",
  "detail_added",
  "detail_removed",
  "other",
] as const;
export type MutationType = (typeof MUTATION_TYPES)[number];

/** A span of extracted text and where it came from inside the original input. */
export interface InputLocation {
  label: string; // e.g. "page 2", "slide 3", "00:41", "Sheet1!B4"
  start: number; // char offset into ExtractedInput.text
  end: number;
  seconds?: number; // for audio/video
}

export interface ScreenshotFields {
  platform: "x" | "facebook" | "instagram" | "tiktok" | "whatsapp" | "news_site" | "meme" | "unknown";
  display_name: string | null;
  handle: string | null;
  post_text: string;
  visible_timestamp: string | null;
  engagement: string | null;
  embedded_image_description: string | null;
  provenance: "from_screenshot_unverified";
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

/** Every adapter converts its input into this common shape. */
export interface ExtractedInput {
  sourceKind: SourceKind;
  original: { kind: "paste" | "upload"; filename?: string; mime?: string; thumbnail?: string };
  text: string; // the extracted (and possibly user-edited) text
  englishText?: string; // translation for searching, when original isn't English
  language: string; // ISO-ish code or "unknown"
  locations: InputLocation[];
  unverifiedMetadata: Record<string, string>;
  adapterPath: string[]; // e.g. ["vision:nvidia/…"] or ["ocr:tesseract.js", "cleanup:nano"]
  screenshot?: ScreenshotFields;
  segments?: TranscriptSegment[];
  notes?: string[]; // user-visible caveats ("Auto-transcribed; may contain errors…")
}

export interface CandidateClaim {
  id: string;
  text: string;
  location?: string;
  score: number; // checkability * significance, 0..1
  reason?: string;
}

export interface SourceRef {
  url: string;
  title: string;
  excerpt: string; // exact excerpt found on the page
  pageType: PageType;
  date: string | null; // ISO date
  dateProvenance: DateProvenance;
}

export interface Variant {
  id: string;
  text: string; // normalized version of the message
  excerpt: string; // exact excerpt (from the first/earliest source)
  sources: SourceRef[];
  date: string | null;
  dateProvenance: DateProvenance;
  pageType: PageType;
  isUserInput?: boolean;
  isNew?: boolean; // watchlist re-run: new since last run
  branch?: string;
}

export interface Mutation {
  type: MutationType;
  before: string;
  after: string;
  explanation: string;
}

export interface LineageEdge {
  from: string; // parent variant id
  to: string; // child variant id
  confidence: Confidence;
  reason: string;
  mutations: Mutation[];
  spreadJump?: boolean; // this change coincided with wider spread
}

export interface Understanding {
  claim: string;
  entities: string[];
  numbers: string[];
  places: string[];
  authorities: string[];
  callToAction: string | null;
  queries: string[];
  language: string;
}

export interface Verdict {
  summary: string;
  whatChanged: string[];
  unsupported: { statement: string; sourceUrls: string[] }[];
  confidence: Confidence;
  replyCard: string;
}

export type PostExistsOutcome = "found_matching" | "found_altered" | "not_found";
export interface PostExistsCheck {
  outcome: PostExistsOutcome;
  handle: string | null;
  url?: string;
  differences?: { before: string; after: string }[];
  note: string;
}

export type OfficialOutcome =
  | "official_match_found"
  | "official_version_differs"
  | "no_official_record_found"
  | "already_debunked"
  | "not_applicable";
export interface OfficialCheck {
  outcome: OfficialOutcome;
  organization: string | null;
  reference: string | null;
  url?: string;
  differences?: string[];
  metadataHints: Record<string, string>;
  note: string;
}

export interface ClaimResult {
  claimId: string;
  claim: string;
  understanding: Understanding;
  variants: Variant[];
  edges: LineageEdge[];
  earliestId: string | null;
  limited: boolean;
  verdict: Verdict;
  branches: { name: string; variantIds: string[] }[];
  stats: { queries: number; pagesSearched: number; pagesConfirmed: number; pairsCompared: number };
  warnings: string[];
}

export interface ModelCallLog {
  id: string;
  provider: "nebius" | "tavily" | "heuristic" | "tesseract" | "asr-endpoint" | "mock";
  model: string;
  tier: "nano" | "super" | "ultra" | "vision" | "asr" | "search" | "extract" | "local";
  stage: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  ok: boolean;
  note?: string;
  at: number;
}

export type RunMode = "live" | "replay" | "offline_mock";

export interface Investigation {
  id: string;
  createdAt: string;
  mode: RunMode;
  modeNote?: string;
  input: ExtractedInput;
  claims: ClaimResult[];
  checks: { postExists?: PostExistsCheck; official?: OfficialCheck };
  logs: ModelCallLog[];
  totalLatencyMs: number;
  pricing?: Record<string, [number, number]>; // USD per 1M tokens [in, out], by tier
  fixture?: { id: string; title: string; generatedAt: string; generatedWith: RunMode };
}

/** Events streamed to the browser over SSE. */
export type RunEvent =
  | { type: "stage"; stage: string; message: string; claimId?: string }
  | { type: "node"; claimId: string; variant: Variant }
  | { type: "edge"; claimId: string; edge: LineageEdge }
  | { type: "log"; log: ModelCallLog }
  | { type: "check"; postExists?: PostExistsCheck; official?: OfficialCheck }
  | { type: "claim_done"; claim: ClaimResult }
  | { type: "result"; investigation: Investigation }
  | { type: "extracted"; input: ExtractedInput; claims: CandidateClaim[] }
  | { type: "error"; message: string; stage?: string };

export type Emit = (e: RunEvent) => void;
