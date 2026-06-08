// /api/_ratelimit — shared per-user daily quota for the AI features (coach + ask).
// Verifies the caller's Supabase access token, then atomically reserves one of
// their 5 daily slots via the bump_ai_usage RPC (callable by the service role only).
// coach + ask draw from the SAME pool, so it's 5 total AI insights per user per day.

const SB = process.env.SUPABASE_URL || 'https://xfvpijvpfmgstmevkhey.supabase.co';
const DAILY_LIMIT = 5;

function svcHeaders(service) {
  return { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' };
}

function utcDay() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Returns { ok:true, uid, day, used, remaining } when a slot is reserved,
// or { ok:false, status, error } to send straight back to the client.
async function gateAI(token) {
  if (!token) return { ok: false, status: 401, error: 'Please sign in to use AI features.' };

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) return { ok: false, status: 500, error: 'SUPABASE_SERVICE_ROLE_KEY not set on the server' };

  // 1. verify the caller's token → user id
  const uRes = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SERVICE } });
  if (!uRes.ok) return { ok: false, status: 401, error: 'Your session has expired — please sign in again.' };
  const user = await uRes.json();
  const uid = user && user.id;
  if (!uid) return { ok: false, status: 401, error: 'Could not verify your account.' };

  // 2. atomically reserve one of today's slots
  const day = utcDay();
  const rRes = await fetch(`${SB}/rest/v1/rpc/bump_ai_usage`, {
    method: 'POST', headers: svcHeaders(SERVICE),
    body: JSON.stringify({ p_user: uid, p_day: day, p_limit: DAILY_LIMIT }),
  });
  if (!rRes.ok) return { ok: false, status: 500, error: 'Could not check your daily usage. Try again shortly.' };
  const used = await rRes.json(); // int; -1 means already at the limit

  if (used === -1) {
    return { ok: false, status: 429, error: `You've used all ${DAILY_LIMIT} AI insights for today. Check back tomorrow.` };
  }
  return { ok: true, uid, day, used, remaining: Math.max(0, DAILY_LIMIT - used) };
}

// Best-effort: hand a slot back when the downstream AI call itself fails,
// so server/model errors don't burn the user's daily quota.
async function refundAI(uid, day) {
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE || !uid || !day) return;
  await fetch(`${SB}/rest/v1/rpc/refund_ai_usage`, {
    method: 'POST', headers: svcHeaders(SERVICE),
    body: JSON.stringify({ p_user: uid, p_day: day }),
  }).catch(() => {});
}

module.exports = { gateAI, refundAI, DAILY_LIMIT };
