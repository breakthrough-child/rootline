# Teammate guide: deploy Rootline on Nebius Token Factory

Goal: you run Rootline **on your own accounts**, using **your own Nebius Token Factory key**, so the hackathon demo is powered by Nebius. This guide assumes no prior Vercel or Nebius experience. It takes about 45 minutes, most of it waiting.

> ## 🔒 The one rule
> **Never send your API keys to anyone**: not in chat, email, screenshots, GitHub issues or commits. Keys live in exactly two places: a file called `.env.local` on your laptop, and Vercel's "Environment Variables" page. Nobody else ever needs to see them. At the end you'll send back only a URL and some harmless output (see [Step 8](#step-8--what-to-send-back-and-what-never-to-send)).
> If a key leaks by accident, delete it in the provider's dashboard and make a new one. It takes a minute.

---

## What you need

| Thing | Where | Cost |
|---|---|---|
| A GitHub account | github.com | free |
| A Vercel account (sign in with GitHub) | vercel.com | free "Hobby" plan |
| A **Nebius Token Factory** account + API key | tokenfactory.nebius.com | pay-as-you-go; a full demo run costs a few cents |
| A **Tavily** account + API key | app.tavily.com | free tier: 1,000 credits/month |
| Node.js 20 or newer and Git on your computer | nodejs.org, git-scm.com | free |
| *(optional)* a Supabase project | supabase.com | free; only needed so share links and the Watchlist survive |

Check your tools: open a terminal and run `node -v` (should print `v20` or higher) and `git --version`.

---

## Step 1 — Get your own copy of the code

1. Open the project's public GitHub page (ask the team for the link).
2. Click **Fork** (top right) → **Create fork**. This puts a copy under *your* GitHub account, which Vercel needs.
3. In a terminal:

```bash
git clone https://github.com/<YOUR-GITHUB-USERNAME>/rootline.git
cd rootline
npm install
```

`npm install` takes a few minutes the first time.

> **If `npm install` hangs or times out** (seen on some Linux machines): run `export NODE_OPTIONS=--no-network-family-autoselection` first, then try again.

## Step 2 — Create your keys

**Nebius Token Factory**
1. Go to <https://tokenfactory.nebius.com> and sign in.
2. Open **API keys** → **Create key**. Copy it somewhere private for the next minute (it is shown once).
3. If the site says you can't sign up or pay from your country, tell the team right away; there is a workaround (see [Troubleshooting](#troubleshooting)).

**Tavily**
1. Go to <https://app.tavily.com>, sign in, and copy the API key (starts with `tvly-`).

## Step 3 — Put the keys in `.env.local` (on your laptop only)

```bash
cp .env.example .env.local
```

Open `.env.local` in any editor and fill in these lines (leave everything else as it is):

```ini
LLM_BASE_URL=https://api.tokenfactory.nebius.com/v1
LLM_API_KEY=<your Nebius key>
MODEL_NANO=nvidia/Nemotron-3_5-Lightning
MODEL_SUPER=nvidia/nemotron-3-super-120b-a12b
MODEL_ULTRA=nvidia/Nemotron-3-Ultra-550b-a55b
TAVILY_API_KEY=<your Tavily key>
```

`.env.local` is already excluded from Git (see `.gitignore`), so `git add` / `git commit` will never pick it up. You can double-check any time with `git status`: `.env.local` must **not** appear in the list.

**Model names are exact and case-sensitive**, and Nebius sometimes renames or retires models. So let Nebius tell you the real names:

```bash
npm run models
```

It prints the NVIDIA/Nemotron models available to *your* key and suggests `MODEL_*` lines. If it suggests different IDs than the ones above, **use the ones it prints**. It also suggests a vision model: put it in `MODEL_VISION=` (used to read screenshots; you can leave it empty and Rootline falls back to OCR).

## Step 4 — Check that your key and models actually work

```bash
npm run probe
```

This sends a tiny request to each model and prints `OK` or `FAIL` per model. You need `OK` for the three `MODEL_*` models you chose. (Models can be *listed* but still fail for your account; this is how you find out.)

- `FAIL 401` → the key is wrong. Re-copy it into `.env.local`.
- `FAIL 404` → that model name isn't available to you. Pick another from `npm run models`.
- `FAIL 429` → too many requests; wait a minute and retry.

## Step 5 — Run the demo cases against Nebius

```bash
npm run fixtures
```

This runs all five demo cases through the **real** pipeline (real web search, real Nemotron on Nebius) and saves the results in the `fixtures/` folder. It takes roughly 10–20 minutes and prints progress. When it finishes you should see five lines starting with `✓`, each reporting nodes, edges and "earliest=…".

Then see a summary table:

```bash
npm run eval
```

Look at the `mode` column: it must say **`live`**, not `offline_mock`. If it says `offline_mock`, your keys weren't picked up: re-check Step 3.

Optionally try the app yourself first: `npm run dev`, open <http://localhost:3000>, paste a forwarded message and press **Trace it**.

## Step 6 — Deploy on Vercel

1. Go to <https://vercel.com/new>, sign in with GitHub, and **Import** your fork `rootline`.
2. Leave the framework as **Next.js** and all build settings as detected.
3. Open **Environment Variables** and add these (name on the left, value on the right). Use the same values as your `.env.local`:

| Name | Value |
|---|---|
| `LLM_BASE_URL` | `https://api.tokenfactory.nebius.com/v1` |
| `LLM_API_KEY` | *your Nebius key* |
| `MODEL_NANO` | *as in `.env.local`* |
| `MODEL_SUPER` | *as in `.env.local`* |
| `MODEL_ULTRA` | *as in `.env.local`* |
| `MODEL_VISION` | *as in `.env.local` (or leave out)* |
| `TAVILY_API_KEY` | *your Tavily key* |
| `DEMO_MODE` | `false` |

   *Optional (keeps share links and the Watchlist permanently):* in Supabase, open **SQL editor**, paste the contents of `supabase/schema.sql`, run it, then add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from Supabase **Project settings → API**. Without these the app still works; results are just temporary.

4. Click **Deploy** and wait ~2–3 minutes. Vercel shows a link like `https://rootline-yourname.vercel.app`.

> Whenever you change an environment variable later, click **Redeploy** (Deployments → ⋯ → Redeploy); changes don't apply to old deployments.

## Step 7 — Confirm it works (the checklist)

Open your Vercel link, then:

- [ ] **Home page loads** and shows example chips under "Try an example".
- [ ] Open `https://<your-link>/api/status`. You should see `"llmProvider":"nebius"`, `"search":true`, and `"llm":{"nano":true,"super":true,"ultra":true,…}`. (This page shows model names but never keys; it's safe to copy.)
- [ ] Click an **example chip**: the tree animates and the banner says "Replay of a saved run".
- [ ] **Live run:** paste a forwarded message (for example: *"Men are giving free perfume samples at filling stations, you smell it and faint, then they kidnap you. Forward to every woman you know!"*) and press **Trace it**. Within 1–3 minutes you should see a tree with real source links (not `.example` domains) and a reply card.
- [ ] Click **How this was built**: it must say *"Models served by Nebius Token Factory"* and list your Nemotron model names with token counts.
- [ ] *(If you set up Supabase)* press **Copy share link**, open it in a private window: the same result appears.

If all boxes are ticked, you're done.

## Step 8 — What to send back (and what never to send)

✅ **Send:**
- your Vercel link;
- the text of `https://<your-link>/api/status`;
- the output table of `npm run eval` (copy from the terminal);
- the new `fixtures/*.json` files: commit and push them to your fork and open a **Pull Request** to the main repo (they contain no keys), or zip and send them.

⛔ **Never send:** `.env.local`; your Nebius or Tavily keys; screenshots of the Vercel Environment Variables page with values visible; your Supabase service-role key.

Before you push, run `git status` and confirm that only `fixtures/` files (and nothing named `.env…`) are being committed.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| `npm install` hangs | `export NODE_OPTIONS=--no-network-family-autoselection` then retry. |
| `npm run probe` says `401` | The key is wrong or has trailing spaces. Re-copy it. |
| `404` / "model not found" | Wrong or retired model name. Use exactly what `npm run models` prints. |
| `429 Too Many Requests` | You hit a rate limit. Rootline retries automatically; to slow it down add `LLM_RPM=30` to `.env.local` (and to Vercel). |
| Run says "provider isn't configured" | `LLM_API_KEY` or `MODEL_NANO` is empty on that machine/deployment. On Vercel, add it and **Redeploy**. |
| Live run times out on Vercel | Free (Hobby) plans limit request duration. Try again (results of repeated searches are faster), or ask the team; the example chips always work. |
| Everything says "offline mock" | Rootline was started with `OFFLINE_MOCK=true`. Remove it from your environment. |
| Screenshots aren't read well | Set `MODEL_VISION` to a vision model from `npm run models`; otherwise Rootline uses basic OCR. |
| Can't sign up for / pay on Nebius Token Factory | Tell the team. Rootline works with any OpenAI-compatible provider (only `LLM_BASE_URL`, `LLM_API_KEY` and `MODEL_*` change), so a teammate with access can run the Nebius deployment. |
| You pasted a key somewhere public | Delete it in the dashboard, create a new one, update `.env.local` and Vercel, redeploy. |

When the hackathon is over, delete your API keys from the Nebius and Tavily dashboards and remove the Vercel project if you no longer need it.
