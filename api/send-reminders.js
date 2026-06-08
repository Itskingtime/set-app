// /api/send-reminders — invoked daily by Vercel Cron (see vercel.json).
// Sends a web-push reminder to any subscribed user who hasn't logged a workout
// in the last 3 days. Needs: SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY (Vercel env vars). Optional CRON_SECRET to lock the endpoint.

const webpush = require('web-push');

const SB = 'https://xfvpijvpfmgstmevkhey.supabase.co';
const INACTIVE_DAYS = 3;

module.exports = async (req, res) => {
  // Require CRON_SECRET so ONLY Vercel Cron can trigger mass push sends.
  // Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` on cron
  // invocations once the env var is set — so this fails closed to the public.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const PUB = process.env.VAPID_PUBLIC_KEY;
  const PRIV = process.env.VAPID_PRIVATE_KEY;
  if (!SERVICE || !PUB || !PRIV) { res.status(500).json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY / VAPID keys' }); return; }

  webpush.setVapidDetails('mailto:dyspro16250@gmail.com', PUB, PRIV);
  const h = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };

  try {
    const subs = await (await fetch(`${SB}/rest/v1/push_subscriptions?select=*`, { headers: h })).json();
    const cutoff = new Date(Date.now() - INACTIVE_DAYS * 86400000).toISOString().slice(0, 10);
    let sent = 0, cleaned = 0;

    for (const s of (subs || [])) {
      const w = await (await fetch(`${SB}/rest/v1/workouts?user_id=eq.${s.user_id}&select=date&order=date.desc&limit=1`, { headers: h })).json();
      const last = (w[0] && w[0].date) || '0000-00-00';
      if (last >= cutoff) continue;   // trained recently — skip

      try {
        await webpush.sendNotification(s.subscription, JSON.stringify({
          title: 'Time to train 💪',
          body: "You haven't logged a workout in a few days — tap to log one.",
          url: 'https://sayset.fit',
        }));
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {   // expired subscription
          await fetch(`${SB}/rest/v1/push_subscriptions?id=eq.${s.id}`, { method: 'DELETE', headers: h }).catch(() => {});
          cleaned++;
        }
      }
    }
    res.status(200).json({ checked: (subs || []).length, sent, cleaned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
