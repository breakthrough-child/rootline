// Demo fixtures: saved full pipeline runs replayed with realistic streamed timing.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Investigation, RunEvent } from "./types";

export interface Fixture {
  id: string;
  title: string;
  chip: string;
  description: string;
  investigation: Investigation;
}

const dir = () => path.join(process.cwd(), "fixtures");

export async function listFixtures(): Promise<Omit<Fixture, "investigation">[]> {
  try {
    const files = (await readdir(dir())).filter((f) => f.endsWith(".json")).sort();
    const out = [];
    for (const f of files) {
      const fx = JSON.parse(await readFile(path.join(dir(), f), "utf8")) as Fixture;
      out.push({ id: fx.id, title: fx.title, chip: fx.chip, description: fx.description });
    }
    return out;
  } catch {
    return [];
  }
}

export async function getFixture(id: string): Promise<Fixture | null> {
  if (!/^[\w-]+$/.test(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(dir(), `${id}.json`), "utf8")) as Fixture;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Replay a saved run as the same event stream the live pipeline produces. */
export async function replay(fx: Fixture, emit: (e: RunEvent) => void, speed = 1) {
  const inv = fx.investigation;
  const wait = (ms: number) => sleep(ms / speed);
  const logs = [...inv.logs];
  const pushLogs = (n: number) => logs.splice(0, n).forEach((log) => emit({ type: "log", log }));
  emit({ type: "stage", stage: "replay", message: "Replay of a saved run" });
  await wait(400);
  if (inv.input.sourceKind !== "text") {
    emit({ type: "stage", stage: "read", message: `Reading ${inv.input.sourceKind === "image" ? "screenshot" : inv.input.sourceKind}…` });
    await wait(900);
  }
  for (const c of inv.claims) {
    emit({ type: "stage", stage: "A", message: "Understanding the claim…", claimId: c.claimId });
    pushLogs(2);
    await wait(700);
    emit({ type: "stage", stage: "B", message: `Searching the web with ${c.stats.queries} queries…`, claimId: c.claimId });
    for (let i = 1; i <= c.stats.queries; i++) {
      await wait(220);
      emit({ type: "stage", stage: "B", message: `Searching… ${i}/${c.stats.queries} queries · ${Math.round((c.stats.pagesSearched * i) / c.stats.queries)} sources`, claimId: c.claimId });
      pushLogs(1);
    }
    emit({ type: "stage", stage: "C", message: `Checking ${c.stats.pagesSearched} pages for versions of this message…`, claimId: c.claimId });
    await wait(900);
    pushLogs(Math.min(logs.length, c.stats.pagesSearched));
    emit({ type: "stage", stage: "C", message: `${c.variants.filter((v) => !v.isUserInput).length} related versions confirmed`, claimId: c.claimId });
    const sorted = [...c.variants].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
    for (const v of sorted) {
      emit({ type: "node", claimId: c.claimId, variant: v });
      await wait(260);
    }
    emit({ type: "stage", stage: "D", message: `Comparing ${c.stats.pairsCompared} pairs…`, claimId: c.claimId });
    await wait(900);
    pushLogs(Math.min(logs.length, c.stats.pairsCompared));
    emit({ type: "stage", stage: "F", message: "Building lineage…", claimId: c.claimId });
    await wait(700);
    for (const e of c.edges) {
      emit({ type: "edge", claimId: c.claimId, edge: e });
      await wait(180);
    }
    emit({ type: "stage", stage: "G", message: "Writing summary and reply card…", claimId: c.claimId });
    await wait(600);
    emit({ type: "claim_done", claim: c });
  }
  if (inv.checks.postExists || inv.checks.official) emit({ type: "check", ...inv.checks });
  pushLogs(logs.length);
  emit({ type: "result", investigation: { ...inv, mode: "replay", modeNote: `Replay of a saved run${inv.fixture?.generatedWith === "offline_mock" ? " (generated offline with the FICTIONAL mock corpus; sources are .example placeholders)" : ""}.` } });
}
