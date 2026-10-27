// Text adapter (pure, safe to import on the client).
import { normalizeInput } from "../text";
import type { ExtractedInput } from "../types";

export function textToInput(raw: string): ExtractedInput {
  const text = normalizeInput(raw);
  return {
    sourceKind: "text",
    original: { kind: "paste" },
    text,
    language: "unknown",
    locations: [{ label: "message", start: 0, end: text.length }],
    unverifiedMetadata: {},
    adapterPath: ["text:normalize"],
  };
}
