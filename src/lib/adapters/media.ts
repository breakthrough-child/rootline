// ffmpeg helpers (audio conversion, duration probe, keyframes). Uses ffmpeg-static, or system ffmpeg.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function ffmpegPath(): Promise<string> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const mod = (await import("ffmpeg-static")) as unknown as { default?: string } | string;
    const p = typeof mod === "string" ? mod : mod.default;
    if (p && existsSync(p)) return p;
  } catch {
    /* fall back to PATH */
  }
  return "ffmpeg";
}

function run(bin: string, args: string[], timeoutMs = 120_000): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr = (stderr + d.toString()).slice(-20_000)));
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

/** Run fn with a temp dir that is always deleted afterwards (uploaded media is never kept). */
export async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "rootline-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function parseDuration(stderr: string): number | null {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

export async function probeDuration(buf: Buffer, ext: string): Promise<number | null> {
  const bin = await ffmpegPath();
  return withTemp(async (dir) => {
    const f = path.join(dir, `in.${ext}`);
    await writeFile(f, buf);
    const { stderr } = await run(bin, ["-hide_banner", "-i", f], 30_000);
    return parseDuration(stderr);
  });
}

/** Convert any audio/video to 16 kHz mono WAV (what ASR models expect). */
export async function toWav16k(buf: Buffer, ext: string, maxSeconds = 600): Promise<Buffer> {
  const bin = await ffmpegPath();
  return withTemp(async (dir) => {
    const f = path.join(dir, `in.${ext}`);
    const o = path.join(dir, "out.wav");
    await writeFile(f, buf);
    const { code, stderr } = await run(bin, ["-hide_banner", "-y", "-i", f, "-t", String(maxSeconds), "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", o]);
    if (code !== 0) throw new Error(`ffmpeg audio conversion failed: ${stderr.slice(-300)}`);
    return readFile(o);
  });
}

/** One keyframe every `every` seconds, at most `max`, as JPEG buffers with their timestamps. */
export async function extractFrames(buf: Buffer, ext: string, every = 5, max = 12): Promise<{ seconds: number; image: Buffer }[]> {
  const bin = await ffmpegPath();
  return withTemp(async (dir) => {
    const f = path.join(dir, `in.${ext}`);
    await writeFile(f, buf);
    const { code, stderr } = await run(bin, ["-hide_banner", "-y", "-i", f, "-vf", `fps=1/${every},scale='min(1280,iw)':-2`, "-frames:v", String(max), "-q:v", "4", path.join(dir, "f%03d.jpg")]);
    if (code !== 0) throw new Error(`ffmpeg frame extraction failed: ${stderr.slice(-300)}`);
    const files = (await readdir(dir)).filter((x) => x.startsWith("f") && x.endsWith(".jpg")).sort();
    return Promise.all(files.map(async (x, i) => ({ seconds: i * every, image: await readFile(path.join(dir, x)) })));
  });
}
