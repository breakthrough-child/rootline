// Screenshot adapter: NVIDIA vision-language model on Token Factory, else Tesseract.js OCR + Nano cleanup.
import { llmAvailable, config } from "../config";
import { chatJson, RunContext, withFallback } from "../llm";
import { ScreenshotSchema } from "../schemas";
import { normalizeInput, redactPrivate } from "../text";
import type { ExtractedInput, ScreenshotFields } from "../types";

const VISION_PROMPT = `Read this screenshot of a social media post, chat forward, news page or meme.
Extract ONLY the post's own content. Privacy: do NOT include other chat participants' names, phone numbers, emails, or unrelated messages visible in the image.
Return JSON: {"platform": "x"|"facebook"|"instagram"|"tiktok"|"whatsapp"|"news_site"|"meme"|"unknown", "display_name": string|null, "handle": string|null (with @ if shown), "post_text": exact text of the post, "visible_timestamp": string|null as shown, "engagement": visible counts like "18K reposts · 9K likes" or null, "embedded_image_description": short description of any picture inside the post or null}`;

export async function makeThumbnail(buf: Buffer, width = 320): Promise<string | undefined> {
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(buf);
    const w = Math.min(width, img.width);
    const h = Math.round((img.height / img.width) * w);
    const c = createCanvas(w, h);
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return `data:image/jpeg;base64,${(await c.encode("jpeg", 70)).toString("base64")}`;
  } catch {
    return undefined;
  }
}

export async function ocr(ctx: RunContext, buf: Buffer, stage = "image: ocr"): Promise<string> {
  const t0 = Date.now();
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(buf);
    ctx.log({ provider: "tesseract", model: "tesseract.js/eng", tier: "local", stage, tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - t0, ok: true, note: `confidence ${Math.round(data.confidence)}` });
    return data.text;
  } catch (e) {
    ctx.log({ provider: "tesseract", model: "tesseract.js/eng", tier: "local", stage, tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - t0, ok: false, note: String(e).slice(0, 200) });
    throw e;
  } finally {
    await worker.terminate();
  }
}

/** Heuristic structuring of OCR text into screenshot fields. */
export function fieldsFromOcr(text: string): Omit<ScreenshotFields, "provenance"> {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const handle = text.match(/@[A-Za-z0-9_]{2,30}/)?.[0] ?? null;
  const handleLine = handle ? lines.findIndex((l) => l.includes(handle)) : -1;
  const display = handleLine >= 0 ? lines[handleLine].replace(handle!, "").replace(/[·•|✓]/g, "").trim() || (handleLine > 0 ? lines[handleLine - 1] : null) : null;
  const ts = text.match(/\b\d{1,2}:\d{2}\s?(?:AM|PM|am|pm)?\s?[·•]?\s?(?:\w{3,9}\.? \d{1,2},? \d{4})?|\b\d{1,2}[hm]\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w* \d{1,2},? \d{4}\b/)?.[0]?.trim() ?? null;
  const engagementRe = /\b[\d.,]+[KkMm]?\s*(?:reposts?|retweets?|likes?|views?|comments?|shares?|quotes?)\b/gi;
  const engagement = (text.match(engagementRe) ?? []).join(" · ") || null;
  const lower = text.toLowerCase();
  const platform: ScreenshotFields["platform"] = /repost|retweet|\bpost\b.*\bx\b|twitter/.test(lower) ? "x" : /facebook|like · comment · share/.test(lower) ? "facebook" : /instagram/.test(lower) ? "instagram" : /tiktok/.test(lower) ? "tiktok" : /forwarded|whatsapp/.test(lower) ? "whatsapp" : handle ? "x" : "unknown";
  const body = lines
    .filter((l, i) => i !== handleLine && l !== display && !new RegExp(engagementRe.source, "i").test(l) && !/^(?:follow|reply|repost|like|share|views?|translate post|show more)$/i.test(l))
    .filter((l) => !(ts && l.includes(ts) && l.length < ts.length + 12))
    .join(" ");
  return { platform, display_name: display, handle, post_text: normalizeInput(body), visible_timestamp: ts, engagement, embedded_image_description: null };
}

export async function readScreenshot(ctx: RunContext, buf: Buffer, mime: string): Promise<{ fields: ScreenshotFields; path: string[] }> {
  const path: string[] = [];
  let fields: Omit<ScreenshotFields, "provenance"> | null = null;
  if (llmAvailable("vision")) {
    try {
      fields = await chatJson(ctx, ScreenshotSchema, {
        tier: "vision",
        stage: "image: vision read",
        maxTokens: 1200,
        timeoutMs: 60_000,
        messages: [{ role: "user", content: [{ type: "text", text: VISION_PROMPT }, { type: "image_url", image_url: { url: `data:${mime};base64,${buf.toString("base64")}` } }] }],
      });
      path.push(`vision:${config.llm.models.vision}`);
    } catch {
      fields = null;
    }
  }
  if (!fields) {
    const raw = await ocr(ctx, buf);
    path.push("ocr:tesseract.js");
    const { value, usedFallback } = await withFallback(
      ctx,
      "image: OCR cleanup",
      "nano",
      () =>
        chatJson(ctx, ScreenshotSchema, {
          tier: "nano",
          stage: "image: OCR cleanup",
          maxTokens: 900,
          messages: [{ role: "user", content: `${VISION_PROMPT}\n\nThe image was read with OCR, which may contain errors and UI noise. OCR text:\n"""${raw.slice(0, 4000)}"""\nFix obvious OCR errors only; do not add content.` }],
        }),
      () => fieldsFromOcr(raw),
    );
    fields = value;
    path.push(usedFallback ? "cleanup:heuristic" : `cleanup:${config.llm.models.nano}`);
  }
  return { fields: { ...fields, post_text: redactPrivate(normalizeInput(fields.post_text)), provenance: "from_screenshot_unverified" }, path };
}

export async function imageToInput(ctx: RunContext, files: { buf: Buffer; mime: string; name: string }[]): Promise<ExtractedInput> {
  const reads = [];
  for (const f of files) {
    ctx.stage("read", `Reading screenshot${files.length > 1 ? ` ${reads.length + 1}/${files.length}` : ""}…`);
    reads.push({ ...(await readScreenshot(ctx, f.buf, f.mime)), thumb: await makeThumbnail(f.buf), name: f.name });
  }
  const primary = reads.find((r) => r.fields.handle) ?? reads[0];
  let text = "";
  const locations = reads.map((r, i) => {
    const start = text.length;
    text += (i ? "\n\n" : "") + r.fields.post_text;
    return { label: files.length > 1 ? `image ${i + 1}` : "screenshot", start: start + (i ? 2 : 0), end: text.length };
  });
  const meta: Record<string, string> = {};
  if (primary.fields.visible_timestamp) meta["visible timestamp (from_screenshot_unverified)"] = primary.fields.visible_timestamp;
  if (primary.fields.engagement) meta["visible engagement (from_screenshot_unverified)"] = primary.fields.engagement;
  if (primary.fields.embedded_image_description) meta["embedded image"] = primary.fields.embedded_image_description;
  return {
    sourceKind: "image",
    original: { kind: "upload", filename: primary.name, mime: files[0].mime, thumbnail: primary.thumb },
    text,
    language: "unknown",
    locations,
    unverifiedMetadata: meta,
    adapterPath: [...new Set(reads.flatMap((r) => r.path))],
    screenshot: primary.fields,
    notes: ["Fields read from a screenshot are unverified. Rootline traces what is said, not whether the image is authentic."],
  };
}
