# ARPO — Architecture (v9)

## What is REAL today ✅
- **Landing page** (`index.html`) — spec copy, interactive demo (IndexedDB file handoff → app).
- **Dashboard** (`app.html`) — sidebar (Home/Projects/Create/Templates/Exports/Settings), project cards with search/filter, exports history. Projects stored in browser localStorage (per-device).
- **AI edit plans** (`/api/plan`) — Pollinations key → server key → scripted fallback. Never faked: UI shows which engine answered.
- **Browser editor** — timeline (trim/split/remove/reorder/captions/speed/rotate), 8 templates, AI thumbnail (free), 4K export via FFmpeg.wasm. 100% real, client-side.
- **☁ Cloud Render (`/api/render`) — REAL server-side FFmpeg.** Runtime-downloaded static ffmpeg (~30MB, cached in /tmp), executes: multi-segment cuts, aspect crop (9:16/1:1), SRT caption burn (DejaVu via jsDelivr, fontconfig fallback), speed, mute. Output uploaded (tmpfiles.org, anonymous) → returns page + direct preview URL. Stage timings returned; descriptive stages in UI (no fake %).
- **n8n webhooks** — `render_completed` / `render_failed` POST to `N8N_WEBHOOK_URL` if set. Fire-and-forget, 5s timeout.
- **Auth UI** — login/signup modal; activates with Supabase env vars.

## Honest limits ⚠️
- Cloud render: Vercel hobby `maxDuration: 60s` → best for clips **under ~60s**. Cold start downloads ffmpeg (~10-20s once, then cached).
- Vercel request body limit (4.5MB) → video goes browser→tmpfiles→server, never through the function body.
- tmpfiles.org links are **temporary** — preview/download soon. Swap `tmpUpload()`/`resolveDirect()` for S3/Supabase/Blob later (one place).
- Projects/exports live in **localStorage** (this browser only) until the database lands.

## What needs owner setup 🔑
| Need | Env vars | Unlocks |
|---|---|---|
| Supabase project (free) | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Real auth (signup/login/Google/reset), Postgres (users/projects/versions/jobs), storage |
| AI key (optional) | `AI_API_KEY` | Stronger plans (OpenAI-compatible) |
| n8n (optional) | `N8N_WEBHOOK_URL` | Automation events |
| Payments (later) | Stripe keys | Pro/Business billing, credits |

## API map
- `POST /api/plan` — natural language → edit plan {cuts, aspect, captions, speed}
- `POST /api/render` — {inputUrl, ops} → {url, previewUrl, sizeBytes, stages}
- `GET /api/config` — public config (Supabase URL/anon only; never secrets)
- `POST /api/aivideo` — text→video (paid Pollinations models; armed, needs key)

## Roadmap (no rebuild needed)
1. Supabase → move projects/exports/jobs to Postgres; add RLS.
2. Vercel Blob/Supabase Storage → replace tmpfiles in `tmpUpload()`.
3. Queue (e.g. Inngest/QStash) → `/api/render` becomes a worker; add SSE status.
4. Stripe → credits + plans (server-side metering).
5. Admin → reads the same Postgres.
