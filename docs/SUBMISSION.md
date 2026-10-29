# Rootline: Devpost submission (final text, ready to paste)

Text marked **[CONFIRM AFTER NEBIUS RUN]** is true only once a teammate has deployed on Nebius Token Factory and `npm run verify-nebius` passes. Confirm or delete each one before submitting.

---

## Project name
Rootline

## Tagline
See where it really came from before you forward it.

## Track
Best Apps and Agents · also entering Best Use of Tavily

## Short description (one paragraph)
Rootline traces a forwarded message, screenshot or "official" circular back through the web, builds a family tree of its earlier versions, shows what changed along the way, and writes a kind reply you can send back to the group chat. Every version links to a real page with the exact words found, and Rootline says plainly when it can't find enough. Powered by NVIDIA Nemotron models, with Tavily for search. **[CONFIRM AFTER NEBIUS RUN]** Inference runs on Nebius Token Factory.

---

## Inspiration
In Nigeria, India and Brazil, the most dangerous misinformation rarely arrives as a news article. It arrives as a forward from someone you trust: *"URGENT, men are drugging women with perfume samples. Police have confirmed. Forward to every woman you know."* It comes as a screenshot of a post, or a "circular" on official-looking letterhead. It leads to scams, panic and sometimes violence.

Fact-checks say *false*. They rarely show the thing that actually changes minds: **how the message changed.** A 2001 email about poisoned samples *mailed to people's homes* turns up years later as men at filling stations kidnapping women. When people can see where the scary details were added, they stop forwarding.

## What it does
You paste a forward, upload a screenshot or a PDF/Word/Excel/PowerPoint file. Rootline:

1. pulls out the checkable claim,
2. searches the web for earlier and parallel versions (Tavily),
3. keeps a page only if it is about the *same specific claim*, and quotes the message **word for word**,
4. builds a likely-lineage tree with confidence on every link, and marks the **earliest version found**,
5. shows the **detected changes** between copies (a new authority, new urgency, a new call to forward), strongest first, weaker ones behind a toggle,
6. writes a calm reply card under 60 words, with "Share to WhatsApp",
7. for screenshots asks **"Does this post actually exist?"**; for documents asks **"Is this official?"**,
8. lets teams save a rumor to a **Watchlist** and re-run it to see new versions,
9. knows when something is **not a forwarded message**: a plain news-style statement gets no family tree and no implied doubt, just what reputable sources report, neutrally summarised, with links.

It is built to be honest. Dates always say where they came from. Edges are inferences, never certainties. Rootline never calls anything "fake": it says *"No evidence this post exists"* or *"No official record found. Verify directly with the organization before acting."* When it finds little, it shows a "Limited family found" state instead of padding the tree.

## How we built it
- **Next.js (App Router) + TypeScript + Tailwind**, deployed on **Vercel**; a custom SVG “root system” view (top-down, grows by date) for the lineage tree; server-sent events stream every stage.
- **NVIDIA Nemotron, routed by job:** a small Nemotron model does the high-volume work (query planning, page-by-page checks, change detection); **Nemotron Super** clusters versions, **reviews every change label against the exact text** (it can keep, retype or drop a label but never invent one) and writes the verdict; **Nemotron Ultra** makes one hard call per claim to refine the lineage tree, starting from an algorithmic baseline and never allowed to add nodes. A vision-language model reads screenshots; Tesseract OCR is the fallback. Every output is validated with Zod.
- **Tavily** is the backbone: verbatim-phrase and paraphrase queries, page extraction for exact quotes, domain-aware searches for the post-exists and official checks, published dates for ordering.
- **Provider-agnostic by design:** the whole app talks to any OpenAI-compatible endpoint. Switching providers is only environment variables. **[CONFIRM AFTER NEBIUS RUN]** The deployed demo uses Nebius Token Factory.
- **Honesty is code, not copy:** quotes are built from numbered page sentences so they are verbatim by construction; every label must appear in the text and fit its type; changes are only computed between copies of the message (fact-check commentary is never compared); confidence is capped by wording similarity.
- Every model call is logged; the **"How this was built"** drawer shows model, tokens, latency and cost per tier against running everything on the biggest model.

