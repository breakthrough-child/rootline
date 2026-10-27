# Demo video script (≤ 3:00)

Screen recording on a phone-sized browser window (390 px wide) for the first half, desktop for the tree and routing panel. Voiceover is calm. All accounts, organisations and people shown are fictional.

| Time | On screen | Voiceover |
|---|---|---|
| **0:00–0:10** | A family WhatsApp-style chat (mock). A message pops in from "Aunty": *"URGENT 🚨 Men are offering free perfume samples at filling stations… 2,000 women missing… Police have confirmed… Forward to every woman you know 🙏"* | "This arrives in a family chat. It sounds urgent and official. Before you forward it, where did it actually come from?" |
| 0:10–0:20 | Copy the message, open Rootline on the phone. Tagline visible. Paste. Tap **Trace it**. | "Rootline traces where a viral message came from and how it changed as it spread." |
| 0:20–0:45 | Live run view: stage bar fills, "Searching… 6/8 queries · 23 sources", "Checking 31 pages…", nodes pop into the tree left to right. | "It plans searches with NVIDIA Nemotron Nano, finds earlier and parallel versions with Tavily, and checks each page for a real copy of the message, keeping the exact quote." |
| 0:45–1:10 | Desktop. Tree complete. The leftmost node is badged **Earliest version found** (2017 forum post: a stranger offered a free perfume sample). Click it: exact excerpt, link, date provenance. | "The earliest version found is a 2017 forum post: a stranger offered a perfume sample at a filling station, she felt dizzy and walked away. No kidnapping, no numbers." |
| 1:10–1:30 | Follow the edges: chips **"Ibadan → Lagos"**, **"200 → 2,000"**, **"+ Police have confirmed"**, then **"+ Dr. Ama Felix of Bluewater Teaching Hospital"**. The amber **wider spread** marker sits on the "2,000 + police" edge. Click it. | "Each edge shows the mutation. Here the number jumps tenfold and a police confirmation appears, which is exactly where it started spreading widely. Later someone adds a doctor who doesn't exist." |
| 1:30–1:45 | Summary panel ("What sources contradict", fact-check links), then the reply card. Tap **Share to WhatsApp**: prefilled kind message. | "Rootline writes a calm reply you can send back to the group. Kind, not preachy." |
| 1:45–2:05 | New trace: drop the screenshot of **@kemi_reports_247** (fictional). Review screen shows image + extracted text. Run. Panel: **"No evidence this post exists."** The tree below shows the real lineage of its text. | "Screenshots get an extra check: does this post actually exist? Here: no evidence it does. It may be deleted, private or fabricated. But the words have a long family tree." |
| 2:05–2:25 | Upload `circular-focr.pdf` (fictional "Federal Office of Civic Readiness"). Claim list with top 3 preselected. Run. Panel: **"No official record found — verify directly with the organization before acting."** Unverified PDF metadata shown as hints. | "Fake circulars get an official check. No official record of this one, and its main claim traces back to a 2022 rumour." |
| 2:25–2:32 | Quick montage: voice note transcript (Pidgin, clickable timestamps), a video's on-screen text, Word, Excel and PowerPoint icons. | "…and voice notes, video, Word, Excel and PowerPoint for organisations." |
| 2:32–2:47 | Open **How this was built**: routing table (Nano ×40, Super ×2, Ultra ×1, Tavily), cost vs "all on Ultra". | "Every call is logged. Nano does the high-volume work, Super the judgement, Ultra one hard lineage call, all on Nebius Token Factory, at a fraction of running everything on Ultra." |
| 2:47–2:55 | **Watchlist**: an item with "2 new versions" after **Re-run**; new nodes highlighted. | "Newsrooms and NGOs can watch a rumour and re-run it to catch new mutations." |
| 2:55–3:00 | Home screen, tagline. | "Rootline. See where it really came from before you forward it." |

Recording notes:
- Use the live pipeline for the perfume trace if keys are configured; otherwise the example chips (labelled "Replay of a saved run").
- If fixtures were generated in offline-mock mode, the banner says so; regenerate with real keys before recording (`npm run fixtures`).
- Read every on-screen claim as the rumour's text, never as fact.
- The mutation chips and dates named above are what the fixture run is expected to show; match the voiceover to what your recorded run actually shows.
