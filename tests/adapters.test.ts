import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileToInput, sniff, UploadError, validateUpload } from "@/lib/adapters";
import { evenSegments, segmentsToLocations } from "@/lib/adapters/audio";
import { textToInput } from "@/lib/adapters/text";
import { RunContext } from "@/lib/llm";
import type { ExtractedInput } from "@/lib/types";

const F = (n: string) => readFile(path.join(__dirname, "..", "fixtures", "files", n));

function expectValidInput(x: ExtractedInput) {
  expect(x.text.length).toBeGreaterThan(10);
  expect(x.adapterPath.length).toBeGreaterThan(0);
  for (const l of x.locations) {
    expect(l.start).toBeGreaterThanOrEqual(0);
    expect(l.end).toBeLessThanOrEqual(x.text.length);
    expect(x.text.slice(l.start, l.end).trim().length).toBeGreaterThan(0);
  }
}

describe("adapter → ExtractedInput", () => {
  it("text", () => {
    const x = textToInput("Fwd: *Schools* will close 🚨 for 3 weeks!!!");
    expect(x).toMatchObject({ sourceKind: "text", original: { kind: "paste" }, text: "Schools will close for 3 weeks!" });
    expectValidInput(x);
  });
  it("pdf", async () => {
    const x = await fileToInput(new RunContext(), [{ name: "c.pdf", mime: "application/pdf", buf: await F("circular-focr.pdf") }]);
    expect(x.sourceKind).toBe("pdf");
    expect(x.locations[0].label).toBe("page 1");
    expect(x.adapterPath).toContain("pdf:pdfjs-text");
    expectValidInput(x);
  });
  it("docx", async () => {
    const x = await fileToInput(new RunContext(), [{ name: "c.docx", mime: "", buf: await F("circular-focr.docx") }]);
    expect(x.sourceKind).toBe("docx");
    expect(x.text).toContain("FOCR/CIR/2026/117");
    expectValidInput(x);
  });
  it("audio segments → locations with timestamps", () => {
    const segs = evenSegments("Abeg una hear am? Government dey give grant. Share am.", 12);
    expect(segs).toHaveLength(3);
    expect(segs[2].end).toBeCloseTo(12, 0);
    const { text, locations } = segmentsToLocations(segs);
    expect(locations[1]).toMatchObject({ label: "00:03" });
    expect(text.slice(locations[1].start, locations[1].end)).toBe("Government dey give grant.");
  });
});

describe("upload validation", () => {
  it("sniffs magic bytes", async () => {
    expect(sniff(await F("screenshot-kemi-reports.png"))).toBe("png");
    expect(sniff(await F("circular-focr.pdf"))).toBe("pdf");
    expect(sniff(await F("circular-focr.docx"))).toBe("zip");
  });
  it("rejects wrong types, renamed files and oversize files", async () => {
    expect(() => validateUpload("x.exe", Buffer.from("MZ"))).toThrow(UploadError);
    expect(() => validateUpload("x.pdf", Buffer.from("\x89PNG\r\n\x1a\n0000"))).toThrow(/doesn't look like/);
    expect(() => validateUpload("x.png", Buffer.concat([Buffer.from("89504e47", "hex"), Buffer.alloc(11 * 1024 * 1024)]))).toThrow(/too large/);
    expect(validateUpload("x.png", await F("screenshot-kemi-reports.png"))).toEqual({ ext: "png", kind: "image" });
  });
});

describe("voice notes and video are a feature flag (off unless ASR_ENDPOINT_URL is set)", () => {
  it("rejects audio and video uploads with a clear message when no speech endpoint is configured", async () => {
    delete process.env.ASR_ENDPOINT_URL;
    const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]);
    await expect(fileToInput(new RunContext(), [{ name: "note.mp3", mime: "audio/mpeg", buf: mp3 }])).rejects.toThrow(/not enabled on this deployment.*ASR_ENDPOINT_URL/);
    const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(64)]);
    await expect(fileToInput(new RunContext(), [{ name: "clip.mp4", mime: "video/mp4", buf: mp4 }])).rejects.toThrow(UploadError);
  });
  it("the public status reports the flag", async () => {
    delete process.env.ASR_ENDPOINT_URL;
    const { publicStatus } = await import("@/lib/config");
    expect(publicStatus().asr).toBe(false);
  });
});
