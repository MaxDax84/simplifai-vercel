export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY non configurata su Vercel." });
  }

  try {
    // ListModels su v1beta
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    const data = await r.json();

    if (!r.ok || data?.error) {
      return res.status(500).json({ error: data?.error?.message || `HTTP ${r.status}` });
    }

    // Restituiamo solo i nomi, per semplicità
    const names = (data.models || []).map(m => m.name);
    return res.status(200).json({ models: names });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Errore interno" });
  }
}
