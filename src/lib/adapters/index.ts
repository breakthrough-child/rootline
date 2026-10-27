// Adapter dispatcher: upload validation, then conversion to ExtractedInput. A failing adapter
// throws a clear message; it never breaks the core pipeline.
import type { RunContext } from "../llm";
import type { ExtractedInput, SourceKind } from "../types";
import { AsrUnavailable, audioToInput, fmtTime, transcribe } from "./audio";
import { documentToInput } from "./document";
import { imageToInput, makeThumbnail, readScreenshot } from "./image";
import { extractFrames, probeDuration } from "./media";
export { textToInput } from "./text";

const MB = 1024 * 1024;

export const KINDS: Record<string, { kind: SourceKind; maxBytes: number }> = {
  png: { kind: "image", maxBytes: 10 * MB },
  jpg: { kind: "image", maxBytes: 10 * MB },
  jpeg: { kind: "image", maxBytes: 10 * MB },
  webp: { kind: "image", maxBytes: 10 * MB },
  mp3: { kind: "audio", maxBytes: 25 * MB },
  m4a: { kind: "audio", maxBytes: 25 * MB },
  ogg: { kind: "audio", maxBytes: 25 * MB },
  opus: { kind: "audio", maxBytes: 25 * MB },
  wav: { kind: "audio", maxBytes: 25 * MB },
  mp4: { kind: "video", maxBytes: 100 * MB },
  mov: { kind: "video", maxBytes: 100 * MB },
  webm: { kind: "video", maxBytes: 100 * MB },
  pdf: { kind: "pdf", maxBytes: 15 * MB },
  docx: { kind: "docx", maxBytes: 15 * MB },
  xlsx: { kind: "xlsx", maxBytes: 15 * MB },
  pptx: { kind: "pptx", maxBytes: 15 * MB },
};

/** Magic-byte sniffing so a renamed file can't slip through the extension check. */
export function sniff(buf: Buffer): string | null {
  const h = buf.subarray(0, 16);
  const hex = h.toString("hex");
  if (hex.startsWith("89504e47")) return "png";
  if (hex.startsWith("ffd8ff")) return "jpg";
  if (h.toString("ascii", 0, 4) === "RIFF" && h.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (h.toString("ascii", 0, 4) === "RIFF" && h.toString("ascii", 8, 12) === "WAVE") return "wav";
  if (h.toString("ascii", 0, 5) === "%PDF-") return "pdf";
  if (hex.startsWith("504b0304")) return "zip"; // docx/xlsx/pptx
  if (h.toString("ascii", 0, 4) === "OggS") return "ogg";
  if (h.toString("ascii", 0, 3) === "ID3" || hex.startsWith("fffb") || hex.startsWith("fff3") || hex.startsWith("fff2")) return "mp3";
  if (h.toString("ascii", 4, 8) === "ftyp") return "mp4"; // mp4/m4a/mov
  if (hex.startsWith("1a45dfa3")) return "webm";
  return null;
}

export function validateUpload(name: string, buf: Buffer): { ext: string; kind: SourceKind } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const spec = KINDS[ext];
  if (!spec) throw new UploadError(`Unsupported file type ".${ext}". Supported: ${Object.keys(KINDS).join(", ")}.`);
  if (buf.length > spec.maxBytes) throw new UploadError(`File is too large (${(buf.length / MB).toFixed(1)}MB). The limit for ${spec.kind} is ${spec.maxBytes / MB}MB.`);
  const s = sniff(buf);
  const ok =
    (s === "zip" && ["docx", "xlsx", "pptx"].includes(ext)) ||
    (s === "mp4" && ["mp4", "m4a", "mov"].includes(ext)) ||
    (s === "jpg" && ["jpg", "jpeg"].includes(ext)) ||
    (s === "ogg" && ["ogg", "opus"].includes(ext)) ||
    (s === "webm" && ["webm"].includes(ext)) ||
    s === ext;
  if (!ok) throw new UploadError(`The file content doesn't look like a .${ext} file.`);
  return { ext, kind: spec.kind };
}

export class UploadError extends Error {}

async function videoToInput(ctx: RunContext, buf: Buffer, name: string, mime: string, ext: string): Promise<ExtractedInput> {
  const duration = (await probeDuration(buf, ext)) ?? 0;
  if (duration > 181) throw new UploadError(`Video is ${Math.round(duration)}s; the limit is 3 minutes.`);
  const adapterPath: string[] = [];
  const notes = ["Rootline traces what is said, not whether the video itself is authentic."];
  const parts: { label: string; text: string; seconds: number }[] = [];
  let segments: ExtractedInput["segments"];
  ctx.stage("read", "Transcribing the video's audio…");
  try {
    const tr = await transcribe(ctx, buf, ext, 180);
    adapterPath.push(tr.path);
    segments = tr.segments;
    for (const s of tr.segments) parts.push({ label: `${fmtTime(s.start)} speech`, text: s.text, seconds: s.start });
    notes.push("Auto-transcribed; may contain errors, especially for Pidgin and local languages.");
  } catch (e) {
    notes.push(e instanceof AsrUnavailable ? "Speech was not transcribed (no speech-to-text provider configured)." : `Speech could not be transcribed: ${(e as Error).message}`);
  }
  ctx.stage("read", "Reading on-screen text from keyframes…");
  const frames = await extractFrames(buf, ext, 5, 12);
  let thumb: string | undefined;
  const seen: string[] = [];
  for (const f of frames) {
    thumb ??= await makeThumbnail(f.image);
    try {
      const { fields, path } = await readScreenshot(ctx, f.image, "image/jpeg");
      adapterPath.push(...path.map((p) => `keyframe:${p}`));
      const t = fields.post_text.trim();
      if (t.length > 8 && !seen.some((s) => s === t)) {
        seen.push(t);
        parts.push({ label: `${fmtTime(f.seconds)} on-screen`, text: t, seconds: f.seconds });
      }
    } catch {
      /* a frame failing is fine */
    }
  }
  parts.sort((a, b) => a.seconds - b.seconds);
  let text = "";
  const locations = parts.map((p) => {
    if (text) text += "\n";
    const start = text.length;
    text += p.text;
    return { label: p.label, start, end: text.length, seconds: p.seconds };
  });
  if (!text) throw new UploadError("No speech or on-screen text could be read from this video.");
  return { sourceKind: "video", original: { kind: "upload", filename: name, mime, thumbnail: thumb }, text, language: "unknown", locations, segments, unverifiedMetadata: { duration: `${Math.round(duration)}s` }, adapterPath: [...new Set(adapterPath)], notes };
}

export async function fileToInput(ctx: RunContext, files: { name: string; mime: string; buf: Buffer }[]): Promise<ExtractedInput> {
  if (!files.length) throw new UploadError("No file received.");
  const checked = files.map((f) => ({ ...f, ...validateUpload(f.name, f.buf) }));
  const kinds = new Set(checked.map((c) => c.kind));
  if (kinds.size > 1) throw new UploadError("Please upload one kind of file at a time.");
  const kind = checked[0].kind;
  if (kind !== "image" && checked.length > 1) throw new UploadError("Multiple files are only supported for screenshots.");
  const f = checked[0];
  switch (kind) {
    case "image":
      return imageToInput(ctx, checked);
    case "audio":
      return audioToInput(ctx, f.buf, f.name, f.mime);
    case "video":
      return videoToInput(ctx, f.buf, f.name, f.mime, f.ext);
    default:
      return documentToInput(ctx, f.buf, f.name, f.mime, kind);
  }
}
