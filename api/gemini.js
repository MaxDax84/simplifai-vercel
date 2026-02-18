export default async function handler(req, res) {
  // Permettiamo chiamate dal browser (CORS)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Se il browser fa una richiesta "OPTIONS" (preflight), rispondiamo subito
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Accettiamo solo POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito. Usa POST." });
  }

  try {
    const { query, target } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Manca il campo query." });
    }

    // La chiave API la prendiamo dalle variabili di ambiente su Vercel
    const API_KEY = process.env.GEMINI_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({ error: "API key non configurata su Vercel." });
    }

    const MODEL = "gemini-1.5-flash";

    const prompt = `
Spiega il seguente concetto: "${query}"

Target: ${target || "un Bambino sotto i 10 anni"}.

Regole:
- Adatta linguaggio, esempi e profondità ESATTAMENTE al target.
- Paragrafi brevi.
- Tono coinvolgente.
- Se target = "Scienziato", includi termini tecnici e una nota sui limiti/assunzioni.
`.trim();

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 800
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok || data?.error) {
      return res.status(500).json({
        error: data?.error?.message || "Errore sconosciuto da Gemini"
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({ error: "Risposta vuota da Gemini." });
    }

    return res.status(200).json({ text });

  } catch (err) {
    console.error("Errore server:", err);
    return res.status(500).json({ error: "Errore interno del server." });
  }
}

