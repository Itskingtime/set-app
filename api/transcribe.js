// /api/transcribe — proxies audio to Groq Whisper.
// The GROQ_API_KEY lives in a Vercel environment variable, never in the browser.
// Client sends JSON: { audio: <base64>, mime: "audio/webm" }  →  returns { text }

const { logUsage } = require('./_usage');
const { gateVoice } = require('./_ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { audio, mime } = body;
    const language = typeof body.language === 'string' ? body.language.slice(0, 8) : '';
    if (!audio) { res.status(400).json({ error: 'No audio provided' }); return; }
    if (typeof audio !== 'string' || audio.length > 8000000) { res.status(413).json({ error: 'Audio too large' }); return; }   // ~6 MB cap

    const key = process.env.GROQ_API_KEY;
    if (!key) { res.status(500).json({ error: 'GROQ_API_KEY not set on the server' }); return; }

    // require a valid session + enforce a generous daily cap (anti cost-abuse)
    const gate = await gateVoice(body.access_token);
    if (!gate.ok) { res.status(gate.status).json({ error: gate.error }); return; }

    const buffer = Buffer.from(audio, 'base64');
    const type = mime || 'audio/webm';
    const ext  = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';

    const fd = new FormData();                                   // global in Node 18+
    fd.append('file', new Blob([buffer], { type }), `recording.${ext}`);
    fd.append('model', 'whisper-large-v3');
    if (/^[a-z]{2}$/.test(language)) fd.append('language', language);   // ISO-639-1 hint; omitted = auto-detect

    const groq = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });

    const data = await groq.json();
    if (!groq.ok) { res.status(groq.status).json({ error: data.error?.message || 'Groq error', detail: data }); return; }

    await logUsage({ uid: gate.uid, endpoint: '/api/transcribe', model: 'whisper-large-v3' });
    res.status(200).json({ text: data.text || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
