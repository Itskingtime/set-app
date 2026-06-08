// /api/coach — short, personalised AI training insight via OpenRouter (DeepSeek V4 Flash).
// Client sends { summary, profile, access_token } → { insight, remaining }.
// Rate-limited to 5 AI insights per user per day (shared pool with /api/ask).

const { gateAI, refundAI } = require('./_ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body    = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const summary = (body.summary || '').slice(0, 6000);
    const profile = (body.profile || '').slice(0, 400);
    if (!summary) { res.status(400).json({ error: 'No summary provided' }); return; }

    const key = process.env.OPENROUTER_API_KEY;
    if (!key) { res.status(500).json({ error: 'OPENROUTER_API_KEY not set on the server' }); return; }

    // auth + daily quota (shared pool with /api/ask)
    const gate = await gateAI(body.access_token);
    if (!gate.ok) { res.status(gate.status).json({ error: gate.error }); return; }

    const prompt = `You are a sharp, encouraging personal strength & fitness coach analysing ONE user.

BODY STATS: ${profile || 'not provided'}
RECENT TRAINING (newest first):
${summary}

Write a personalised weekly insight in 100 WORDS OR FEWER (plain text, no markdown, no headings). Reference the user's real numbers, progress, consistency and body stats where relevant. Call out one concrete positive (a PR, rising volume, or a streak) and one specific, actionable suggestion (a neglected muscle group, training frequency, or a body-composition pointer). Never invent data that isn't shown.`;

    let or, data;
    try {
      or = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://sayset.fit', 'X-Title': 'SaySet' },
        body: JSON.stringify({ model: 'deepseek/deepseek-v4-flash', messages: [{ role: 'user', content: prompt }], temperature: 0.5, max_tokens: 260 }),
      });
      data = await or.json();
    } catch (e) {
      await refundAI(gate.uid, gate.day);
      res.status(502).json({ error: 'Coach service unavailable — please try again.' });
      return;
    }

    if (!or.ok) {
      await refundAI(gate.uid, gate.day);
      res.status(or.status).json({ error: data.error?.message || 'OpenRouter error' });
      return;
    }
    const insight = (data.choices?.[0]?.message?.content || '').trim();
    if (!insight) {
      await refundAI(gate.uid, gate.day);
      res.status(502).json({ error: 'The coach had nothing to add — please try again.' });
      return;
    }
    res.status(200).json({ insight, remaining: gate.remaining });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
