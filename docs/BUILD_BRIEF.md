# Build "Rootline" end to end — Nebius x NVIDIA Global AI Hackathon entry

You are building a complete, working, deployable hackathon project. Work autonomously from start to finish. Do NOT stop to ask for approval between phases, propose phased plans, or wait after each stage. Only stop if truly blocked (e.g. a missing API key). Even then, build everything else first, using mocks behind a clear flag, and tell me exactly what you need.

**Deadline:** Oct 30, 2026, 10:00am PDT. Assume ~2 days of build time. A polished, reliable core beats many half-working features.

---

## 0. Build priorities (strict order)

Build in this order. Each tier must be working, tested and committed before starting the next. If time runs short, cut from the bottom, never from the top.

1. **Core:** pasted text → full pipeline → animated tree → summary → reply card → routing panel → demo mode with fixtures → deployed.
2. **Screenshots** (X/Facebook/WhatsApp/meme images) + the "Does this post actually exist?" check.
3. **Voice notes** (audio transcription).
4. **PDF + DOCX** + the "Is this official?" check + claim selection.
5. **Watchlist** + shareable results pages (Supabase).
6. **Video** (transcript + on-screen text).
7. **XLSX + PPTX** (text extraction only).

Write `docs/PROGRESS.md` and keep it updated with what is done, in progress and cut, so I can see status at any time.

---

## 1. What Rootline is

Rootline traces where a viral claim came from and how it mutated as it spread. Tagline: **"See where it really came from before you forward it."**

The user gives Rootline a forwarded message, a screenshot of a post, a voice note, a video, or a document. Rootline:

1. Extracts the claim(s).
2. Finds earlier and parallel versions across the web.
3. Builds an evolutionary family tree (phylogeny) of those versions.
4. Labels each mutation between parent and child: a number inflated, a location swapped, a fake authority added, urgency added, and so on.
5. Identifies the earliest version found (the likely origin) and which mutations coincided with wider spread.
6. Produces a shareable reply card to send back into the group chat.
7. Lets organizations save investigations to a Watchlist and re-run them to catch new mutations.

**Audience:** ordinary people receiving forwards, and organizations that track facts (newsrooms, fact-checkers, NGOs, comms teams).

**Real-world stakes:** forwarded misinformation causes scams, panic and violence, especially in Nigeria, India and Brazil. Rumors spread as text forwards, screenshots, voice notes (often in Pidgin, Yoruba, Igbo, Hausa) and fake official circulars.

### Honesty rules (the product's core value — enforce everywhere)

