export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito. Usa POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY non configurata su Vercel." });
  }

  try {
    const { query, target } = req.body || {};
    if (!query) return res.status(400).json({ error: "Query mancante." });

    const prompt = `
Spiega il seguente concetto: "${query}"
Target: ${target || "un Bambino sotto i 10 anni"}.

Regole:
- Adatta linguaggio, esempi e profondità al target.
- Paragrafi brevi.
- Tono coinvolgente.
`.trim();

    // ✅ endpoint v1beta + modello "latest" (più compatibile)
    const MODEL = "gemini-1.5-flash-latest";

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
        }),
      }
    );

    const data = await r.json();

    if (!r.ok || data?.error) {
      return res.status(500).json({
        error: data?.error?.message || `Errore Gemini (HTTP ${r.status})`,
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return res.status(500).json({ error: "Risposta vuota da Gemini." });

    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Errore interno server." });
  }
}
