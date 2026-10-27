// Voice-note adapter with a pluggable ASR provider interface.
//   1. NVIDIA speech model on Token Factory (MODEL_ASR, chat completions with input_audio), if available.
//   2. An OpenAI-compatible /v1/audio/transcriptions endpoint (ASR_ENDPOINT_URL) — e.g. NVIDIA Parakeet/Canary
//      NIM or a Whisper server deployed on a Nebius Serverless Endpoint.
//   3. Otherwise ASR is unavailable and the user types/pastes the transcript (the UI offers this).
import { config } from "../config";
import { chat, chatJson, RunContext, withFallback } from "../llm";
import { CleanupSchema } from "../schemas";
import { normalizeInput } from "../text";
import type { ExtractedInput, InputLocation, TranscriptSegment } from "../types";
import { probeDuration, toWav16k } from "./media";

export class AsrUnavailable extends Error {}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[];
  language: string;
  path: string;
}

export interface AsrProvider {
  name: string;
  available(): boolean;
  transcribe(ctx: RunContext, wav: Buffer, durationSec: number): Promise<Transcript>;
}

const tokenFactoryAsr: AsrProvider = {
  name: "tokenfactory",
  available: () => !config.offlineMock && !!config.nebius.apiKey && !!config.nebius.models.asr && !config.asr.endpointUrl,
  async transcribe(ctx, wav, durationSec) {
    // Token Factory exposes chat completions; audio-capable models accept OpenAI-style input_audio parts.
    const { text } = await chat(ctx, {
      tier: "asr", // routed through the multimodal base URL
      stage: "audio: transcribe",
      maxTokens: 4000,
      timeoutMs: 120_000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this audio verbatim in its original language (it may be Nigerian Pidgin, Yoruba, Igbo, Hausa or English). Output only the transcript." },
            { type: "input_audio", input_audio: { data: wav.toString("base64"), format: "wav" } },
          ],
        },
      ],
    });
    const clean = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return { text: clean, segments: evenSegments(clean, durationSec), language: "unknown", path: `asr:tokenfactory:${config.nebius.models.asr}` };
  },
};

const endpointAsr: AsrProvider = {
  name: "endpoint",
  available: () => !config.offlineMock && !!config.asr.endpointUrl,
  async transcribe(ctx, wav) {
    const t0 = Date.now();
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
    form.append("model", config.nebius.models.asr || "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    const url = config.asr.endpointUrl.replace(/\/$/, "");
    const full = /\/audio\/transcriptions$/.test(url) ? url : `${url}/v1/audio/transcriptions`;
    try {
      const res = await fetch(full, { method: "POST", headers: config.asr.apiKey ? { Authorization: `Bearer ${config.asr.apiKey}` } : {}, body: form, signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`ASR ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { text: string; language?: string; segments?: { start: number; end: number; text: string }[] };
      ctx.log({ provider: "asr-endpoint", model: config.nebius.models.asr || "whisper-1", tier: "asr", stage: "audio: transcribe", tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - t0, ok: true, note: new URL(full).host });
      const segments = (data.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
      return { text: data.text.trim(), segments: segments.length ? segments : evenSegments(data.text, 0), language: data.language ?? "unknown", path: `asr:endpoint:${config.nebius.models.asr || "whisper-1"}` };
    } catch (e) {
      ctx.log({ provider: "asr-endpoint", model: config.nebius.models.asr || "whisper-1", tier: "asr", stage: "audio: transcribe", tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - t0, ok: false, note: String((e as Error).message).slice(0, 200) });
      throw e;
    }
  },
};

export const ASR_PROVIDERS: AsrProvider[] = [tokenFactoryAsr, endpointAsr];

/** When a provider gives no timestamps, spread sentences evenly across the duration. */
export function evenSegments(text: string, durationSec: number): TranscriptSegment[] {
  const parts = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return [];
  const total = parts.reduce((a, p) => a + p.length, 0);
  let t = 0;
  return parts.map((p) => {
    const d = durationSec ? (p.length / total) * durationSec : 0;
    const seg = { start: Number(t.toFixed(1)), end: Number((t + d).toFixed(1)), text: p };
    t += d;
    return seg;
  });
}

export async function transcribe(ctx: RunContext, buf: Buffer, ext: string, maxSeconds: number): Promise<Transcript & { duration: number }> {
  const duration = (await probeDuration(buf, ext)) ?? 0;
  if (duration > maxSeconds + 1) throw new Error(`Audio is ${Math.round(duration)}s; the limit is ${maxSeconds}s.`);
  const providers = ASR_PROVIDERS.filter((p) => p.available());
  if (!providers.length) throw new AsrUnavailable("No speech-to-text provider is configured. Type or paste what the voice note says instead.");
  const wav = await toWav16k(buf, ext, maxSeconds);
  let lastErr: unknown;
  for (const p of providers) {
    try {
      return { ...(await p.transcribe(ctx, wav, duration)), duration };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("transcription failed");
}

/** Nano cleans up the transcript and translates to English for searching, keeping the original. */
export async function cleanupAndTranslate(ctx: RunContext, text: string): Promise<{ cleaned: string; language: string; english: string }> {
  const { value } = await withFallback(
    ctx,
    "audio: cleanup + translate",
    "nano",
    () =>
      chatJson(ctx, CleanupSchema, {
        tier: "nano",
        stage: "audio: cleanup + translate",
        maxTokens: 2000,
        messages: [
          {
            role: "user",
            content: `Auto-transcribed voice note (may be Nigerian Pidgin, Yoruba, Igbo, Hausa, English or mixed):\n"""${text.slice(0, 6000)}"""\nFix only obvious transcription errors (keep the speaker's words and language), detect the language, and translate faithfully to English. Return JSON: {"cleaned": string, "language": ISO code or "pcm" for Pidgin, "english": string}`,
          },
        ],
      }),
    () => ({ cleaned: normalizeInput(text), language: "unknown", english: "" }),
  );
  return value;
}

export function segmentsToLocations(segments: TranscriptSegment[]): { text: string; locations: InputLocation[] } {
  let text = "";
  const locations: InputLocation[] = [];
  for (const s of segments) {
    const start = text.length + (text ? 1 : 0);
    text += (text ? " " : "") + s.text;
    locations.push({ label: fmtTime(s.start), start, end: text.length, seconds: s.start });
  }
  return { text, locations };
}

export function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export async function audioToInput(ctx: RunContext, buf: Buffer, name: string, mime: string): Promise<ExtractedInput> {
  const ext = name.split(".").pop()?.toLowerCase() || "ogg";
  ctx.stage("read", "Transcribing voice note…");
  const tr = await transcribe(ctx, buf, ext, 600);
  ctx.stage("read", "Cleaning up and translating…");
  const c = await cleanupAndTranslate(ctx, tr.text);
  const { text: segText, locations } = segmentsToLocations(tr.segments);
  return {
    sourceKind: "audio",
    original: { kind: "upload", filename: name, mime },
    text: tr.segments.length ? segText : c.cleaned,
    englishText: c.english || undefined,
    language: c.language !== "unknown" ? c.language : tr.language,
    locations,
    segments: tr.segments,
    unverifiedMetadata: { duration: `${Math.round(tr.duration)}s` },
    adapterPath: [tr.path, "cleanup+translate:nano"],
    notes: ["Auto-transcribed; may contain errors, especially for Pidgin and local languages."],
  };
}
