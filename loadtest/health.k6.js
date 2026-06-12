// SaySet load test — ramps virtual users against the AI-free /api/health target
// and flags the breaking point (where p95 latency or error rate cross the thresholds).
//
//   Local (gentle — single IP, will get edge-throttled past low VUs):
//     k6 run -e BASE_URL=https://<your-preview>.vercel.app loadtest/health.k6.js
//
//   Distributed / real scale (recommended — runs from many IPs so Vercel's edge
//   firewall doesn't just 403 you):
//     k6 cloud loadtest/health.k6.js        # Grafana k6 Cloud (free tier ~50 VUs)
//
// Env vars:
//   BASE_URL  target origin (default: production — prefer a PREVIEW deploy!)
//   DB        '1' (default) hits Supabase too; '0' tests pure Vercel function throughput
//   PEAK      peak VUs (default 500)

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE   = __ENV.BASE_URL || 'https://sayset.fit';
const WITHDB = (__ENV.DB || '1') === '1';
const PEAK   = parseInt(__ENV.PEAK || '500', 10);

const dbLatency = new Trend('supabase_ms', true);
const errors    = new Rate('errors');

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Math.round(PEAK * 0.04) },   // warm up
        { duration: '1m',  target: Math.round(PEAK * 0.2) },
        { duration: '1m',  target: Math.round(PEAK * 0.5) },
        { duration: '2m',  target: PEAK },                       // hold at peak
        { duration: '30s', target: 0 },                         // ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  // When ANY threshold goes red during the ramp, the VU level at that moment is your breaking point.
  thresholds: {
    http_req_failed:   ['rate<0.01'],                  // < 1% failed requests
    http_req_duration: ['p(95)<800', 'p(99)<2000'],    // latency knee
    errors:            ['rate<0.01'],
    supabase_ms:       ['p(95)<600'],                  // DB round-trip stays healthy
  },
};

export default function () {
  const url = `${BASE}/api/health${WITHDB ? '?db=1' : ''}`;
  const res = http.get(url, { tags: { name: 'health' } });

  const ok = check(res, {
    'status is 200':  (r) => r.status === 200,
    'is healthy':     (r) => { try { return r.json('ok') === true; } catch (e) { return false; } },
    'not edge-blocked': (r) => r.status !== 403 && r.status !== 429,
  });
  errors.add(!ok);

  if (res.status === 200) {
    try { const d = res.json('dbMs'); if (d != null) dbLatency.add(d); } catch (e) {}
  }
  sleep(1);   // ~1 request/VU/sec → VUs ≈ concurrent active users (real users are burstier/idler)
}

export function handleSummary(data) {
  const m = data.metrics;
  const p95  = m.http_req_duration ? m.http_req_duration.values['p(95)'] : 0;
  const fail = m.http_req_failed ? m.http_req_failed.values.rate : 0;
  const db95 = m.supabase_ms ? m.supabase_ms.values['p(95)'] : null;
  const verdict =
    fail > 0.01 ? `❌ BREAKING POINT — ${(fail * 100).toFixed(1)}% of requests failed (edge 403/429 or upstream errors).`
    : p95 > 800 ? `⚠️  STRESSED — p95 latency ${Math.round(p95)}ms exceeds 800ms target.`
    : `✅ HEALTHY at this scale — p95 ${Math.round(p95)}ms, ${(fail * 100).toFixed(2)}% errors.`;
  const lines = [
    '',
    '──────── SaySet load test ────────',
    `target:        ${BASE}/api/health${WITHDB ? '?db=1' : ''}`,
    `peak VUs:      ${PEAK}`,
    `requests:      ${m.http_reqs ? m.http_reqs.values.count : 0}`,
    `p95 latency:   ${Math.round(p95)}ms`,
    `error rate:    ${(fail * 100).toFixed(2)}%`,
    db95 != null ? `supabase p95:  ${Math.round(db95)}ms` : '',
    '',
    verdict,
    '──────────────────────────────────',
    '',
  ].filter(Boolean).join('\n');
  return { stdout: lines };
}
