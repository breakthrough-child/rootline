// Optional on-disk response cache for development (saves Tavily credits and LLM quota).
// Enabled with DEV_CACHE=true (Tavily + LLM) — never on in production. Cache files live in .cache/ (gitignored).
// Keys hash the full request, so changing a prompt or query automatically misses.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const devCacheEnabled = () => process.env.DEV_CACHE === "true" && !process.env.VERCEL;

const dir = (kind: string) => path.join(process.env.DEV_CACHE_DIR || path.join(process.cwd(), ".cache"), kind);
const file = (kind: string, key: unknown) => path.join(dir(kind), `${createHash("sha1").update(JSON.stringify(key)).digest("hex")}.json`);

export async function cacheGet<T>(kind: string, key: unknown): Promise<T | null> {
  if (!devCacheEnabled()) return null;
  try {
    return JSON.parse(await readFile(file(kind, key), "utf8")) as T;
  } catch {
    return null;
  }
}

export async function cachePut(kind: string, key: unknown, value: unknown): Promise<void> {
  if (!devCacheEnabled()) return;
  try {
    await mkdir(dir(kind), { recursive: true });
    await writeFile(file(kind, key), JSON.stringify(value));
  } catch {
    /* cache is best-effort */
  }
}
