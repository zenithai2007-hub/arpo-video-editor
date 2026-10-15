/* arPo server: AI edit-plan.
   Uses Ollama Cloud if OLLAMA_API_KEY is set, otherwise free Pollinations.ai (no key, no signup).
   The app's ONE key lives only in the OLLAMA_API_KEY env var — never shown to users. */
const PLAN_SYSTEM = `You are arPo, a video edit planner. Given a user prompt and sampled video frames (with timestamps burned in), output ONLY a JSON edit plan — no prose, no markdown fences.
Schema:
{"clips":[{"start":number,"end":number,"caption":string,"speed":number,"rotate":number}],"aspect":"9:16"|"16:9"|"1:1","style":"clean"|"cinematic"|"vibrant"|"warm","transition":"cut"|"fade","notes":string}
Rules:
- start/end are seconds within the video duration. Clips must not overlap, sorted by start. Max 8 clips.
- Keep total kept duration close to what the user asked (e.g. "30-second" = 25-35s total).
- Captions: short (<=60 chars), punchy, plain text, no emojis.
- speed: 0.5, 1, 1.5 or 2 only (default 1). rotate: 0, 90, 180 or 270 only (default 0).
- Choose aspect from the prompt (vertical/Reel/Shorts => 9:16, YouTube/wide => 16:9), default 9:16.
- Respond with raw JSON only.`;

function sanitizePlan(plan, duration) {
  const D = Math.max(1, Number(duration) || 1);
  const clips = [];
  for (const c of (plan.clips || []).slice(0, 8)) {
    let s = +c.start, e = +c.end;
    if (!isFinite(s) || !isFinite(e) || e <= s) continue;
    s = Math.min(Math.max(s, 0), D - 0.2); e = Math.min(Math.max(e, s + 0.2), D);
    clips.push({
      start: +s.toFixed(1), end: +e.toFixed(1),
      caption: String(c.caption || '').slice(0, 120),
      speed: [0.5, 1, 1.5, 2].includes(+c.speed) ? +c.speed : 1,
      rotate: [0, 90, 180, 270].includes(+c.rotate) ? +c.rotate : 0,
    });
  }
  if (!clips.length) throw new Error('EMPTY_PLAN');
  clips.sort((x, y) => x.start - y.start);
  for (let i = 1; i < clips.length; i++) if (clips[i].start < clips[i - 1].end) clips[i].start = clips[i - 1].end;
  return {
    clips: clips.filter(c => c.end > c.start),
    aspect: ['9:16', '16:9', '1:1'].includes(plan.aspect) ? plan.aspect : '9:16',
    style: ['clean', 'cinematic', 'vibrant', 'warm'].includes(plan.style) ? plan.style : 'clean',
    transition: plan.transition === 'fade' ? 'fade' : 'cut',
    notes: String(plan.notes || '').slice(0, 300),
  };
}

function extractJSON(txt) {
  txt = String(txt || '').replace(/```json|```/g, '').trim();
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('NO_JSON');
  return JSON.parse(txt.slice(a, b + 1));
}

async function ollamaPlan(key, model, content) {
  const r = await fetch('https://ollama.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({
      model: model || 'gpt-oss:120b', temperature: 0.4, max_tokens: 2000,
      messages: [{ role: 'system', content: PLAN_SYSTEM }, { role: 'user', content }],
    }),
  });
  if (!r.ok) throw new Error('OLLAMA_' + r.status);
  const j = await r.json();
  return extractJSON((((j.choices || [])[0] || {}).message || {}).content || '');
}

async function freePlan(content) {
  const r = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai', temperature: 0.4, max_tokens: 2000,
      referrer: 'arpo-video-editor',
      messages: [{ role: 'system', content: PLAN_SYSTEM }, { role: 'user', content }],
    }),
  });
  if (!r.ok) throw new Error('FREEAI_' + r.status);
  const j = await r.json();
  return extractJSON((((j.choices || [])[0] || {}).message || {}).content || '');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { prompt, frames, duration, vw, vh, model } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || prompt.length > 4000)
    return res.status(400).json({ error: 'Bad prompt' });
  if (!Array.isArray(frames) || frames.length > 10)
    return res.status(400).json({ error: 'Up to 10 frames allowed' });

  const content = [{ type: 'text', text: 'Video duration: ' + Number(duration).toFixed(1) + 's. Source: ' + vw + 'x' + vh + '. User prompt: ' + prompt.slice(0, 4000) }];
  for (const f of frames.slice(0, 10)) {
    if (typeof f === 'string' && f.startsWith('data:image/') && f.length < 400000)
      content.push({ type: 'image_url', image_url: { url: f } });
  }

  try {
    const key = process.env.OLLAMA_API_KEY;
    const useOllama = key && model !== 'free-ai';
    const plan = useOllama
      ? await ollamaPlan(key, model, content)
      : await freePlan(content);
    return res.status(200).json({ ...sanitizePlan(plan, duration), engine: useOllama ? 'ollama' : 'free' });
  } catch (e) {
    return res.status(502).json({ error: 'AI_FAIL', message: String(e.message || e).slice(0, 200) });
  }
};
