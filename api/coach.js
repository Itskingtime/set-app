// /api/coach — short AI training insight via OpenRouter (DeepSeek V4 Pro).
// Client sends { summary } (a compact text digest of recent workouts) → { insight }

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const summary = (body.summary || '').slice(0, 6000);
    if (!summary) { res.status(400).json({ error: 'No summary provided' }); return; }

    const key = process.env.OPENROUTER_API_KEY;
    if (!key) { res.status(500).json({ error: 'OPENROUTER_API_KEY not set on the server' }); return; }

    const prompt = `You are a concise, encouraging strength coach. Here is a user's recent training data:

${summary}

Give a SHORT weekly insight (2-4 sentences, plain text, no markdown, no headers). Mention one concrete positive (a PR, rising volume, or consistency) and one specific actionable suggestion (e.g. a neglected muscle group or training frequency). Be specific to the data shown. Do not invent numbers.`;

    const or = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://sayset.fit', 'X-Title': 'SaySet' },
      body: JSON.stringify({ model: 'deepseek/deepseek-v4-pro', messages: [{ role: 'user', content: prompt }], temperature: 0.5, max_tokens: 220 }),
    });
    const data = await or.json();
    if (!or.ok) { res.status(or.status).json({ error: data.error?.message || 'OpenRouter error' }); return; }
    res.status(200).json({ insight: (data.choices?.[0]?.message?.content || '').trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
