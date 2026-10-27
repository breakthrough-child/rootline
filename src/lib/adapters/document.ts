// Document adapters: PDF (text layer, or vision/OCR for scanned pages), DOCX, XLSX, PPTX.
import JSZip from "jszip";
import type { RunContext } from "../llm";
import type { ExtractedInput, InputLocation, SourceKind } from "../types";
import { readScreenshot } from "./image";

interface Part {
  label: string;
  text: string;
}

export function joinParts(parts: Part[]): { text: string; locations: InputLocation[] } {
  let text = "";
  const locations: InputLocation[] = [];
  for (const p of parts) {
    const t = p.text.trim();
    if (!t) continue;
    if (text) text += "\n\n";
    const start = text.length;
    text += t;
    locations.push({ label: p.label, start, end: text.length });
  }
  return { text, locations };
}

/** PDF dates look like D:20240114093000+01'00' */
export function parsePdfDate(s: string | undefined): string | undefined {
  const m = s?.match(/D?:?(\d{4})(\d{2})?(\d{2})?/);
  if (!m) return s || undefined;
  return [m[1], m[2] ?? "01", m[3] ?? "01"].join("-");
}

const MIN_CHARS_PER_PAGE = 40;
const MAX_SCANNED_PAGES = 6;

async function loadPdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

export async function pdfToParts(buf: Buffer): Promise<{ parts: Part[]; meta: Record<string, string>; scannedPages: number[]; pageCount: number }> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true }).promise;
  const parts: Part[] = [];
  const scannedPages: number[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let s = "";
    for (const it of tc.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof it.str !== "string") continue;
      s += it.str + (it.hasEOL ? "\n" : " ");
    }
    // Re-join soft line wraps (a line not ending a sentence followed by a lowercase/digit start).
    s = s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/([^.!?:;\n])\n(?=[a-z0-9(])/g, "$1 ").trim();
    if (s.replace(/\s/g, "").length < MIN_CHARS_PER_PAGE) scannedPages.push(i);
    parts.push({ label: `page ${i}`, text: s });
  }
  const meta: Record<string, string> = {};
  try {
    const { info } = (await doc.getMetadata()) as unknown as { info: Record<string, string> };
    if (info?.CreationDate) meta["created (pdf_metadata_unverified)"] = parsePdfDate(info.CreationDate)!;
    if (info?.ModDate) meta["modified (pdf_metadata_unverified)"] = parsePdfDate(info.ModDate)!;
    if (info?.Producer) meta["producer (pdf_metadata_unverified)"] = info.Producer;
    if (info?.Creator) meta["creator app (pdf_metadata_unverified)"] = info.Creator;
    if (info?.Author) meta["author (pdf_metadata_unverified)"] = info.Author;
    if (info?.Title) meta["title (pdf_metadata_unverified)"] = info.Title.replace(/\0/g, "");
  } catch {
    /* metadata is optional */
  }
  const pageCount = doc.numPages;
  await doc.destroy();
  return { parts, meta, scannedPages, pageCount };
}

/** Render PDF pages to PNG (for scanned PDFs) using pdfjs + @napi-rs/canvas. */
export async function renderPdfPages(buf: Buffer, pages: number[], scale = 2): Promise<{ page: number; png: Buffer }[]> {
  const pdfjs = await loadPdfjs();
  const { createCanvas } = await import("@napi-rs/canvas");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: { page: number; png: Buffer }[] = [];
  for (const n of pages.slice(0, MAX_SCANNED_PAGES)) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // @napi-rs/canvas implements the CanvasRenderingContext2D surface pdf.js needs.
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, canvas: canvas as unknown as HTMLCanvasElement }).promise;
    out.push({ page: n, png: await canvas.encode("png") });
  }
  await doc.destroy();
  return out;
}

export async function docxToParts(buf: Buffer): Promise<{ parts: Part[]; meta: Record<string, string> }> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: buf });
  const paras = value.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return { parts: paras.map((p, i) => ({ label: `paragraph ${i + 1}`, text: p })), meta: await officeCoreMeta(buf) };
}

/** docProps/core.xml (creator, created, modified) — unverified hints only. */
export async function officeCoreMeta(buf: Buffer): Promise<Record<string, string>> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("docProps/core.xml")?.async("string");
    if (!xml) return {};
    const get = (tag: string) => xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))?.[1];
    const meta: Record<string, string> = {};
    const c = get("dc:creator");
    const cr = get("dcterms:created");
    const md = get("dcterms:modified");
    if (c) meta["author (unverified metadata)"] = c;
    if (cr) meta["created (unverified metadata)"] = cr.slice(0, 10);
    if (md) meta["modified (unverified metadata)"] = md.slice(0, 10);
    return meta;
  } catch {
    return {};
  }
}

const isNumericLike = (v: unknown) => typeof v === "number" || (typeof v === "string" && /^[\s\d.,%$₦€£()+-]*$/.test(v));

