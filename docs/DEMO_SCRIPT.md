# Demo video script (3:00 maximum)

Record at a phone-sized window (390 px) for the first beats and desktop for the tree and drawer. Calm voiceover. Everything on screen comes from the saved real runs in `fixtures/` (example chips) plus one live trace; all accounts and organisations shown are fictional. **Read on-screen claims as "the message says…", never as fact.**

| Time | On screen | Voiceover |
|---|---|---|
| **0:00–0:10** *Hook* | A mock family-chat screen. A forward lands from "Aunty": *"Please be careful ladies!!! Some men are standing at filling stations and malls giving women free perfume samples. Once you smell it you will faint and they will kidnap you…  Please share this with every woman you know."* | "This arrives in a family group chat. It sounds urgent. It's scary. Before you forward it: where did it actually come from?" |
| 0:10–0:25 | Copy it, open Rootline on the phone. Tagline "See where it really came from before you forward it." Paste, tap **Trace it**. Stage bar fills; nodes pop into the tree left to right. | "Rootline traces where a viral message came from and how it changed. It searches the web with Tavily and reads each page with NVIDIA Nemotron." |
| **0:25–0:55** *Origin story (perfume)* | Desktop. The finished perfume tree. Click the leftmost node: the badge **Earliest version found**, a **2001** fact-check page quoting *"Seven women have died after inhaling a free perfume sample that was mailed to them."* Show the excerpt, the link and the date label ("published date reported by the source"). Click your own copy beside it. Open **Detected changes** on the edge into it. | "The earliest version it found is from 2001: an email hoax about *mailed* perfume samples. Over the years it moved to malls and filling stations and picked up the kidnapping and organ-harvesting details. Every box links to a real page, with the exact words and where the date came from." |
| 0:55–1:10 | Show an **Evidence page** badge and a dashed low-confidence edge. Toggle **Show weaker changes**. | "Rootline is honest about what it doesn't know. Fact-check pages without a clean quote of the rumor are kept as evidence, not compared. Weak changes stay hidden unless you ask." |
| **1:10–1:50** *Deep tree (Martinelli)* | Click the example chip **WhatsApp "Martinelli" warning**. The tree: one copy in the middle, around it many dated **Evidence page** nodes (fact-checks from 2018 to today). Click the earliest (2018, Snopes: *"Warning from An Garda…"*). Click your own copy and open **Detected changes**: **+ CNN and BBC**, **− BBC radio**, **+ "forward / act"**. Show the timeline strip. | "Same idea on a hoax circulating since 2018. Most of what Rootline finds here are fact-checks, so it keeps them as dated evidence and doesn't pretend to compare them. Where it can compare real copies, it shows what changed: your version now says CNN and BBC confirm it, drops the BBC-radio framing, and adds an instruction to forward. Edges are 'likely lineage' with confidence, never certainty." |
| 1:50–2:05 | Open the **summary** and **reply card**. Tap **Share to WhatsApp** (prefilled, under 60 words, kind). | "Then it writes a short, kind reply for the group chat, with the sources behind it." |
| **2:05–2:25** *Screenshot* | New trace: upload `screenshot-kemi-reports.png`. Review screen: image beside the read-out (handle `@kemi_reports_247`, name, timestamp, all marked unverified). Run. The panel: **"No evidence this post exists."** | "Screenshots get an extra check: does this post actually exist? Here: no evidence that it does. It may be deleted, private or made up. Rootline also looks for earlier copies and only keeps pages about this same claim, so it shows an honest empty family rather than padding." |
| **2:25–2:42** *Circular* | Upload `circular-focr.pdf` (fictional "Federal Office of Civic Readiness"). Claim list, top claim preselected. Panel: **"No official record found. Verify directly with the organization before acting."** Unverified PDF metadata shown as hints. | "Fake circulars get an official check. No official record. Rootline never says 'fake'; it says what it found and what to do next." |
| 2:42–2:52 | Open **How this was built**: routing table (Nano ×N, Super, Ultra ×1, Tavily), tokens, latency, cost vs "all on Ultra", and the line "Models served by …". | "Every call is logged. Nano does the high-volume work, Super the judgement and a label review, Ultra one hard lineage call, at a fraction of running everything on Ultra." |
| 2:52–3:00 | **Watchlist**: an item, **Re-run**, "No new versions" or new nodes highlighted. Home screen, tagline. | "Newsrooms and NGOs can watch a rumor and re-run it. Rootline: see where it really came from before you forward it." |

## Which shots can be recorded now, and which must be redone on Nebius

| Shot | Record now (NVIDIA API fixtures) | Re-record on the Nebius deployment |
|---|---|---|
| Hook, tagline, paste, run view | ✅ | optional (a live trace on Nebius makes the run view honest) |
| Perfume, Martinelli, screenshot and circular trees, panels, reply card, WhatsApp share | ✅ (example chips; the banner says which provider produced each saved run) | after `npm run fixtures` on Nebius the same shots show "served by Nebius Token Factory" |
| Live trace of a pasted message | ✅ on NVIDIA (about 1–3 min: speed it up in the edit) | ✅ **should be redone** so the live shot is on Nebius |
| **How this was built** drawer | ⚠️ shows the NVIDIA API today | ✅ **must be re-recorded**: this is the shot that proves Nebius Token Factory |
| Watchlist re-run | ✅ (storage is provider-independent) | optional |
| Dark mode / phone-size cuts | ✅ | optional |

Voice notes and video are **not** shown: they are an experimental feature flag and untested.

## Notes for the editor

- The perfume and Martinelli fixtures are real runs and will differ slightly after regeneration on Nebius (different models, different search results). **Re-read the on-screen text before recording and adjust the voiceover to what the screen actually shows.** The beats above (earliest 2001 page, a Martinelli family reaching back to 2018, "no evidence this post exists", "no official record found") held in the final real runs we saved; the Martinelli tree is mostly evidence pages around a few copies, so show the dates and quotes more than the change labels.
- Say "earliest version found", not "origin". Say "detected changes", not "proof".
- If the Nebius run is slower than 1–3 minutes, cut the wait; never speed the voiceover.
