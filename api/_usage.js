// /api/_usage — token/cost logging for the AI endpoints.
// resolveUid: best-effort access_token → user id (never throws; null on failure).
// logUsage:   fire one row into api_usage (best-effort; never breaks the request).

const SB = process.env.SUPABASE_URL || 'https://xfvpijvpfmgstmevkhey.supabase.co';

async function resolveUid(token) {
  if (!token) return null;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) return null;
  try {
    const r = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SERVICE } });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) || null;
  } catch (e) { return null; }
}

async function logUsage({ uid, endpoint, model, tokensIn, tokensOut, costUsd }) {
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) return;
  try {
    await fetch(`${SB}/rest/v1/api_usage`, {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id:    uid || null,
        endpoint,
        model:      model || null,
        tokens_in:  (tokensIn  == null ? null : tokensIn),
        tokens_out: (tokensOut == null ? null : tokensOut),
        cost_usd:   (costUsd   == null ? null : costUsd),
      }),
    });
  } catch (e) { /* logging must never break the request */ }
}

module.exports = { resolveUid, logUsage };