## Challenges we ran into
- **Not treating true statements as rumors.** A real-world test showed that a plain news sentence was being treated as a rumor, with an unrelated opinion post as its "earliest version". We added an input classifier, a neutral path for general statements, and a rule that a fact-check attaches only if it addresses the same specific claim.
- **Not inventing anything.** Small models "tidy up" quotes and echo instructions. We stopped asking them to copy text and made them answer with sentence numbers instead.
- **Real data is messy.** On real runs, topic explainers, shop pages and rebuttals of *different* schemes were mistaken for versions of the message, and fact-check commentary was mistaken for the message. We added a same-specific-claim gate, a money-offer currency check and a copies-only rule for detecting changes.
- **Measuring ourselves honestly.** Our first hand-audit of change labels was too generous (we compared against truncated text). Re-scored properly, raw labels were only about a third correct, which pushed us to add a review pass and strict guards. We publish the real numbers in `docs/PROGRESS.md`.
- **Rate limits and flaky reasoning models.** Default "thinking" burns hundreds of tokens per call; free-tier limits return 429s. We added a throttle, backoff, and per-model parameter fallbacks.
- **Access.** We could not use Nebius Token Factory ourselves: **our billing country is not supported, so we were blocked at account creation.** We built and measured everything on NVIDIA's hosted API (the same Nemotron family) behind an env-var provider switch. A teammate with access deploys it on Nebius using `docs/TEAMMATE_DEPLOY.md` and a one-command checker (`npm run verify-nebius`). We have **not** tested Rootline on Token Factory ourselves. **[CONFIRM AFTER NEBIUS RUN]** The teammate's run passed.

## Accomplishments that we're proud of
- A tree that reads like a story: you can click the 2001 page and see the exact words, then follow the links to the version in your family chat.
- Honest failure states that are designed, not error pages: "Limited family found", "No evidence this post exists", "No official record found".
- A detector that *measures its own accuracy* and hides what it isn't sure about.
- One command (`npm run verify-nebius`) that tells a teammate in minutes whether a Nebius deployment is healthy.

## What we learned
- Routing is a product decision as much as a cost one: small models are good at many narrow, checkable questions; the biggest model earns its price on the single step that needs global reasoning; a mid-size model is a good *reviewer*. On our runs a trace cost roughly a cent (estimated at Token Factory list prices), several times less than routing everything through the biggest model.
- Showing *provenance* (where a date or quote came from) builds more trust than a confident verdict.
- Grounded is not the same as correct: a label can quote the text perfectly and still be the wrong kind of change. Measure both.

## What's next
- Compute changes against the nearest earlier *copy* even when the tree passes through a fact-check page, so more edges get labels.
- A WhatsApp entry point (forward a message, get the reply card back) and more languages for search (Yoruba, Igbo, Hausa, Hindi, Portuguese).
- Voice notes and video are already in the code behind a feature flag; they need a speech endpoint and real testing before we switch them on.
- Organisation workspaces with sign-in, alerts when a watched rumor changes, and an API for newsroom tools.

## Built with
Nebius Token Factory · NVIDIA Nemotron (Nano-class Lightning, Super, Ultra, vision-language) · Tavily · Next.js · TypeScript · Tailwind CSS · Zod · Supabase · pdf.js · mammoth · SheetJS · Tesseract.js · Vercel

## Try it out
- Live demo: `<VERCEL URL: add after the Nebius deployment>`
- Code: `<GITHUB URL>` (MIT licence)
- Demo video: `<VIDEO URL>`

---

## Hackathon requirements (for the judges)
- **Inference platform:** the code targets Nebius Token Factory by default (`LLM_BASE_URL=https://api.tokenfactory.nebius.com/v1`) and uses NVIDIA Nemotron models. **[CONFIRM AFTER NEBIUS RUN]** The submitted deployment and demo run on Nebius Token Factory. Development and the measurements in the repo were done on NVIDIA's hosted API because of the access issue above; each saved demo run states which provider produced it.
- **NVIDIA models used:** a Nano-class model (Lightning), Super, Ultra and a vision-language model (when available). Exact IDs are in the README.
- **Tavily:** search + extract, used for finding versions, exact quotes, the post-exists check and the official check.
- **Feedback prize:** `docs/FEEDBACK.md` lists what we measured and what we could only read in docs, with numbers.
- **Built during the submission period:** yes, entirely.
- **Repo:** public, MIT `LICENSE` at the root, README with setup, architecture diagram and per-model rationale.
