/* arPo server: AI text-to-video via Pollinations (server-side free key, hidden from users).
   Owner: get a free key at enter.pollinations.ai → Vercel env var POLLINATIONS_KEY. */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.POLLINATIONS_KEY;
  if (!key) return res.status(503).json({
    error: 'NO_KEY',
    message: 'Owner: enter.pollinations.ai se free key lo aur Vercel mein POLLINATIONS_KEY naam se env var add karo, phir redeploy.',
  });
  const { prompt, duration, aspectRatio } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || prompt.length > 800)
    return res.status(400).json({ error: 'Bad prompt (max 800 chars).' });
  const dur = [4, 5].includes(+duration) ? +duration : 5;
  const ar = ['16:9', '9:16', '1:1'].includes(aspectRatio) ? aspectRatio : '16:9';
  try {
    const url = 'https://gen.pollinations.ai/video/' + encodeURIComponent(prompt.slice(0, 800)) +
      '?key=' + encodeURIComponent(key) +
      '&model=' + encodeURIComponent('bytedance/seedance-2.0-mini') +
      '&duration=' + dur + '&aspectRatio=' + encodeURIComponent(ar);
    const r = await fetch(url);
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      const msg = r.status === 402 || r.status === 403
        ? 'Free video credits khatam — Pollinations pollen top-up needed.'
        : 'Video API HTTP ' + r.status;
      return res.status(502).json({ error: 'VIDEO_FAIL', message: msg + (t ? ' — ' + t.slice(0, 120) : '') });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 10000) return res.status(502).json({ error: 'VIDEO_FAIL', message: 'Empty video returned — try again.' });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', String(buf.length));
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({ error: 'VIDEO_FAIL', message: String(e.message || e).slice(0, 160) });
  }
};
