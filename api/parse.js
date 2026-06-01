// /api/parse — turns a transcript into structured exercises via OpenRouter (DeepSeek V4 Pro).
// The OPENROUTER_API_KEY lives in a Vercel environment variable, never in the browser.
// Client sends JSON: { transcript: "..." }  →  returns { exercises: [...] }

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const transcript = (body.transcript || '').trim();
    if (!transcript) { res.status(400).json({ error: 'No transcript provided' }); return; }

    const key = process.env.OPENROUTER_API_KEY;
    if (!key) { res.status(500).json({ error: 'OPENROUTER_API_KEY not set on the server' }); return; }

    const prompt = `You are a fitness workout parser and exercise expert.

The user said: "${transcript}"

Extract every exercise. Return ONLY raw JSON, no markdown:
{"exercises":[{"name":"Exercise Name","kind":"strength","muscle":"chest","sets":3,"reps":10,"weight_kg":80,"duration_min":null,"distance_km":null}]}

Fields:
- kind: "strength" (uses external weight), "bodyweight" (push-ups, pull-ups, planks, dips — no added weight), or "cardio" (running, cycling, rowing, swimming, walking, elliptical, etc.)
- muscle: exactly one of chest, back, legs, shoulders, arms, core, neck, cardio, other. Use "cardio" for cardio.
- sets, reps: integers, or null if not mentioned.
- weight_kg: number, or null (always null for bodyweight and cardio). Convert lbs to kg (divide by 2.205, round 1 decimal).
- duration_min: minutes for cardio or timed work (e.g. plank 60s = 1), else null.
- distance_km: kilometers for cardio with a distance, else null. Convert miles (×1.609).

Rules:
- Normalize names (bench -> Bench Press, ohp -> Overhead Press, rdl -> Romanian Deadlift).
- Empty array if nothing fitness-related.`;

    const or = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://set-app.vercel.app',
        'X-Title': 'Set',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4-pro',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
    });

    const data = await or.json();
    if (!or.ok) { res.status(or.status).json({ error: data.error?.message || 'OpenRouter error', detail: data }); return; }

    const raw = (data.choices?.[0]?.message?.content ?? '').replace(/```json|```/g, '').trim();
    let exercises = [];
    try {
      exercises = JSON.parse(raw).exercises ?? [];
    } catch (_) {
      // DeepSeek may wrap the JSON in prose — grab the first {...} block
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { exercises = JSON.parse(m[0]).exercises ?? []; } catch (_) {} }
    }

    res.status(200).json({ exercises });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
