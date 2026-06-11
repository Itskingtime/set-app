// /api/send-reminders — invoked daily by Vercel Cron (see vercel.json).
// Per subscribed user, reads their prefs from user_metadata:
//   reminder_days (default 3) — nudge if they haven't trained in this many days
//   weekly_recap (default false) — on Sundays, send a recap instead of a nudge
// Needs: SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET.

const webpush = require('web-push');

const SB = 'https://xfvpijvpfmgstmevkhey.supabase.co';
const DEFAULT_DAYS = 3;

module.exports = async (req, res) => {
  // Require CRON_SECRET so ONLY Vercel Cron can trigger mass push sends.
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

  let sent = 0, cleaned = 0;
  async function pushTo(s, payload) {
    try { await webpush.sendNotification(s.subscription, JSON.stringify(payload)); sent++; }
    catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {   // expired subscription
        await fetch(`${SB}/rest/v1/push_subscriptions?id=eq.${s.id}`, { method: 'DELETE', headers: h }).catch(() => {});
        cleaned++;
      }
    }
  }

  try {
    const subs = await (await fetch(`${SB}/rest/v1/push_subscriptions?select=*`, { headers: h })).json();
    const isSunday = new Date().getUTCDay() === 0;

    for (const s of (subs || [])) {
      // per-user prefs from metadata (best-effort; fall back to defaults)
      let days = DEFAULT_DAYS, recap = false;
      try {
        const u = await (await fetch(`${SB}/auth/v1/admin/users/${s.user_id}`, { headers: h })).json();
        const m = (u && u.user_metadata) || {};
        const d = parseInt(m.reminder_days, 10);
        if (d) days = Math.max(1, Math.min(14, d));
        recap = m.weekly_recap === true;
      } catch (e) {}

      // Weekly recap on Sundays takes precedence over the nudge
      if (recap && isSunday) {
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        let sessions = 0;
        try {
          const wk = await (await fetch(`${SB}/rest/v1/workouts?user_id=eq.${s.user_id}&date=gte.${weekAgo}&select=date`, { headers: h })).json();
          sessions = new Set((wk || []).map(r => r.date)).size;
        } catch (e) {}
        await pushTo(s, {
          title: 'Your week on SaySet 📊',
          body: sessions
            ? `${sessions} session${sessions > 1 ? 's' : ''} this week — ${sessions >= 3 ? 'strong work, keep it rolling.' : "let's push for more next week."}`
            : 'No sessions logged this week — fresh start tomorrow? 💪',
          url: 'https://sayset.fit?tab=progress',
        });
        continue;
      }

      // Inactivity nudge using the user's own threshold
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const w = await (await fetch(`${SB}/rest/v1/workouts?user_id=eq.${s.user_id}&select=date&order=date.desc&limit=1`, { headers: h })).json();
      const last = (w[0] && w[0].date) || '0000-00-00';
      if (last >= cutoff) continue;   // trained recently — skip

      await pushTo(s, {
        title: 'Time to train 💪',
        body: `You haven't logged a workout in ${days}+ days — tap to log one.`,
        url: 'https://sayset.fit',
      });
    }

    res.status(200).json({ checked: (subs || []).length, sent, cleaned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
