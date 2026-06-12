// /api/parse — turns a transcript into structured exercises via OpenRouter (DeepSeek V4 Pro).
// The OPENROUTER_API_KEY lives in a Vercel environment variable, never in the browser.
// Client sends JSON: { transcript: "..." }  →  returns { exercises: [...] }

const CATALOG = require('./_exercises');                       // [{id,name,category}] x400
const CATALOG_TEXT = CATALOG.map(e => `${e.id}\t${e.name}`).join('\n');
const VALID_IDS = new Set(CATALOG.map(e => e.id));
const { logUsage } = require('./_usage');
const { gateVoice } = require('./_ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const transcript = (body.transcript || '').slice(0, 2000).trim();   // cap input size (cost guard)
    if (!transcript) { res.status(400).json({ error: 'No transcript provided' }); return; }

    const key = process.env.OPENROUTER_API_KEY;
    if (!key) { res.status(500).json({ error: 'OPENROUTER_API_KEY not set on the server' }); return; }

    // require a valid session + enforce a generous daily cap (anti cost-abuse)
    const gate = await gateVoice(body.access_token);
    if (!gate.ok) { res.status(gate.status).json({ error: gate.error }); return; }

    const prompt = `You are a fitness workout parser and exercise expert.

The user said: "${transcript}"

Extract every exercise. Return ONLY raw JSON, no markdown:
{"exercises":[{"exercise_id":"CHEST_001","name":"Exercise Name","kind":"strength","muscle":"chest","sets":3,"reps":10,"weight_kg":80,"duration_min":null,"distance_km":null}]}

Fields:
- exercise_id: the EXACT id from the EXERCISE CATALOG below that best matches the movement the user performed (e.g. "incline dumbbell press" → the incline dumbbell press entry; "bench" → flat barbell bench press). Pick the most specific correct match. Use null ONLY if no catalog entry reasonably matches.
- name: if exercise_id is set, copy that catalog entry's EXACT name; otherwise use the normalized spoken name.
- kind: "strength" (external weight), "bodyweight" (push-ups, pull-ups, planks, dips), or "cardio" (running, cycling, rowing, swimming, walking, etc.)
- muscle: exactly one of chest, back, legs, shoulders, arms, core, neck, cardio, other. Use "cardio" for cardio.
- sets, reps: integers, or null if not mentioned.
- weight_kg: number, or null (always null for bodyweight and cardio). Convert lbs to kg (divide by 2.205, round 1 decimal).
- duration_min: minutes for cardio or timed work (e.g. plank 60s = 1), else null.
- distance_km: kilometers for cardio with a distance, else null. Convert miles (×1.609).

Rules:
- Always try to set exercise_id from the catalog; null is a last resort.
- Empty array if nothing fitness-related.

EXERCISE CATALOG (id<TAB>name):
${CATALOG_TEXT}`;

    const or = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://sayset.fit',
        'X-Title': 'SaySet',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        usage: { include: true },
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

    // only trust ids that actually exist in the catalog
    exercises = (exercises || [])
      .filter(e => e && typeof e === 'object')
      .map(e => ({ ...e, exercise_id: VALID_IDS.has(e.exercise_id) ? e.exercise_id : null }));

    const u = data.usage || {};
    await logUsage({ uid: gate.uid, endpoint: '/api/parse', model: 'deepseek/deepseek-v4-pro', tokensIn: u.prompt_tokens, tokensOut: u.completion_tokens, costUsd: u.cost });
    res.status(200).json({ exercises });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
