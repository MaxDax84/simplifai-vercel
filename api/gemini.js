export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito. Usa POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY non configurata su Vercel." });
  }

  try {
    const { query, target } = req.body || {};

    if (!query) {
      return res.status(400).json({ error: "Query mancante." });
    }

    const prompt = `
Spiega il seguente concetto: "${query}"

Adatta il linguaggio, gli esempi, il tono e il livello di profondità
specificamente per questo target: ${target || "Bambino (fino ai 10 anni)"}.

Regole:
- Paragrafi brevi
- Esempi concreti
- Linguaggio chiaro
- Se utile, usa punti elenco
`.trim();

    // ✅ MODELLO GIUSTO DISPONIBILE NEL TUO ACCOUNT
    const MODEL = "gemini-2.5-flash";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 3500,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok || data?.error) {
      return res.status(500).json({
        error:
          data?.error?.message ||
          `Errore Gemini (HTTP ${response.status})`,
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({ error: "Risposta vuota da Gemini." });
    }

    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
