# Rootline — Devpost submission (draft)

**Tagline:** See where it really came from before you forward it.

**Track:** Best Apps and Agents · also entering Best Use of Tavily

**Built entirely during the submission period** of the Nebius × NVIDIA Global AI Hackathon (Oct 2026).

## Inspiration

In Nigeria, India and Brazil, the most dangerous misinformation doesn't arrive as a news article. It arrives as a forward from a relative: "URGENT, men are drugging women with perfume samples, 2,000 missing, police confirmed, forward to every woman you know." It comes as a screenshot of a post, a voice note in Pidgin, or a "circular" on official-looking letterhead. It leads to scams, panic and sometimes mob violence.

Fact-checks say *false*. They rarely show the thing that actually changes minds: how the message *mutated*. A 2017 forum post about a stranger and a business card becomes, three forwards later, "2,000 women missing, police confirmed", and later gains a doctor who doesn't exist. When people see the mutation, they stop forwarding.

## What it does

Rootline takes a forwarded message, screenshot, voice note, video or document and:

1. extracts the checkable claim(s),
2. finds earlier and parallel versions across the web (Tavily),
3. builds an evolutionary family tree of those versions,
4. labels each mutation between parent and child (number inflated, location swapped, fake authority added, urgency added, call to action added…),
5. shows the earliest version found and which mutation coincided with wider spread,
6. writes a kind, under-60-word reply card for the family group chat, with a "Share to WhatsApp" button,
7. for screenshots, checks **"Does this post actually exist?"**; for documents, **"Is this official?"**,
8. lets newsrooms, fact-checkers and NGOs save investigations to a **Watchlist** and re-run them to catch new mutations.

It is honest by construction: every node links to a real source with the exact excerpt (verified to appear on the page), every date shows its provenance, edges are "likely lineage" with confidence, and when little is found it says "Limited family found" instead of padding the tree.

## How we built it

- **Next.js (App Router) + TypeScript + Tailwind**, deployed on **Vercel**; React Flow for the animated, time-ordered tree; server-sent events stream every stage.
- **Nebius Token Factory** (OpenAI-compatible) runs all inference with **NVIDIA Nemotron**, routed by job:
  - **Nano**: high-volume parallel work: query planning, page membership with exact excerpts, pairwise mutation labelling, checks, OCR/transcript cleanup and translation.
  - **Super**: clustering variants into branches, ranking claims, writing the verdict and reply card.
  - **Ultra**: one hard call per claim, refining the lineage tree. It starts from an algorithmic baseline (a minimum spanning tree on wording distance, constrained so a parent is never later than its child) and may not add nodes. Its output is validated or discarded.
  - **NVIDIA vision** for screenshots, scanned pages and video keyframes (Tesseract.js fallback); an **ASR interface** for NVIDIA Parakeet/Canary or a Whisper endpoint on Nebius.
- **Tavily** search + extract is the backbone: verbatim-phrase and paraphrase queries (in the original language and English), extraction for exact quotes, domain-restricted searches for post-exists and official checks, and published dates for ordering.
- **Zod** validates every model output, with one corrective retry and a deterministic fallback per stage, so a bad response never blanks the screen.
- Every call is logged; the **"How this was built"** panel shows model, stage, tokens and latency, and compares the real cost with running everything on Ultra.

## Challenges we ran into

- **Not inventing anything.** LLMs love to "tidy up" quotes. We verify every excerpt against the page text and fall back to the verbatim best-matching passage, or drop the page.
- **Dates lie.** Search-reported dates can be last-updated dates, and screenshot timestamps can be faked. We track provenance per date and never order the tree by unverified dates.
- **Keeping Ultra honest.** A free-form "draw the tree" prompt invents edges and nodes. Giving Ultra a constrained baseline and validating its output made it a refiner, not a storyteller.
- **Finding model IDs and speech support** in Token Factory took real time (details in `docs/FEEDBACK.md`).
- **Media on serverless:** ffmpeg, OCR and pdf.js inside Vercel functions.

## Accomplishments that we're proud of

- A tree that reads like a story: you can point at the exact edge where "200" became "2,000" and "police confirmed" appeared.
- Honest failure states that are designed, not error pages: "Limited family found", "No evidence this post exists", "No official record found — verify directly with the organization".
- One pipeline for seven input types, each behind a clean adapter.

## What we learned

- Model routing is a product decision as much as a cost one: Nano is excellent at many narrow, verifiable questions; Ultra earns its price on the single step that needs global reasoning.
- Showing *provenance* (where a date or quote came from) builds more trust than confident verdicts.

## What's next

- WhatsApp bot entry point (forward a message to Rootline, get the reply card back).
- More languages for search and ASR (Yoruba, Igbo, Hausa, Hindi, Portuguese).
- Organization workspaces with auth, alerts when a watched rumour mutates, and an API for newsroom tools.
- Partnerships with fact-checkers to link debunks directly into the tree.

## Built with

Nebius Token Factory · NVIDIA Nemotron 3 (Nano, Super, Ultra) · NVIDIA vision/speech models · Tavily · Next.js · TypeScript · Tailwind CSS · React Flow · Zod · Supabase · pdf.js · mammoth · SheetJS · Tesseract.js · ffmpeg · Vercel
