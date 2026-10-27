// POST multipart (files) or JSON {text} → stream extraction progress, then {input, claims}.
import { fileToInput, textToInput, UploadError } from "@/lib/adapters";
import { extractClaims } from "@/lib/claims";
import { config } from "@/lib/config";
import { rateLimit, sseResponse } from "@/lib/http";
import { RunContext } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const limited = rateLimit(req, "extract", 12);
  if (limited) return limited;
  const ct = req.headers.get("content-type") ?? "";
  let files: { name: string; mime: string; buf: Buffer }[] = [];
  let text = "";
  try {
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      for (const v of form.getAll("files")) {
        if (typeof v === "string") continue;
        files.push({ name: v.name, mime: v.type, buf: Buffer.from(await v.arrayBuffer()) });
      }
      if (files.length > 6) return Response.json({ error: "Up to 6 screenshots at a time." }, { status: 400 });
    } else {
      const body = (await req.json()) as { text?: string };
      text = String(body.text ?? "");
      if (text.length > 20_000) return Response.json({ error: "Text is too long (max 20,000 characters)." }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Could not read the upload." }, { status: 400 });
  }
  return sseResponse(async (emit) => {
    const ctx = new RunContext(emit);
    try {
      if (config.offlineMock && files.some((f) => /\.(mp3|m4a|ogg|opus|wav|mp4|mov|webm)$/i.test(f.name)))
        throw new UploadError("Offline mock mode has no speech-to-text. Type or paste what is said instead.");
      const input = files.length ? await fileToInput(ctx, files) : textToInput(text);
      files = []; // drop buffers: uploaded media is never kept
      const claims = await extractClaims(ctx, input);
      emit({ type: "extracted", input, claims });
    } catch (e) {
      emit({ type: "error", stage: "read", message: (e as Error).message });
    }
  });
}
