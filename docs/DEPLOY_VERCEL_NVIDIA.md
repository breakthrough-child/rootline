# Test deployment on Vercel (NVIDIA API + your Supabase)

For development while Nebius Token Factory is unavailable to you. The same build later runs on Nebius by changing env vars only (see [TEAMMATE_DEPLOY.md](TEAMMATE_DEPLOY.md)).

## 0. Before you deploy

```bash
npm run lint && npm run typecheck && npm test && npm run build   # all must pass
npm run probe                                                   # every MODEL_* you use must say OK
git status                                                      # .env.local must NOT be listed
```

Supabase: you already applied `supabase/schema.sql`. Verified: server-side saves and reads work with the service-role key, and the public anon key can neither read nor write those tables (Row Level Security is on).

## 1. Log in and link (needs your Vercel login; one-time)

```bash
npx vercel login
npx vercel link          # create a new project named "rootline"; accept the detected Next.js settings
```

## 2. Add the environment variables

Values come from your `.env.local`; this loop reads them without printing them. **Use these model IDs**, because the NVIDIA account that was tested could call these but gets `404 Function not found` for `nemotron-nano-3-30b-a3b` and `nemotron-3-super-120b-a12b`:

```bash
set -a; source .env.local; set +a

# model IDs verified callable with your NVIDIA key (override whatever is in .env.local)
export MODEL_NANO=nvidia/nemotron-3.5-lightning-30b-a3b
export MODEL_SUPER=nvidia/nemotron-3.5-super-vl-120b-a12b
export MODEL_ULTRA=nvidia/nemotron-3-ultra-550b-a55b
export MODEL_VISION=nvidia/nemotron-3.5-super-vl-120b-a12b
export LLM_BASE_URL=https://integrate.api.nvidia.com/v1
export DEMO_MODE=false
# keep a live run inside Vercel's 300 s function limit on NVIDIA's rate-limited free API
export MAX_CANDIDATE_PAGES=24
export MAX_PAIRS=24

for n in LLM_BASE_URL LLM_API_KEY MODEL_NANO MODEL_SUPER MODEL_ULTRA MODEL_VISION \
         TAVILY_API_KEY NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
         DEMO_MODE MAX_CANDIDATE_PAGES MAX_PAIRS; do
  printf '%s' "${!n}" | npx vercel env add "$n" production
done
```

| Variable | Value | Secret? |
|---|---|---|
| `LLM_BASE_URL` | `https://integrate.api.nvidia.com/v1` | no |
| `LLM_API_KEY` | your `nvapi-…` key | **yes** |
| `MODEL_NANO` | `nvidia/nemotron-3.5-lightning-30b-a3b` | no |
| `MODEL_SUPER` | `nvidia/nemotron-3.5-super-vl-120b-a12b` | no |
| `MODEL_ULTRA` | `nvidia/nemotron-3-ultra-550b-a55b` | no |
| `MODEL_VISION` | `nvidia/nemotron-3.5-super-vl-120b-a12b` | no |
| `TAVILY_API_KEY` | your `tvly-…` key | **yes** |
| `NEXT_PUBLIC_SUPABASE_URL` | your project URL | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key | public by design |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key | **yes** (never expose client-side; Rootline only uses it in server routes) |
| `DEMO_MODE` | `false` | no |
| `MAX_CANDIDATE_PAGES` | `24` | no |
| `MAX_PAIRS` | `24` | no |

Do **not** set `OFFLINE_MOCK` or `DEV_CACHE` (the dev cache is ignored on Vercel anyway). `LLM_RPM` defaults to 35 on the NVIDIA API; set it only to change that.

## 3. Deploy

```bash
npx vercel --prod
```

## 4. Smoke test the deployment

```bash
URL=https://<your-deployment>.vercel.app
curl -s $URL/api/status | python3 -m json.tool    # expect llmProvider "nvidia", search true, llm.* true, storage "supabase"
```

In the browser: open an example chip (replay), then paste a rumor and trace it live (allow 2–4 minutes at NVIDIA's rate limit), then **Copy share link** and open it in a private window (loads from Supabase), then **Add to Watchlist** and re-run it from `/watchlist`.

## 5. Known limits of this test deployment

- NVIDIA's free API is rate limited (~40 requests/min); Rootline throttles to 35/min, so a live trace takes longer than it would on Nebius. If a run hits Vercel's time limit you will see an error message, not a blank screen; lower `MAX_CANDIDATE_PAGES`.
- Voice notes need `ASR_ENDPOINT_URL` (NVIDIA's speech models use Riva gRPC, which Rootline doesn't speak); everything else works.
- The Tesseract OCR fallback downloads its English model on first use (needs outbound network; cached in `/tmp`).
- No auth: anyone with the URL can use your credits and see the shared Watchlist. Don't publish the URL widely.
