// /api/signup — rate-limited email/password sign-up proxy.
// Caps NEW accounts per client IP per day, then performs the GoTrue sign-up
// server-side so the cap can't be bypassed from the browser. Login still goes
// directly through supabase-js; this only fronts email/password sign-up.
// (Google OAuth sign-ups are redirect-based and covered by Supabase's own limits.)

const SB = process.env.SUPABASE_URL || 'https://xfvpijvpfmgstmevkhey.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmdnBpanZwZm1nc3RtZXZraGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNDMxNTksImV4cCI6MjA5NTgxOTE1OX0.pGSupt1Bq2Ao72m-f9YAm0oITZOxN31LkugcwEwACko';
const DAILY_SIGNUP_LIMIT = 5;   // new accounts allowed per IP per UTC day

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    // input validation (before counting, so typos don't burn the IP's quota)
    if (!email || !password) { res.status(400).json({ error: 'Email and password are required.' }); return; }
    if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { res.status(400).json({ error: 'Enter a valid email address.' }); return; }
    if (password.length < 8 || password.length > 200) { res.status(400).json({ error: 'Password must be at least 8 characters.' }); return; }

    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // per-IP daily cap — fails OPEN if the migration hasn't been run yet,
    // so a missing RPC can never block legitimate sign-ups.
    if (SERVICE) {
      const ip = clientIp(req);
      const day = new Date().toISOString().slice(0, 10);
      try {
        const rl = await fetch(`${SB}/rest/v1/rpc/bump_signup_usage`, {
          method: 'POST',
          headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_ip: ip, p_day: day, p_limit: DAILY_SIGNUP_LIMIT }),
        });
        if (rl.ok) {
          const n = await rl.json();
          if (n === -1) { res.status(429).json({ error: 'Too many sign-ups from your network today — please try again tomorrow.' }); return; }
        }
      } catch (e) { /* fail open: never block sign-up on a limiter error */ }
    }

    // perform the actual sign-up via GoTrue (same call the browser would make)
    const su = await fetch(`${SB}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await su.json();
    if (!su.ok) { res.status(su.status).json({ error: data.error_description || data.msg || data.error || 'Sign-up failed.' }); return; }

    // confirmation OFF → flat session fields; confirmation ON → user only (no tokens)
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
