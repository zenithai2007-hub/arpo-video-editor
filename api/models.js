/* arPo server: AI engine info.
   Ollama Cloud models if OLLAMA_API_KEY is set, otherwise free keyless AI.
   The app's ONE key lives only in the OLLAMA_API_KEY env var — never shown to users. */
module.exports = async (req, res) => {
  const key = process.env.OLLAMA_API_KEY;
  if (key) {
    try {
      const r = await fetch('https://ollama.com/v1/models', {
        headers: { 'Authorization': 'Bearer ' + key },
      });
      if (r.ok) {
        const j = await r.json();
        const models = ((j.data || []).map(m => m.id) || []).sort();
        if (models.length) return res.status(200).json({ engine: 'ollama', models });
      }
    } catch (e) { /* fall through to free */ }
  }
  return res.status(200).json({ engine: 'free', models: ['Free AI (no key needed)'], ids: ['free-ai'] });
};
