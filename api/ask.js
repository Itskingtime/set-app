// /api/ask — answer a natural-language question about the user's own training data.
// Client sends { question, summary, profile, access_token } → { answer, remaining }.
// Rate-limited to 5 AI insights per user per day (shared pool with /api/coach).

const { gateAI, refundAI } = require('./_ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body     = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const question = (body.question || '').slice(0, 400).trim();
    const summary  = (body.summary || '').slice(0, 6000);
    const profile  = (body.profile || '').slice(0, 400);
    if (!question) { res.status(400).json({ error: 'No question provided' }); return; }

    const key = process.env.OPENROUTER_API_KEY;
    if (!key) { res.status(500).json({ error: 'OPENROUTER_API_KEY not set on the server' }); return; }

    // auth + daily quota (shared pool with /api/coach)
    const gate = await gateAI(body.access_token);
    if (!gate.ok) { res.status(gate.status).json({ error: gate.error }); return; }

    const prompt = `You answer questions about a user's OWN fitness data. Use ONLY the data below; if the answer isn't in it, say so briefly — never make things up.

BODY STATS: ${profile || 'not provided'}
TRAINING DATA (newest first):
${summary}

QUESTION: ${question}

Answer in 100 WORDS OR FEWER, plain text (no markdown). Include specific numbers, weights, reps and dates from the data when relevant.`;

    let or, data;
    try {
      or = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://sayset.fit', 'X-Title': 'SaySet' },
        body: JSON.stringify({ model: 'deepseek/deepseek-v4-flash', messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 260 }),
      });
      data = await or.json();
    } catch (e) {
      await refundAI(gate.uid, gate.day);
      res.status(502).json({ error: 'Answer service unavailable — please try again.' });
      return;
    }

    if (!or.ok) {
      await refundAI(gate.uid, gate.day);
      res.status(or.status).json({ error: data.error?.message || 'OpenRouter error' });
      return;
    }
    const answer = (data.choices?.[0]?.message?.content || '').trim();
    if (!answer) {
      await refundAI(gate.uid, gate.day);
      res.status(502).json({ error: 'No answer came back — please try again.' });
      return;
    }
    res.status(200).json({ answer, remaining: gate.remaining });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