- Never invent a variant, source, date or quote.
- Every tree node links to a real source URL (or the user's upload), with the exact excerpt found.
- Too few variants found → show "Limited family found" with what was found. Never pad the tree.
- Dates always show their provenance: `published_date`, `page_metadata`, `from_screenshot_unverified`, `pdf_metadata_unverified`, or `unknown`.
- Tree edges are inferences. Show confidence (low / medium / high) and call the result "likely lineage."
- Never declare a post, document or video definitely fake. Use the defined outcomes (e.g. "No evidence this post exists," "No official record found").
- Rootline traces **what is said**, not whether media is authentic. No deepfake or manipulation detection claims.
- Mark only claims that sources actually contradict as false or unsupported.
- Demo fixtures use clearly fictional people and organizations. Never impersonate a real person, agency or brand.

---

## 2. Hackathon requirements this must satisfy

- All AI inference runs on **Nebius Token Factory** (or Nebius AI Cloud / Serverless) and uses **NVIDIA Nemotron** and other NVIDIA open models.
- Track: **Best Apps and Agents.** Also target **Best Use of Tavily**: Tavily is core to finding variants and official sources.
- Public repo with an **MIT LICENSE** file at the root.
- README with setup instructions, an architecture diagram, and clear sections on how Nemotron, Token Factory, other NVIDIA models and Tavily are used.
- A working hosted demo on Vercel (media processing on Nebius if needed).
- `docs/FEEDBACK.md`: honest, specific feedback on Token Factory, Nemotron, NVIDIA speech/vision models, Nebius Serverless and Tavily, gathered while building (docs gaps, errors, latency, model behavior). There is a "Most Valuable Feedback" prize.
- `docs/DEMO_SCRIPT.md`: a video script of 3 minutes or less.
- `docs/SUBMISSION.md`: draft Devpost text.

---

## 3. Stack

- Next.js (App Router) + TypeScript + Tailwind CSS. Deploy on Vercel.
- **Nebius Token Factory:** believed to be OpenAI-compatible. **Verify in the current official docs** the base URL, auth and exact model IDs for Nemotron Nano, Super and Ultra, and check which NVIDIA vision and speech models are available. Put everything in env vars. Never hardcode guessed model names.
- **Tavily** search + extract. Verify the current API in Tavily's docs.
- **Supabase** (Postgres) for saved investigations, the Watchlist and share links. If Supabase env vars are missing, fall back to local JSON storage so the app still runs.
- React Flow (or d3) for the animated tree, with a time-ordered left-to-right layout.
- `html-to-image` or `@vercel/og` for reply-card PNGs.
- `p-limit` to cap parallel model calls.
- Zod to validate every model output. Retry once on malformed JSON, then degrade gracefully.
- File parsing: pdfjs-dist or pdf-parse, mammoth (DOCX), SheetJS (XLSX), officeparser (PPTX), Tesseract.js (OCR fallback), ffmpeg (media).
- All API keys stay server-side.

`.env.example`:
```
NEBIUS_API_KEY=
NEBIUS_BASE_URL=
MODEL_NANO=
MODEL_SUPER=
MODEL_ULTRA=
MODEL_VISION=
MODEL_ASR=
ASR_ENDPOINT_URL=
TAVILY_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DEMO_MODE=false
```

---

## 4. Architecture

```
Input adapters → Claim extraction → Rootline core pipeline → Results + reply card
(text, image, audio, video, documents)
```

Each input adapter converts its input into a common `ExtractedInput` object:
- original content reference
- extracted text
- language
- source type
- locations (page/slide/sheet/timestamp)
- unverified metadata

After that, everything runs through one shared pipeline. Keep each adapter behind a clean interface so a failing adapter never breaks the core.

Stream progress to the UI with server-sent events at every stage ("Reading screenshot…", "Searching… 14 sources", "Comparing 38 pairs…", "Building lineage…").

**Log every model call** (provider, model, stage, tokens in/out, latency) for the routing panel.

---

## 5. Input adapters

### 5.1 Text (tier 1)
Paste box. Normalize the input: strip forwarding junk, chat formatting and emoji noise.

### 5.2 Screenshots (tier 2)
- Upload, drag-drop, paste from clipboard; camera roll on mobile. PNG/JPG/WebP, max 10MB; multiple images allowed.
- Read with an NVIDIA Nemotron vision-language model on Token Factory if available (`MODEL_VISION`). Otherwise, fall back to Tesseract.js OCR followed by Nano cleanup. Log which path was used.
- Extract (Zod-validated): platform (x, facebook, instagram, tiktok, whatsapp, news_site, meme, unknown), display_name, handle, post_text, visible timestamp, visible engagement counts, embedded image description. All fields are marked `from_screenshot_unverified`.
- Privacy: never store unrelated private details visible in the image (other chat participants' names, phone numbers). Keep only the post content.
- **"Does this post actually exist?" check:** if a handle is present, search with Tavily for the post text together with the handle and display name. Use Nano to compare. Outcomes:
  - `found_matching` (link it)
  - `found_altered` (show exact wording differences)
  - `not_found` ("No evidence this post exists. It may be deleted, private or fabricated.")
- Let the user edit the extracted text before running. Show the image next to the extracted text.

### 5.3 Voice notes (tier 3)
- mp3, m4a, ogg/opus (WhatsApp), wav. Max 10 minutes.
- ASR provider interface. Order of preference:
  1. An NVIDIA speech model (Parakeet / Canary) on Token Factory, if available.
  2. NVIDIA Parakeet or Canary deployed on a Nebius Serverless Endpoint, if achievable in about 2 hours. Document the steps in the README.
  3. An open-source Whisper model as the fallback.
  Log which path was used.
- Always show the transcript, editable, labeled "Auto-transcribed; may contain errors, especially for Pidgin and local languages."
- Nano cleans up the transcript and translates it to English for searching, keeping the original. Search in both the original language and English.
- Audio player with a clickable transcript (click a line to jump to its timestamp).

### 5.4 PDF + DOCX (tier 4)
- Max 15MB. Parse server-side. Delete files after extraction.
- Scanned PDFs (little or no text layer): render pages to images and use the screenshot vision/OCR path.
- Keep page references for every extracted span.
- **"Is this official?" check** for documents that present themselves as official (letterhead text, an organization name, a reference number, a signatory, a date):
  - Use Tavily to search the issuing organization's official site and reputable news. Prioritize official domains (e.g. .gov.ng) and verified sites.
  - Outcomes: `official_match_found`, `official_version_differs` (show differences), `no_official_record_found` ("Verify directly with the organization before acting"), `already_debunked` (link it).
  - Show PDF metadata (creation date, producer, author) as hints only, labeled "unverified metadata."
- Document viewer showing extracted text, with traced claims highlighted and linked to their trees.

### 5.5 Video (tier 6)
- mp4, mov, webm. Max 3 minutes / 100MB.
- ffmpeg: extract the audio and transcribe it via the ASR interface. Extract keyframes (1 per 5 seconds, max 12) and read on-screen text via the vision/OCR path. Merge the transcript and on-screen text.
- UI note: "Rootline traces what is said, not whether the video itself is authentic."
- Vercel limits may not fit ffmpeg or long processing. If so, run media processing on a Nebius Serverless Job/Endpoint and document it.

### 5.6 XLSX + PPTX (tier 7)
- SheetJS: sheet names, labeled cell text, notes (skip unlabeled numeric grids). officeparser: slide text and speaker notes. Keep sheet/slide references.

### 5.7 Claim selection (for documents, video and long audio)
- Nano extracts checkable factual claims with their locations. Super ranks them by checkability and significance.
- The UI shows a claim list with checkboxes, with the top 3 preselected. Each selected claim runs through the core pipeline. Results are grouped under one investigation.

### 5.8 Media handling
Delete uploaded media and files after processing. Store only extracted text, claims, a small thumbnail (screenshots only) and results.

---

## 6. Core pipeline

**Stage A — Understand (Nano):**
- Extract the core claim, entities, numbers, places, named authorities and any call to action.
- Generate 4–8 search queries, mixing exact distinctive phrases with paraphrases (mutated copies reword things). Include English and original-language queries where relevant.

**Stage B — Find relatives (Tavily):**
- Run the queries with Tavily search. Deduplicate URLs. Use Tavily extract to get content.
- Keep published dates and record their provenance.
- Enforce budget caps: max candidate pages per run (e.g. 40).

**Stage C — Confirm membership (Nano, parallel):**
- For each page: does it contain a version of the same message or claim? If yes, return the exact excerpt and a normalized version.
- Tag the page type: `debunk` / `news` / `social` / `forum` / `official` / `other`. Debunk articles that quote the rumor count as evidence the variant existed.
- Deduplicate near-identical variants into one node with multiple sources.

**Stage D — Mutations (Nano, parallel, capped):**
- Pre-filter candidate pairs locally (text similarity + time ordering) to limit calls. Cap max pairs per run (e.g. 80).
- For each pair, Nano returns a list of mutations. Mutation types:
  - number_changed
  - location_changed
  - authority_added
  - authority_removed
  - urgency_added
  - date_changed
  - target_changed
  - call_to_action_added
  - emotional_framing_added
  - detail_added
  - detail_removed
  - other
- Each mutation includes before, after, and a one-line explanation.

**Stage E — Cluster (Super):**
- Merge duplicates, standardize mutation labels, group variants into branches.

**Stage F — Lineage (Ultra):**
- First build a baseline tree algorithmically: a minimum spanning tree on distance, constrained so a parent is never later than its child when both dates are known.
- Ultra refines the tree: parent edges with confidence and a short reason, the earliest version found, and a plain-language evolution summary.
- Ultra must not add nodes. Validate that every node ID it returns already exists.

**Stage G — Verdict + reply card (Super):**
- A calm, non-preachy summary: likely origin, what changed, and what the sources show is false or unsupported.
- Reply-card text under 60 words, written for a family group chat: kind, never condescending.

**Reliability:**
- Timeouts per stage and graceful partial results.
- Every stage failure shows a clear message, never a blank screen.

---

## 7. UI

Design it as a real product: calm, trustworthy, modern. Mobile-first, because many users arrive from WhatsApp on phones. Dark and light modes.

- **Home:**
  - Paste box plus one upload zone (images, audio, video, documents).
  - The tagline.
  - Example chips that load the demo cases.
  - One-line explainer: "Rootline finds earlier versions of a message and shows how it changed."
- **Input review:**
  - For uploads, show the extracted text, transcript or claim list for review and editing before the run.
- **Live run view:**
  - Stage progress, then the tree growing node by node.
- **Tree view:**
  - Nodes: date with provenance icon, source type, snippet, and a thumbnail for screenshots, audio and video.
  - Edges: mutation chips (e.g. "200 → 2,000", "+ fake WHO quote"), with confidence shown by style (dashed = low).
  - The earliest found node is badged "Earliest version found."
  - Clicking a node opens a side panel: full excerpt, source links, date provenance, mutations.
- **Timeline strip** under the tree.
- **Check panels** (shown when relevant):
  - "Does this post actually exist?"
  - "Is this official?"
- **Summary panel:** how it evolved, what is unsupported, confidence.
- **Reply card:** preview, PNG download, copy text, and a "Share to WhatsApp" button (wa.me link with prefilled text).
- **"Limited family found" state:** designed well, not an error.
- **"How this was built" drawer:**
  - The routing panel, built from real logs: each model call's model, stage, tokens and latency.
  - A real estimated cost/latency comparison against running everything on Ultra.
  - The vision/ASR paths used.
- **Watchlist (`/watchlist`):**
  - Saved investigations.
  - "Re-run" highlights variants new since the last run.
  - Keep auth simple: none, or Supabase magic link only if time allows.
- **Share page `/r/[id]`.**

---

## 8. Demo mode and fixtures

Run each demo case through the **real** pipeline, then save the full results (including routing logs) as JSON in `/fixtures`. `DEMO_MODE=true` replays them with realistic streamed timing, labeled "Replay of a saved run." The live pipeline must still work for any input when demo mode is off.

Fixtures:
1. **Text forward:** a widely circulated "kidnappers drugging people with perfume/scent" scare.
2. **Text forward:** a "free government cash grant, click this link" scam chain.
3. **Screenshot:** a fabricated-looking post from a **clearly fictional** account, showing `not_found` plus the real lineage of its text.
4. **Voice note:** a fictional speaker (I record it, or use a clearly synthetic placeholder voice — never imitate a real person) repeating one demo rumor in English or Pidgin, showing the transcript → tree flow.
5. **Document:** a fake-looking circular from a **clearly fictional** organization (no real agency letterhead or branding), showing `no_official_record_found` plus the tree of its main claim.

Put sample source files in `/fixtures/files`. Include a script to regenerate the fixtures.

---

## 9. Quality

- Unit tests for:
  - normalization
  - deduplication
  - the baseline tree algorithm (including the date constraint)
  - Zod schemas
  - each file parser, including a scanned PDF
  - adapter → `ExtractedInput` conversion
- `scripts/eval.ts`: runs all fixtures and prints node counts, edge confidence, latency and cost.
- Run lint, typecheck, tests and a production build before finishing. Fix everything.
- Add basic rate limiting on API routes. Validate upload types and sizes server-side.

---

## 10. Deliverables checklist (complete all)

- [ ] Working app deployed to Vercel (+ Nebius endpoint if used). If deployment needs my login, prepare everything and give me exact commands.
- [ ] MIT LICENSE at the repo root.
- [ ] README:
  - what it is and why
  - a Mermaid architecture diagram
  - how Nemotron Nano/Super/Ultra, NVIDIA vision/speech models and Token Factory are used, and why each model tier does each job
  - how Tavily is used
  - supported inputs, setup, env vars, demo mode
  - honesty rules and limitations
- [ ] `docs/FEEDBACK.md`: real, specific feedback collected while building.
- [ ] `docs/DEMO_SCRIPT.md`: a 3-minute script with timestamps.
  - 0:00–0:10 hook: a real-looking forward arrives in a family chat.
  - Main moments:
    - paste → tree grows → origin revealed → the mutation where the lie was inserted → reply card sent back
    - screenshot → "No evidence this post exists"
    - fake circular → "No official record found"
  - Quick line: "…and voice notes, video, Word, Excel and PowerPoint for organizations."
  - Routing panel, then the Watchlist for organizations.
  - Close.
- [ ] `docs/SUBMISSION.md`: draft Devpost text (inspiration, what it does, how we built it, challenges, accomplishments, what we learned, what's next). State that the project was built entirely during the submission period.
- [ ] `docs/PROGRESS.md`: final status, including anything cut.
- [ ] `.env.example`, a clean commit history, no secrets committed.

When everything is done, give me a short summary: what works, which tiers are complete, the deploy steps that need me, and the known limitations.
