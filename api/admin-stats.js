// /api/admin-stats — owner-only analytics overview.
// Verifies the caller's access_token and that they are the owner (ADMIN_EMAIL),
// then returns the aggregated get_admin_overview() JSON (users, spend, tokens).

const SB = process.env.SUPABASE_URL || 'https://xfvpijvpfmgstmevkhey.supabase.co';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'vedantmalik2009@gmail.com').toLowerCase();

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body  = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const token = body.access_token;

    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SERVICE) { res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set on the server' }); return; }
    if (!token)   { res.status(401).json({ error: 'Not signed in' }); return; }

    // verify the caller and confirm they are the owner
    const uRes = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SERVICE } });
    if (!uRes.ok) { res.status(401).json({ error: 'Invalid or expired session' }); return; }
    const user = await uRes.json();
    if (!user || (user.email || '').toLowerCase() !== ADMIN_EMAIL) {
      res.status(403).json({ error: 'Admin only' });
      return;
    }

    // pull the aggregated overview (service role; SECURITY DEFINER reads auth.users)
    const rRes = await fetch(`${SB}/rest/v1/rpc/get_admin_overview`, {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await rRes.json();
    if (!rRes.ok) { res.status(rRes.status).json({ error: 'Stats query failed', detail: data }); return; }

    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
