// /api/voicelog — one round-trip voice log: transcribe (Groq Whisper) + parse
// (OpenRouter DeepSeek flash, exact-match exercise_id from the 400-catalog), done
// server-side next to the APIs to save a client↔Vercel round-trip. Requires a valid
// session + the shared voice daily cap (counts as ONE op for the whole log).
// Client sends { audio, mime, language?, access_token } → { transcript, exercises }.

const CATALOG = require('./_exercises');
const CATALOG_TEXT = CATALOG.map(e => `${e.id}\t${e.name}`).join('\n');
const VALID_IDS = new Set(CATALOG.map(e => e.id));
const { logUsage } = require('./_usage');
const { gateVoice } = require('./_ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const audio = body.audio;
    const language = typeof body.language === 'string' ? body.language.slice(0, 8) : '';
    if (!audio) { res.status(400).json({ error: 'No audio provided' }); return; }
    if (typeof audio !== 'string' || audio.length > 8000000) { res.status(413).json({ error: 'Audio too large' }); return; }

    const GROQ = process.env.GROQ_API_KEY;
    const OR = process.env.OPENROUTER_API_KEY;
    if (!GROQ || !OR) { res.status(500).json({ error: 'Server not configured' }); return; }

    // one auth + cap check for the whole voice log (was two: transcribe + parse)
    const gate = await gateVoice(body.access_token);
    if (!gate.ok) { res.status(gate.status).json({ error: gate.error }); return; }

    // 1) transcribe via Groq Whisper
    const buffer = Buffer.from(audio, 'base64');
    const type = body.mime || 'audio/webm';
    const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
    const fd = new FormData();
    fd.append('file', new Blob([buffer], { type }), `recording.${ext}`);
    fd.append('model', 'whisper-large-v3');
    if (/^[a-z]{2}$/.test(language)) fd.append('language', language);
    const gr = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${GROQ}` }, body: fd,
    });
    const gd = await gr.json();
    if (!gr.ok) { res.status(gr.status).json({ error: gd.error?.message || 'Transcription failed' }); return; }
    const transcript = (gd.text || '').slice(0, 2000).trim();
    if (!transcript) { res.status(200).json({ transcript: '', exercises: [] }); return; }

    // 2) parse via OpenRouter (flash + catalog for exact exercise_id)
    const prompt = `You are a fitness workout parser and exercise expert.

The user said: "${transcript}"

Extract every exercise. Return ONLY raw JSON, no markdown:
{"exercises":[{"exercise_id":"CHEST_001","name":"Exercise Name","kind":"strength","muscle":"chest","sets":3,"reps":10,"weight_kg":80,"duration_min":null,"distance_km":null}]}

Fields:
- exercise_id: the EXACT id from the EXERCISE CATALOG below that best matches the movement (e.g. "incline dumbbell press" → that entry; "bench" → flat barbell bench press). Pick the most specific correct match. Use null ONLY if no catalog entry reasonably matches.
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
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OR}`, 'HTTP-Referer': 'https://sayset.fit', 'X-Title': 'SaySet' },
      body: JSON.stringify({ model: 'deepseek/deepseek-v4-flash', messages: [{ role: 'user', content: prompt }], temperature: 0.1, usage: { include: true } }),
    });
    const data = await or.json();
    if (!or.ok) { res.status(or.status).json({ error: data.error?.message || 'Parse failed', transcript }); return; }

    const rawText = (data.choices?.[0]?.message?.content ?? '').replace(/```json|```/g, '').trim();
    let exercises = [];
    try { exercises = JSON.parse(rawText).exercises ?? []; }
    catch (_) { const m = rawText.match(/\{[\s\S]*\}/); if (m) { try { exercises = JSON.parse(m[0]).exercises ?? []; } catch (_) {} } }
    exercises = (exercises || [])
      .filter(e => e && typeof e === 'object')
      .map(e => ({ ...e, exercise_id: VALID_IDS.has(e.exercise_id) ? e.exercise_id : null }));

    const u = data.usage || {};
    await logUsage({ uid: gate.uid, endpoint: '/api/voicelog', model: 'deepseek/deepseek-v4-flash', tokensIn: u.prompt_tokens, tokensOut: u.completion_tokens, costUsd: u.cost });

    res.status(200).json({ transcript, exercises });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
