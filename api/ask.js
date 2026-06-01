// /api/ask — answer a natural-language question about the user's own training data.
// Client sends { question, summary } → { answer }

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const question = (body.question || '').slice(0, 400).trim();
    const summary  = (body.summary || '').slice(0, 6000);
    if (!question) { res.status(400).json({ error: 'No question provided' }); return; }

    const key = process.env.OPENROUTER_API_KEY;
    if (!key) { res.status(500).json({ error: 'OPENROUTER_API_KEY not set on the server' }); return; }

    const prompt = `You answer questions about a user's OWN workout history. Use ONLY the data below. If the answer isn't in the data, say so briefly — don't make things up.

DATA:
${summary}

QUESTION: ${question}

Answer in 1-3 short sentences, plain text. Include specific numbers (weights, reps, dates) from the data when relevant.`;

    const or = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://sayset.vercel.app', 'X-Title': 'Set' },
      body: JSON.stringify({ model: 'deepseek/deepseek-v4-pro', messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 200 }),
    });
    const data = await or.json();
    if (!or.ok) { res.status(or.status).json({ error: data.error?.message || 'OpenRouter error' }); return; }
    res.status(200).json({ answer: (data.choices?.[0]?.message?.content || '').trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
