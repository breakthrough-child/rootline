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

import { clip, excerptStrictlyIn, snapExcerptToPage, tokenCoverage } from "@/lib/text";
import { validateMutations } from "@/lib/heuristics";

describe("verbatim excerpts", () => {
  const page = "Intro. Men are offering free perfume samples at filling stations in Lagos. Unrelated middle text about football. They ask you to smell it and you faint, then they kidnap you.";
  it("strict check rejects lenient head/tail matches", () => {
    expect(excerptStrictlyIn("Men are offering free perfume samples at filling stations in Lagos.", page)).toBe(true);
    expect(excerptStrictlyIn("Men are offering free perfume samples at filling stations in Lagos. They ask you to smell it and you faint, then they kidnap you.", page)).toBe(false);
  });
  it("snap removes ellipses and keeps the longest real segment", () => {
    const stitched = "Men are offering free perfume samples at filling stations in Lagos. ... They ask you to smell it and you faint, then they kidnap you.";
    const snapped = snapExcerptToPage(stitched, page)!;
    expect(excerptStrictlyIn(snapped, page)).toBe(true);
    expect(snapExcerptToPage("Totally invented quote that is not on the page at all, honestly", page)).toBeNull();
  });
  it("clip never appends an ellipsis; coverage measures grounding", () => {
    expect(clip("one two three four five six seven", 15)).toBe("one two three");
    expect(tokenCoverage("free perfume samples", page)).toBe(1);
    expect(tokenCoverage("secret government cover up", page)).toBe(0);
  });
});

describe("validateMutations (honesty gate)", () => {
  const earlier = "Seven women have died after inhaling a free perfume sample. Please pass this on.";
  const later = "Free perfume samples at filling stations. 2,000 women missing. Police have confirmed. Forward to everyone!";
  const m = (type: string, before: string, after: string) => ({ type: type as never, before, after, explanation: "" });
  it("keeps grounded, correctly labelled mutations", () => {
    const out = validateMutations([m("number_changed", "Seven women", "2,000 women"), m("authority_added", "", "Police"), m("call_to_action_added", "", "Forward to everyone")], earlier, later);
    expect(out.map((x) => x.type)).toEqual(["number_changed", "authority_added", "call_to_action_added"]);
  });
  it("drops invented text, wrong-type numbers, empty and duplicate entries", () => {
    const out = validateMutations(
      [m("authority_added", "", "WHO"), m("number_changed", "seven women died", "a person"), m("number_changed", "Seven women", "2,000 women"), m("number_changed", "Seven women", "2,000 women"), m("urgency_added", "", ""), m("location_changed", "Ibadan", "filling stations")],
      earlier,
      later,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "number_changed", after: "2,000 women" });
  });
});

describe("mutation label consistency", () => {
  const m = (type: string, before: string, after: string) => ({ type: type as never, before, after, explanation: "" });
  const earlier = "Warning from WhatsApp users in Jersey. Seven women fell ill. Click the link below. I have just received information about a video called Martinelli.";
  const later = "An IT expert and the Randolph County Sheriff's Office say 2,000 women are missing. Hurry, registration closes Friday. Please share this with everyone. Beware of fraud.";
  it("rejects labels that don't fit the words they point at", () => {
    const bad = [
      m("authority_added", "", "Click the link below"),
      m("authority_added", "", "I have just received information"),
      m("location_changed", "WhatsApp", ""),
      m("number_changed", "Seven women", "Beware of fraud"),
      m("urgency_added", "", "Please share this with everyone"),
      m("target_changed", "Seven women", ""),
    ];
    expect(validateMutations(bad, earlier + " " + later, earlier + " " + later)).toEqual([]);
  });
  it("accepts labels that fit", () => {
    const e = "Seven women fell ill in Jersey. Click the link below.";
    const l = "The Randolph County Sheriff's Office says 2,000 women are missing in Lagos. Hurry, registration closes Friday. Please share this with everyone. Beware of fraud.";
    const good = [
      m("authority_added", "", "Randolph County Sheriff's Office"),
      m("number_changed", "Seven women", "2,000 women"),
      m("location_changed", "Jersey", "Lagos"),
      m("urgency_added", "", "Hurry, registration closes Friday"),
      m("call_to_action_added", "", "Please share this with everyone"),
      m("emotional_framing_added", "", "Beware of fraud"),
    ];
    expect(validateMutations(good, e, l, 10).map((x) => x.type)).toEqual(good.map((x) => x.type));
  });
});

import { messageMarkers } from "@/lib/pipeline";
describe("messageMarkers", () => {
  it("separates circulating-message pages from topic explainers", () => {
    expect(messageMarkers("A viral message is being forwarded on WhatsApp; fact-checkers say the claim is false.")).toBeGreaterThanOrEqual(4);
    expect(messageMarkers("Cell phones emit radiofrequency radiation. Studies have found no increased risk of brain tumours.")).toBeLessThan(2);
  });
});

import { specificTokens, speaksTo } from "@/lib/text";
describe("a source only contradicts a statement that it speaks to", () => {
  const circular = "The Federal Office of Civic Readiness announced that all schools nationwide will close for three weeks from Monday 12th October 2026.";
  it("extracts specifics (names, numbers), not sentence starters", () => {
    expect(specificTokens(circular)).toEqual(expect.arrayContaining(["federal", "office", "civic", "readines", "monday", "12th", "2026"]));
    expect(specificTokens("Men at filling stations give women free perfume samples.")).toEqual([]);
  });
  it("rejects a fact-check about a different school-closure rumor, accepts one about the same message", () => {
    const indian = "There is no nationwide closure order. Milad-un-Nabi is a Gazetted holiday for central government offices, but school closures are decided by states. Only three national holidays bind all schools.";
    expect(speaksTo(circular, indian)).toBe(false);
    const same = "Fact check: a circular from the Federal Office of Civic Readiness says all schools nationwide close for three weeks; the office has no record of it.";
    expect(speaksTo(circular, same)).toBe(true);
  });
  it("applies only the general-overlap rule when a statement has no specifics", () => {
    const s = "Men at filling stations give women free perfume samples that make them faint so they can be kidnapped.";
    expect(speaksTo(s, "A viral message says men are giving women free perfume samples at filling stations; police found no kidnappings.")).toBe(true);
    expect(speaksTo(s, "Department stores sell fragrance at counters near the entrance.")).toBe(false);
  });
});

describe("platform names are not authorities", () => {
  it("drops 'WhatsApp Gold version' but keeps real authorities", () => {
    const m = (after: string) => ({ type: "authority_added" as const, before: "", after, explanation: "" });
    const out = validateMutations([m("WhatsApp Gold version"), m("CNN and BBC")], "a hoax", "a hoax. WhatsApp Gold version. CNN and BBC");
    expect(out.map((x) => x.after)).toEqual(["CNN and BBC"]);
  });
});
