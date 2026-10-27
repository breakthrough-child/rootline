import { describe, expect, it } from "vitest";
import { bestExcerpt, canonical, excerptAppearsIn, normalizeInput, redactPrivate, relatedness, similarity, wordDiff } from "@/lib/text";

describe("normalizeInput", () => {
  it("strips forwarding junk, emoji and chat formatting", () => {
    const raw = "Forwarded many times\n*URGENT* 🚨🚨 Men are offering _free_ perfume!!!!\n\n\n\nForward to everyone 🙏🙏";
    expect(normalizeInput(raw)).toBe("URGENT Men are offering free perfume!\n\nForward to everyone");
  });
  it("removes WhatsApp export prefixes and Fwd:", () => {
    expect(normalizeInput("[12/03/2024, 09:14] Aunty Bisi: Fwd: Schools will close")).toBe("Schools will close");
  });
  it("keeps numbers and currency intact", () => {
    expect(normalizeInput("N50,000 grant… 2,000 women")).toContain("N50,000 grant… 2,000 women");
  });
});

describe("similarity", () => {
  it("is 1 for identical text and high for near-identical", () => {
    expect(similarity("abc def", "abc def")).toBe(1);
    expect(relatedness("Men are offering free perfume samples in Lagos", "Men are offering free perfume samples in Abuja")).toBeGreaterThan(0.7);
  });
  it("is low for unrelated text", () => {
    expect(relatedness("Schools will close for three weeks", "Free perfume samples at filling stations")).toBeLessThan(0.25);
  });
  it("canonical ignores case and punctuation", () => {
    expect(canonical("Hello,   WORLD!")).toBe("hello world");
  });
});

describe("excerpts", () => {
  const page = "Intro text. Men are offering free perfume samples at filling stations in Lagos. They ask you to smell it and you faint. Unrelated footer.";
  it("bestExcerpt returns an exact substring of the page", () => {
    const { excerpt } = bestExcerpt(page, "free perfume samples at filling stations, smell it and faint");
    expect(page.includes(excerpt)).toBe(true);
    expect(excerpt).toContain("perfume");
  });
  it("excerptAppearsIn rejects invented quotes", () => {
    expect(excerptAppearsIn("Men are offering free perfume samples at filling stations in Lagos.", page)).toBe(true);
    expect(excerptAppearsIn("The police confirmed 5,000 women were kidnapped in Kano yesterday", page)).toBe(false);
  });
});

describe("privacy + diff", () => {
  it("redacts phone numbers and emails but not amounts", () => {
    expect(redactPrivate("Call +234 803 555 1234 or a@b.com for N50,000")).toBe("Call [number removed] or [email removed] for N50,000");
  });
  it("wordDiff finds added and removed words", () => {
    expect(wordDiff("200 women missing", "2000 women missing today")).toEqual({ removed: ["200"], added: ["2000", "today"] });
  });
});
