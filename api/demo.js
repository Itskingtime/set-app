// /api/demo — unauthenticated "try it" endpoint for the landing page.
// Transcribes (optional) + lightly parses ONE phrase so visitors can feel the
// voice logging before signing up. Per-IP daily cap + input caps + the cheap
// flash model keep this controlled. Nothing is stored to any account.

const { logUsage } = require('./_usage');

const SB = process.env.SUPABASE_URL || 'https://xfvpijvpfmgstmevkhey.supabase.co';
const DAILY_DEMO_LIMIT = 10;   // free demo runs per IP per day

function clientIp(req) {
  const h = req.headers || {};
  let ip = h['x-real-ip'] || h['x-vercel-forwarded-for'];
  if (!ip) { const xff = h['x-forwarded-for']; if (xff) { const p = String(xff).split(','); ip = p[p.length - 1]; } }
  return String(ip || (req.socket && req.socket.remoteAddress) || 'unknown').trim().slice(0, 64);
}

async function underLimit(req) {
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) return true;                                  // fail open
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/bump_demo_usage`, {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_ip: clientIp(req), p_day: new Date().toISOString().slice(0, 10), p_limit: DAILY_DEMO_LIMIT }),
    });
    if (!r.ok) return true;                                   // fail open if RPC missing
    const n = await r.json();
    return n !== -1;
  } catch (e) { return true; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let text = (body.text || '').slice(0, 500).trim();
    const audio = body.audio;

    if (!(await underLimit(req))) {
      res.status(429).json({ error: "That's the free demo limit — create an account to keep logging." });
      return;
    }

    const GROQ = process.env.GROQ_API_KEY;
    const OR = process.env.OPENROUTER_API_KEY;
    if (!OR) { res.status(500).json({ error: 'Server not configured' }); return; }

    // 1) transcribe if audio was supplied
    if (!text && audio) {
      if (typeof audio !== 'string' || audio.length > 4000000) { res.status(413).json({ error: 'Audio too large' }); return; }
      if (!GROQ) { res.status(500).json({ error: 'Server not configured' }); return; }
      const buf = Buffer.from(audio, 'base64');
      const type = body.mime || 'audio/webm';
      const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type }), `demo.${ext}`);
      fd.append('model', 'whisper-large-v3');
      const gr = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${GROQ}` }, body: fd,
      });
      const gd = await gr.json();
      if (!gr.ok) { res.status(gr.status).json({ error: gd.error?.message || 'Transcription failed' }); return; }
      text = (gd.text || '').slice(0, 500).trim();
      await logUsage({ uid: null, endpoint: '/api/demo', model: 'whisper-large-v3' });
    }
    if (!text) { res.status(400).json({ error: 'Say or type a set to try it.' }); return; }

    // 2) light parse (no catalog → cheap)
    const prompt = `You are a fitness workout parser. The user said: "${text}"
Return ONLY raw JSON, no markdown: {"exercises":[{"name":"Exercise Name","kind":"strength","muscle":"chest","sets":3,"reps":10,"weight_kg":80,"duration_min":null,"distance_km":null}]}
- kind: "strength", "bodyweight" (push-ups, pull-ups, planks), or "cardio".
- muscle: exactly one of chest, back, legs, shoulders, arms, core, cardio, other.
- sets, reps: integers or null. weight_kg: number or null (null for bodyweight/cardio); convert lbs by /2.205.
- duration_min/distance_km for cardio (convert miles by *1.609). Empty array if nothing fitness-related.`;
    const or = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OR}`, 'HTTP-Referer': 'https://sayset.fit', 'X-Title': 'SaySet' },
      body: JSON.stringify({ model: 'deepseek/deepseek-v4-flash', messages: [{ role: 'user', content: prompt }], temperature: 0.1, usage: { include: true } }),
    });
    const data = await or.json();
    if (!or.ok) { res.status(or.status).json({ error: data.error?.message || 'Parse failed' }); return; }

    const raw = (data.choices?.[0]?.message?.content ?? '').replace(/```json|```/g, '').trim();
    let exercises = [];
    try { exercises = JSON.parse(raw).exercises ?? []; }
    catch (_) { const m = raw.match(/\{[\s\S]*\}/); if (m) { try { exercises = JSON.parse(m[0]).exercises ?? []; } catch (_) {} } }
    exercises = (exercises || []).filter(e => e && typeof e === 'object').slice(0, 6);

    const u = data.usage || {};
    await logUsage({ uid: null, endpoint: '/api/demo', model: 'deepseek/deepseek-v4-flash', tokensIn: u.prompt_tokens, tokensOut: u.completion_tokens, costUsd: u.cost });

    res.status(200).json({ transcript: text, exercises });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
