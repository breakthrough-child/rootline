# Progress

_Last updated: 2026-10-27_

## Status by tier

| Tier | Scope | Status |
|---|---|---|
| 1 · Core | text → pipeline (A–G) → animated tree → summary → reply card → routing panel → demo replay → deploy | **Code complete, tested offline.** Live run pending API keys. Deploy pending your Vercel login. |
| 2 · Screenshots | upload / drag-drop / clipboard paste, VLM or OCR path, "Does this post exist?" | **Code complete.** OCR path tested; VLM path needs `MODEL_VISION`. |
| 3 · Voice notes | ASR interface, transcript review with clickable timestamps, cleanup + translation | **Code complete.** Needs `MODEL_ASR` or `ASR_ENDPOINT_URL`. No recording bundled for fixture 4 (see below). |
| 4 · PDF + DOCX | text layer, scanned PDF → vision/OCR, "Is this official?", claim selection, doc viewer | **Code complete, parsers tested.** |
| 5 · Watchlist + share pages | `/watchlist`, re-run with "new since last run", `/r/[id]` | **Code complete.** Supabase or local-JSON fallback. |
| 6 · Video | ffmpeg audio → ASR, keyframes → vision/OCR, merge | **Code complete.** Not yet exercised end-to-end on a real video. |
| 7 · XLSX + PPTX | SheetJS labeled cells + notes, OOXML slides + speaker notes | **Code complete, parsers tested.** |

## Verified in this build

- `npm run lint`, `npm run typecheck`, `npm test` (47 tests, incl. a real OCR pass on a scanned PDF) and `npm run build` all pass.
- In a running dev server (`OFFLINE_MOCK=true`): `/api/run` (text), `/api/extract` (PDF and screenshot via Tesseract OCR), `/r/[id]` share page, Watchlist add + re-run. Browser-checked: replay of all example chips, tree, node panel (desktop side panel + mobile bottom sheet at 375 px), dark and light modes, no horizontal scroll on mobile.
- Not verified: anything that needs real API keys (Nemotron calls, Tavily, vision, ASR), the video adapter on a real clip, Supabase storage, Vercel deployment.

## Blocked on you

- **API keys**: `NEBIUS_API_KEY`, `TAVILY_API_KEY` (+ verify `MODEL_*` with `npm run models`). Until then, fixtures were generated with `OFFLINE_MOCK` against a fictional corpus and are labelled as such in the UI. Regenerate with `npm run fixtures` once keys are set.
- **Vercel deploy** and **GitHub repo creation** need your login (commands in README / final summary).
- **Voice-note fixture**: no TTS was available in the build environment, so fixture 4 uses the transcript text. Record a short clip of yourself (or a clearly synthetic voice) reading `fixtures/files/voice-note-transcript.txt` and save it as `fixtures/files/voice-note.ogg`.

## Cut / deferred

- Supabase magic-link auth (Watchlist is shared per deployment).
- Nebius Serverless deployment of Parakeet NIM was documented, not performed (needs NGC + Nebius accounts).
- Media processing on a Nebius job for long videos (Vercel function limits apply; ≤3 min videos only).