/** SheetJS: sheet names, labeled cell text and notes; unlabeled numeric grids are skipped. */
export async function xlsxToParts(buf: Buffer): Promise<{ parts: Part[]; meta: Record<string, string> }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  const parts: Part[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: null });
    const headers = (rows[0] ?? []).map((h) => (typeof h === "string" ? h.trim() : null));
    rows.forEach((row, r) => {
      const label = typeof row[0] === "string" && !isNumericLike(row[0]) ? String(row[0]).trim() : null;
      const cells: string[] = [];
      row.forEach((v, c) => {
        if (v === null || v === "") return;
        if (!isNumericLike(v)) {
          if (c === 0 && label) return;
          cells.push(String(v).trim());
        } else if (label) {
          cells.push(`${headers[c] && r > 0 ? `${headers[c]}: ` : ""}${v}`);
        }
      });
      const text = [label, ...cells].filter(Boolean).join(" — ");
      if (text && (label || cells.some((c) => !isNumericLike(c)))) parts.push({ label: `${name}!row ${r + 1}`, text });
    });
    for (const [addr, cell] of Object.entries(ws)) {
      const comments = (cell as { c?: { t: string }[] }).c;
      if (addr.startsWith("!") || !comments) continue;
      for (const cm of comments) parts.push({ label: `${name}!${addr} note`, text: cm.t });
    }
  }
  return { parts, meta: await officeCoreMeta(buf) };
}

function xmlText(xml: string): string[] {
  const paras = xml.split(/<\/a:p>/);
  return paras
    .map((p) => [...p.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(""))
    .map((s) => s.trim())
    .filter(Boolean);
}

function decodeXml(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** PPTX: slide text and speaker notes, keeping slide references. */
export async function pptxToParts(buf: Buffer): Promise<{ parts: Part[]; meta: Record<string, string> }> {
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const parts: Part[] = [];
  for (const f of slideFiles) {
    const n = Number(f.match(/slide(\d+)\.xml/)![1]);
    const xml = await zip.file(f)!.async("string");
    parts.push({ label: `slide ${n}`, text: xmlText(xml).join("\n") });
    const rels = await zip.file(`ppt/slides/_rels/slide${n}.xml.rels`)?.async("string");
    const notesTarget = rels?.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)?.[1];
    if (notesTarget) {
      const notes = await zip.file(`ppt/notesSlides/${notesTarget}`)?.async("string");
      const t = notes ? xmlText(notes).filter((x) => !/^\d+$/.test(x)).join("\n") : "";
      if (t) parts.push({ label: `slide ${n} notes`, text: t });
    }
  }
  return { parts, meta: await officeCoreMeta(buf) };
}

export async function documentToInput(ctx: RunContext, buf: Buffer, name: string, mime: string, kind: SourceKind): Promise<ExtractedInput> {
  const adapterPath: string[] = [];
  let parts: Part[] = [];
  let meta: Record<string, string> = {};
  const notes: string[] = [];
  ctx.stage("read", `Reading ${kind.toUpperCase()}…`);
  if (kind === "pdf") {
    const r = await pdfToParts(buf);
    parts = r.parts;
    meta = r.meta;
    adapterPath.push("pdf:pdfjs-text");
    if (r.scannedPages.length) {
      ctx.stage("read", `Scanned pages detected (${r.scannedPages.length}); reading them as images…`);
      const imgs = await renderPdfPages(buf, r.scannedPages);
      for (const img of imgs) {
        const { fields, path } = await readScreenshot(ctx, img.png, "image/png");
        const idx = parts.findIndex((p) => p.label === `page ${img.page}`);
        parts[idx] = { label: `page ${img.page}`, text: fields.post_text };
        adapterPath.push(...path.map((p) => `scanned-page:${p}`));
      }
      if (r.scannedPages.length > MAX_SCANNED_PAGES) notes.push(`Only the first ${MAX_SCANNED_PAGES} scanned pages were read.`);
    }
  } else if (kind === "docx") {
    ({ parts, meta } = await docxToParts(buf));
    adapterPath.push("docx:mammoth");
  } else if (kind === "xlsx") {
    ({ parts, meta } = await xlsxToParts(buf));
    adapterPath.push("xlsx:sheetjs");
  } else if (kind === "pptx") {
    ({ parts, meta } = await pptxToParts(buf));
    adapterPath.push("pptx:ooxml");
  }
  const { text, locations } = joinParts(parts);
  if (!text.trim()) throw new Error("No readable text was found in this document.");
  if (Object.keys(meta).length) notes.push("Document metadata is shown as hints only (unverified metadata).");
  return {
    sourceKind: kind,
    original: { kind: "upload", filename: name, mime },
    text,
    language: "unknown",
    locations,
    unverifiedMetadata: meta,
    adapterPath: [...new Set(adapterPath)],
    notes,
  };
}
