// /api/delete-account — permanently deletes the caller's account + all their data.
// Requires SUPABASE_SERVICE_ROLE_KEY (server-only secret). The client sends its
// access_token; we verify it, wipe the user's rows, then delete the auth user.

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body  = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const token = body.access_token;
    if (!token) { res.status(400).json({ error: 'No access token provided' }); return; }

    const SB      = process.env.SUPABASE_URL || 'https://xfvpijvpfmgstmevkhey.supabase.co';
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SERVICE) { res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set on the server' }); return; }

    // 1. verify the caller's token → resolve their user id
    const uRes = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SERVICE } });
    if (!uRes.ok) { res.status(401).json({ error: 'Invalid or expired session' }); return; }
    const user = await uRes.json();
    const uid = user && user.id;
    if (!uid) { res.status(401).json({ error: 'Could not identify user' }); return; }

    // 2. delete their data (service role bypasses RLS)
    const h = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
    for (const table of ['workouts', 'bodyweight_log', 'routines']) {
      await fetch(`${SB}/rest/v1/${table}?user_id=eq.${uid}`, { method: 'DELETE', headers: h }).catch(() => {});
    }

    // 3. delete the auth user
    const dRes = await fetch(`${SB}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: h });
    if (!dRes.ok) { res.status(dRes.status).json({ error: 'Failed to delete account: ' + (await dRes.text()) }); return; }

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
