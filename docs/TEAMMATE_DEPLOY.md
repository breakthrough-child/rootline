# Teammate guide: deploy Rootline on Nebius Token Factory

Goal: run Rootline **on your own accounts** with **your own Nebius Token Factory key**, so the hackathon demo is powered by Nebius. No prior Vercel or Nebius experience needed. About 45 minutes, most of it waiting.

> ## 🔒 The one rule
> **Never send your API keys to anyone** — not in chat, email, screenshots, GitHub issues or commits. Keys live in exactly two places: a file called `.env.local` on your laptop, and Vercel's "Environment Variables" page. At the end you send back only a URL and some harmless output (see [Step 8](#step-8--what-to-send-back-and-what-never-to-send)). If a key leaks, delete it in the provider's dashboard and make a new one.

---

## The Nebius settings (copy this into `.env.local`)

Switching Rootline from the NVIDIA API (used during development) to Nebius is **only a change of environment variables**. Nothing in the code is NVIDIA-specific; the provider name shown in the app is read from each run's own log.

```ini
# ── Nebius Token Factory ─────────────────────────────────────────────
LLM_BASE_URL=https://api.tokenfactory.nebius.com/v1
LLM_API_KEY=<your Nebius key>

# Model IDs published in Nebius' own cookbook (github.com/nebius/token-factory-cookbook, models/nemotron).
# They are case-sensitive and Nebius rotates models: Step 4 checks them against YOUR key.
MODEL_NANO=nvidia/Nemotron-3_5-Lightning
MODEL_SUPER=nvidia/nemotron-3-super-120b-a12b
MODEL_ULTRA=nvidia/Nemotron-3-Ultra-550b-a55b

# Vision (reads screenshots). NOT confirmed: Nebius lists "NVIDIA Nemotron 3.5 Super VL" on its pricing page but its
# model ID is not in the public cookbook, so we don't guess. Leave empty to start (Rootline then uses OCR), then
# `npm run verify-nebius` prints the vision-capable candidates on your key; put one here and run it again.
MODEL_VISION=

# ── Search ───────────────────────────────────────────────────────────
TAVILY_API_KEY=<your Tavily key>

# ── Optional: keep share links + Watchlist permanently ───────────────
# NEXT_PUBLIC_SUPABASE_URL=
# SUPABASE_SERVICE_ROLE_KEY=
```

**What we know and don't know about Token Factory:** the base URL, bearer-key auth, `/v1/models` and chat completions are from Nebius' documentation. Model IDs for Lightning, Super and Ultra are from their cookbook. **We could not test any of it ourselves** (our account was blocked by a billing-country restriction), so the first thing you do is run the checker in Step 4. If a model ID is wrong, it tells you which ones your key can use, and `npm run probe` lists everything.

---

## What you need

| Thing | Where | Cost |
|---|---|---|
| A GitHub account | github.com | free |
| A Vercel account (sign in with GitHub) | vercel.com | free "Hobby" plan |
| A **Nebius Token Factory** account + API key | tokenfactory.nebius.com | pay-as-you-go; a full demo set costs well under $1 |
| A **Tavily** account + API key | app.tavily.com | free tier: 1,000 credits/month (one live trace ≈ 16–20 credits; `npm run fixtures` ≈ 80; `npm run verify-nebius` ≈ 10) |
| Node.js 20+ and Git | nodejs.org, git-scm.com | free |
| *(optional)* a Supabase project | supabase.com | free; makes share links and the Watchlist permanent |

Check: `node -v` prints `v20` or higher; `git --version` works.

---

## Step 1 — Get your own copy

1. Open the project's public GitHub page (ask the team for the link) and click **Fork** → **Create fork**.
2. In a terminal:

```bash
git clone https://github.com/<YOUR-GITHUB-USERNAME>/rootline.git
cd rootline
npm install
```

> If `npm install` hangs or times out (seen on some Linux machines): `export NODE_OPTIONS=--no-network-family-autoselection` and retry.

## Step 2 — Create your keys

- **Nebius**: <https://tokenfactory.nebius.com> → sign in → **API keys** → **Create key**. Copy it (shown once). If the site says you can't sign up or pay from your country, tell the team right away.
- **Tavily**: <https://app.tavily.com> → copy the key (starts with `tvly-`).

## Step 3 — Create `.env.local` (on your laptop only)

```bash
cp .env.example .env.local
```

Open `.env.local`, replace the provider block with the Nebius settings at the top of this page and paste your two keys. `.env.local` is already excluded from Git; `git status` must never list it.

## Step 4 — Check everything with one command

```bash
npm run verify-nebius
```

It checks your config, calls `/v1/models`, sends a tiny request to **every** model (and an image to the vision model if set), then runs **one small end-to-end trace on the real web** (about 1–3 minutes, ≈10 Tavily credits) and prints a checklist:

