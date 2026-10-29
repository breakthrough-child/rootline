import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planSoil, soilGeometry, type Rect } from "../src/lib/soilLayout";
import { validChangeNote } from "../src/lib/pipeline";

const dir = path.join(__dirname, "..", "fixtures");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe.each(files)("soil layout: %s", (f) => {
  const c = JSON.parse(readFileSync(path.join(dir, f), "utf8")).investigation.claims[0];
  if (c.kind === "general" || !c.variants?.length) return it("has no tree", () => {});
  const plan = planSoil(c.variants, c.edges, c.earliestId);
  const ids = plan.rows.flatMap((r) => (r.kind === "card" || r.kind === "user" ? [r.id] : r.kind === "stones" ? r.items.map((i) => i.id) : []));
  it("places every version exactly once", () => {
    expect([...ids].sort()).toEqual(c.variants.map((v: { id: string }) => v.id).sort());
  });
  it("user first (surface); each child above its parent", () => {
    expect(plan.rows[0].kind).toBe("user");
    const at = new Map(ids.map((id, i) => [id, i]));
    for (const e of plan.edges) expect(at.get(e.to)!).toBeLessThan(at.get(e.from)!);
  });
  it("draws finite roots from synthetic measured rows", () => {
    const rects = new Map<string, Rect>();
    let y = 20;
    for (const r of plan.rows) {
      if (r.kind === "gap") y += 24;
      else if (r.kind === "stones") {
        for (const it of r.items) rects.set(it.id, { x: it.side === 1 ? 560 : 100, y, w: 220, h: 32 });
        y += 48;
      } else {
        rects.set(r.id, { x: r.kind === "user" ? 300 : r.side === 1 ? 560 : 40, y, w: 300, h: 150 });
        y += 170;
      }
    }
    const g = soilGeometry({ plan, rects, width: 900, height: y + 100, strip: { x0: 330, x1: 570 }, compact: false });
    expect(g.roots.length).toBeGreaterThanOrEqual(plan.edges.length);
    for (const r of g.roots) expect(`${r.fill}${r.highlight}${r.hairs}`).not.toMatch(/NaN|undefined/);
    expect(g.connectors.length).toBeGreaterThanOrEqual(ids.length - 1);
  });
});

describe("change notes", () => {
  const a = "Seven women died after sniffing a perfume sample from Glen Eagles Hospital";
  const b = "Women died after sniffing a perfume sample. Share this now";
  it("accepts a grounded note and rejects invented quotes or verdicts", () => {
    expect(validChangeNote('Drops the hospital name and adds "Share this now".', a, b)).toBeTruthy();
    expect(validChangeNote('Adds "Call the police".', a, b)).toBeNull();
    expect(validChangeNote("This version is a hoax.", a, b)).toBeNull();
    expect(validChangeNote("", a, b)).toBeNull();
    expect(validChangeNote("word ".repeat(30), a, b)).toBeNull();
  });
});
