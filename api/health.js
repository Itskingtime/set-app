// /api/health — safe, AI-free load-test target.
//   GET /api/health        → pure Vercel function throughput  ({ ok, ts, region, ms })
//   GET /api/health?db=1    → also runs ONE cheap, RLS-protected Supabase read and
//                             reports dbMs, so you can watch DB latency degrade under load.
// No auth, no AI, no writes, no secrets — cheap to hammer. The anon key is public-safe
// and the read is RLS-protected (anon sees no rows). Delete this file after testing if you like.

const SB = process.env.SUPABASE_URL || 'https://xfvpijvpfmgstmevkhey.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmdnBpanZwZm1nc3RtZXZraGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNDMxNTksImV4cCI6MjA5NTgxOTE1OX0.pGSupt1Bq2Ao72m-f9YAm0oITZOxN31LkugcwEwACko';

module.exports = async (req, res) => {
  const t0 = Date.now();
  res.setHeader('Cache-Control', 'no-store');   // never CDN-cache → every hit reaches the function

  const out = { ok: true, ts: new Date().toISOString(), region: process.env.VERCEL_REGION || 'unknown' };

  const wantDb = (req.query && req.query.db === '1') || /[?&]db=1/.test(req.url || '');
  if (wantDb) {
    const d0 = Date.now();
    try {
      // RLS-protected read (anon sees no rows) — exercises PostgREST → Postgres without leaking data
      const r = await fetch(`${SB}/rest/v1/workouts?select=id&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
      out.db = r.ok ? 'ok' : ('status_' + r.status);
      if (!r.ok) out.ok = false;
    } catch (e) { out.ok = false; out.db = 'error'; }
    out.dbMs = Date.now() - d0;
  }

  out.ms = Date.now() - t0;
  res.status(out.ok ? 200 : 503).json(out);
};