```
✅ PASS  LLM_API_KEY is set
✅ PASS  nano model answers (nvidia/Nemotron-3_5-Lightning)
❌ FAIL  super model answers (…)  — 404 …
…
══ ALL CHECKS PASSED ══
```

- **All PASS** (WARNs are fine) → go to Step 5.
- **FAIL on a model** → that ID isn't available to your key. The script prints "Nemotron models on this key"; copy the right IDs into `.env.local` and run it again. `npm run probe` tests every model on your key if you want more.
- **vision is SKIPPED** → set `MODEL_VISION` to one of the printed candidates, re-run. Or leave it empty (screenshots use OCR).
- **`GET /models` fails with 401** → wrong key. **429** → wait a minute; add `LLM_RPM=30` if it persists.

## Step 5 — Regenerate the demo cases on Nebius

```bash
npm run fixtures
```

Runs the five demo cases (perfume forward, a fictional-account screenshot, the WhatsApp "Martinelli" warning, a fictional-organisation circular, a general news statement) through the **real** pipeline and saves them in `fixtures/`. About 15–25 minutes. Each saved run records which provider produced it (read from its call log), so on Nebius the app labels them "served by Nebius Token Factory" automatically.

Then: `npm run eval` prints a summary table (the `mode` column must say `live`).

Optionally try it: `npm run dev`, open <http://localhost:3000>, paste a forwarded message, press **Trace it**.

## Step 6 — Deploy on Vercel

1. <https://vercel.com/new> → import your fork → keep the detected **Next.js** settings.
2. Add these **Environment Variables** (same values as `.env.local`):

| Name | Value |
|---|---|
| `LLM_BASE_URL` | `https://api.tokenfactory.nebius.com/v1` |
| `LLM_API_KEY` | *your Nebius key* |
| `MODEL_NANO` | *as in `.env.local`* |
| `MODEL_SUPER` | *as in `.env.local`* |
| `MODEL_ULTRA` | *as in `.env.local`* |
| `MODEL_VISION` | *as in `.env.local` (omit if empty)* |
| `TAVILY_API_KEY` | *your Tavily key* |
| `DEMO_MODE` | `false` |

   Optional: `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (run `supabase/schema.sql` in Supabase's SQL editor first). Without them everything works, but share links and the Watchlist are temporary.

3. **Deploy** (2–3 minutes). Whenever you change a variable later, **Redeploy**.

## Step 7 — Confirm it works

Open your Vercel link:

- [ ] Home page loads; example chips appear under "Try an example".
- [ ] `https://<your-link>/api/status` shows `"llmProvider":"nebius"`, `"search":true`, `"llm":{"nano":true,"super":true,"ultra":true,…}` (model names, never keys).
- [ ] Click an **example chip**: the tree animates; the banner says "Replay of a saved run … models served by Nebius Token Factory".
- [ ] **Live run:** paste *"WARNING! If you receive a video called MARTINELLI do not open it. It is a virus that will hack your phone…"* and press **Trace it** (1–3 min): a tree with real source links, a summary and a reply card.
- [ ] **How this was built** says "Models served by Nebius Token Factory" and lists your Nemotron models with token counts.
- [ ] *(Supabase set)* **Copy share link**, open it in a private window: same result.

## Step 8 — What to send back (and what never to send)

✅ Send: your Vercel link · the text of `/api/status` · the full terminal output of `npm run verify-nebius` · the output table of `npm run eval` · the new `fixtures/*.json` (commit to your fork and open a Pull Request, or zip them; they contain no keys). Also record the screen shots listed as "re-record on Nebius" in `docs/DEMO_SCRIPT.md`.

⛔ Never send: `.env.local` · any API key · screenshots showing Vercel's variable values · your Supabase service-role key.

Before pushing run `git status`: only `fixtures/` files should be listed.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| `verify-nebius`: FAIL on a model | Wrong/retired ID for your key. Use the IDs it prints; `npm run probe` tests all. |
| `401` | Wrong key, or stray spaces. Re-copy. |
| `404 model not found` | Case-sensitive ID. Copy it exactly from the printed list. |
| `429` | Rate limit; Rootline retries. Add `LLM_RPM=30` to slow it down. |
| "provider isn't configured" on Vercel | A variable is empty there. Add it and **Redeploy**. |
| Live run times out on Vercel | Free plans limit request time. Add `MAX_CANDIDATE_PAGES=24` and `MAX_PAIRS=24`; example chips always work. |
| Everything says "offline mock" | `OFFLINE_MOCK=true` is set somewhere; remove it. |
| Screenshots read poorly | Set `MODEL_VISION` (Step 4); otherwise OCR is used. |
| Voice-note / video buttons don't appear | By design: those features are off unless a speech endpoint is configured (`ASR_ENDPOINT_URL`) and are untested. |
| A key leaked | Delete it in the dashboard, create a new one, update `.env.local` and Vercel, redeploy. |

When the hackathon is over, delete your keys in the Nebius and Tavily dashboards and remove the Vercel project if you no longer need it.
