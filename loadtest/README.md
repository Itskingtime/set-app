# SaySet load-test harness

Finds the **real** concurrency ceiling without spending a cent on AI. Target is
`/api/health` (Vercel function + an optional cheap, RLS-protected Supabase read) —
**no transcription, no LLM calls, no writes.**

## ⚠️ Read first
1. **You cannot load-test from one machine.** Vercel's edge firewall `403`s a single
   flooding IP almost instantly (proven: 60 rapid requests → 60× `403`). Use a
   **distributed** runner (k6 Cloud / Loader.io) so traffic comes from many IPs.
2. **Test a Vercel *preview* deploy, not production** — `git push` to any non-`master`
   branch gives you a separate `*.vercel.app` URL. Keeps real users + your cost/usage data clean.
3. **`/api/health` is AI-free and safe to hammer.** The other endpoints (`/api/parse`,
   `/api/transcribe`, `/api/coach`, `/api/demo`) cost real money per call and are
   rate-limited — **do not point load tests at them** or you'll get a bill and just trip
   your own limits.
4. Delete `api/health.js` after you're done if you'd rather not keep a public health probe.

## What "breakdown" means
The k6 script ramps VUs 0 → PEAK and goes red when any threshold breaks:
- `http_req_failed` > **1%** — requests erroring (edge 403/429, function timeouts, or Supabase failing)
- `http_req_duration` p95 > **800ms** / p99 > **2s** — the latency knee
- `supabase_ms` p95 > **600ms** — the database round-trip degrading (your first technical wall)

The VU level where the first threshold trips ≈ your breaking point.

## Run it

### Option A — Grafana k6 Cloud (recommended, free tier ~50 VUs, real IPs)
```bash
# one-time: install k6 + sign in (https://grafana.com/products/cloud/k6/)
k6 cloud login --token <YOUR_K6_CLOUD_TOKEN>
k6 cloud -e BASE_URL=https://<your-preview>.vercel.app loadtest/health.k6.js
```

### Option B — Loader.io (free, browser UI, many IPs)
1. Add your preview domain at https://loader.io and verify it.
2. New test → GET `https://<preview>/api/health?db=1` → "Clients per second", ramp e.g. 0→500 over 1 min.

### Option C — local k6 (quick sanity only; single IP → throttled past low VUs)
```bash
# install: https://k6.io/docs/get-started/installation/   (winget install k6 / choco install k6)
k6 run -e BASE_URL=https://<preview>.vercel.app -e PEAK=50 loadtest/health.k6.js
k6 run -e BASE_URL=https://<preview>.vercel.app -e DB=0   loadtest/health.k6.js   # pure-Vercel, no DB
```

Env vars: `BASE_URL` (target), `DB` (`1` hits Supabase, `0` = Vercel only), `PEAK` (peak VUs, default 500).

## Watch these dashboards during the run (first to redline = your bottleneck)
| Layer | Dashboard | Redline signal |
|---|---|---|
| Database | Supabase → Reports / Database | CPU near 100%, connection count maxed, auth/`429` errors |
| Functions | Vercel → project → Observability / Functions | function duration climbing, `5xx` rate, concurrency cap |
| Edge | k6 output | `403`/`429` (edge firewall throttling your test source) |

## Reading the number → users
k6 sleeps ~1s/iteration, so **1 VU ≈ 1 request/sec ≈ a continuously-active user.**
Real users are bursty and mostly idle, so **1 VU ≈ ~5–20 real signed-in users**. If
`/api/health?db=1` holds at, say, 300 VUs before the Supabase p95 knee, that's roughly
**a few thousand real users** the free Supabase tier can carry — at which point you upgrade.

## The real ceiling is cost, not capacity
Even when the infra holds, the **AI bill** caps a free app first:
`~$0.0023/voice-log` + `~$0.001/coach-or-ask` ≈ **~$1.2 / daily-active-user / month**.
So ~1,000 DAU ≈ ~$1,200/mo in API costs. The per-user rate limits (5 AI/day, 400 voice/day)
exist to bound this. Plan monetization before chasing big DAU.
