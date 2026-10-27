// Persistence for investigations (share links) and the Watchlist.
// Supabase (PostgREST over fetch) when configured; otherwise local JSON files so the app still runs.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import type { Investigation } from "./types";

export interface WatchItem {
  id: string;
  label: string;
  investigationId: string; // latest run
  createdAt: string;
  lastRunAt: string;
  runs: { investigationId: string; at: string; variantCount: number; newCount: number }[];
}

const useSupabase = () => !!(config.supabase.url && config.supabase.serviceKey);
const dataDir = () => process.env.ROOTLINE_DATA_DIR || (process.env.VERCEL ? "/tmp/rootline-data" : path.join(process.cwd(), ".data"));

async function sb<T>(pathAndQuery: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${config.supabase.url}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: config.supabase.serviceKey,
      Authorization: `Bearer ${config.supabase.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation,resolution=merge-duplicates",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const t = await res.text();
  return (t ? JSON.parse(t) : null) as T;
}

async function localWrite(kind: string, id: string, data: unknown) {
  const dir = path.join(dataDir(), kind);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${id.replace(/[^\w-]/g, "")}.json`), JSON.stringify(data));
}
async function localRead<T>(kind: string, id: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(dataDir(), kind, `${id.replace(/[^\w-]/g, "")}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}
async function localList<T>(kind: string): Promise<T[]> {
  try {
    const dir = path.join(dataDir(), kind);
    const files = await readdir(dir);
    return Promise.all(files.filter((f) => f.endsWith(".json")).map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as T));
  } catch {
    return [];
  }
}

/** Uploaded media is never stored: only extracted text, a small screenshot thumbnail and results. */
function stripForStorage(inv: Investigation): Investigation {
  const keepThumb = inv.input.sourceKind === "image";
  return { ...inv, input: { ...inv.input, original: { ...inv.input.original, thumbnail: keepThumb ? inv.input.original.thumbnail : undefined } } };
}

export async function saveInvestigation(inv: Investigation): Promise<void> {
  const data = stripForStorage(inv);
  if (useSupabase()) await sb("investigations", { method: "POST", body: JSON.stringify({ id: inv.id, created_at: inv.createdAt, data }) });
  else await localWrite("investigations", inv.id, data);
}

export async function getInvestigation(id: string): Promise<Investigation | null> {
  if (useSupabase()) {
    const rows = await sb<{ data: Investigation }[]>(`investigations?id=eq.${encodeURIComponent(id)}&select=data`);
    return rows?.[0]?.data ?? null;
  }
  return localRead<Investigation>("investigations", id);
}

export async function listWatch(): Promise<WatchItem[]> {
  const items = useSupabase() ? ((await sb<{ data: WatchItem }[]>("watchlist?select=data&order=updated_at.desc")) ?? []).map((r) => r.data) : await localList<WatchItem>("watchlist");
  return items.sort((a, b) => b.lastRunAt.localeCompare(a.lastRunAt));
}

export async function getWatch(id: string): Promise<WatchItem | null> {
  if (useSupabase()) return (await sb<{ data: WatchItem }[]>(`watchlist?id=eq.${encodeURIComponent(id)}&select=data`))?.[0]?.data ?? null;
  return localRead<WatchItem>("watchlist", id);
}

export async function saveWatch(item: WatchItem): Promise<void> {
  if (useSupabase()) await sb("watchlist", { method: "POST", body: JSON.stringify({ id: item.id, updated_at: item.lastRunAt, data: item }) });
  else await localWrite("watchlist", item.id, item);
}

export async function deleteWatch(id: string): Promise<void> {
  if (useSupabase()) await sb(`watchlist?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  else {
    const { rm } = await import("node:fs/promises");
    await rm(path.join(dataDir(), "watchlist", `${id.replace(/[^\w-]/g, "")}.json`), { force: true });
  }
}

export const storageBackend = () => (useSupabase() ? "supabase" : "local-json");
