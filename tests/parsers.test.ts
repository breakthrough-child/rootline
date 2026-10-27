import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { docxToParts, joinParts, parsePdfDate, pdfToParts, pptxToParts, renderPdfPages, xlsxToParts } from "@/lib/adapters/document";
import { fieldsFromOcr, ocr } from "@/lib/adapters/image";
import { RunContext } from "@/lib/llm";

const F = (n: string) => readFile(path.join(__dirname, "..", "fixtures", "files", n));

describe("PDF", () => {
  it("extracts text per page with page labels and unverified metadata", async () => {
    const r = await pdfToParts(await F("circular-focr.pdf"));
    expect(r.pageCount).toBe(1);
    expect(r.parts[0].label).toBe("page 1");
    expect(r.parts[0].text).toContain("Lassa variant X");
    expect(r.scannedPages).toEqual([]);
    expect(Object.keys(r.meta).some((k) => k.includes("pdf_metadata_unverified"))).toBe(true);
  });
  it("parses PDF dates", () => {
    expect(parsePdfDate("D:20261009093000+01'00'")).toBe("2026-10-09");
  });
  it("detects a scanned PDF, renders it and OCRs the page", async () => {
    const buf = await F("scanned-circular.pdf");
    const r = await pdfToParts(buf);
    expect(r.scannedPages).toEqual([1]);
    const [img] = await renderPdfPages(buf, r.scannedPages, 1.5);
    expect(img.png.subarray(1, 4).toString()).toBe("PNG");
    const text = await ocr(new RunContext(), img.png);
    expect(text.toLowerCase()).toContain("schools");
  }, 120_000);
});

describe("DOCX", () => {
  it("extracts paragraphs with locations", async () => {
    const r = await docxToParts(await F("circular-focr.docx"));
    expect(r.parts.length).toBeGreaterThan(2);
    expect(r.parts[0].label).toBe("paragraph 1");
    expect(r.parts.map((p) => p.text).join(" ")).toContain("three weeks");
  });
});

describe("XLSX", () => {
  it("keeps sheet names, labeled cells and notes; skips unlabeled numeric grids", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Region", "Cases"],
      ["Kano", 1200],
      ["Claim", "Schools close for three weeks"],
      [5, 6, 7],
    ]);
    ws["B2"].c = [{ a: "x", t: "Figure from a forwarded message" }];
    XLSX.utils.book_append_sheet(wb, ws, "Outbreak");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const r = await xlsxToParts(buf);
    const all = r.parts.map((p) => `${p.label}: ${p.text}`).join("\n");
    expect(all).toContain("Outbreak!row 2: Kano — Cases: 1200");
    expect(all).toContain("Schools close for three weeks");
    expect(all).toContain("note: Figure from a forwarded message");
    expect(all).not.toContain("row 4");
  });
});

describe("PPTX", () => {
  it("extracts slide text and speaker notes with slide refs", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", '<p:sld><a:p><a:r><a:t>Grant &amp; relief</a:t></a:r></a:p><a:p><a:r><a:t>N50,000 for every citizen</a:t></a:r></a:p></p:sld>');
    zip.file("ppt/slides/slide2.xml", "<p:sld><a:p><a:r><a:t>Apply before Friday</a:t></a:r></a:p></p:sld>");
    zip.file("ppt/slides/_rels/slide1.xml.rels", '<Relationships><Relationship Target="../notesSlides/notesSlide1.xml"/></Relationships>');
    zip.file("ppt/notesSlides/notesSlide1.xml", "<p:notes><a:p><a:r><a:t>Source: a forwarded message</a:t></a:r></a:p><a:p><a:r><a:t>1</a:t></a:r></a:p></p:notes>");
    const r = await pptxToParts(await zip.generateAsync({ type: "nodebuffer" }));
    expect(r.parts).toEqual([
      { label: "slide 1", text: "Grant & relief\nN50,000 for every citizen" },
      { label: "slide 1 notes", text: "Source: a forwarded message" },
      { label: "slide 2", text: "Apply before Friday" },
    ]);
  });
});

describe("joinParts + OCR structuring", () => {
  it("builds locations that index into the joined text", () => {
    const { text, locations } = joinParts([{ label: "page 1", text: "Hello" }, { label: "page 2", text: " " }, { label: "page 3", text: "World" }]);
    expect(text).toBe("Hello\n\nWorld");
    expect(locations.map((l) => text.slice(l.start, l.end))).toEqual(["Hello", "World"]);
  });
  it("structures OCR text from a post screenshot", () => {
    const f = fieldsFromOcr("Kemi Reports\n@kemi_reports_247\nURGENT! Men are offering free perfume samples.\nForward to everyone!\n9:14 PM · Oct 3, 2026\n12.4K Reposts 31K Likes");
    expect(f.handle).toBe("@kemi_reports_247");
    expect(f.display_name).toBe("Kemi Reports");
    expect(f.post_text).toBe("URGENT! Men are offering free perfume samples. Forward to everyone!");
    expect(f.engagement).toContain("12.4K Reposts");
  });
});
