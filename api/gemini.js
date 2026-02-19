export default async function handler(req, res) {
  // CORS base
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito. Usa POST." });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY mancante su Vercel." });

    const { query, targetLabel, targetPrompt, maxTokens, maxChars } = req.body || {};

    if (!query || !targetPrompt) {
      return res.status(400).json({ error: "Parametri mancanti (query/targetPrompt)." });
    }

    // ✅ Limiti “safe”
    const tokens = Math.min(Math.max(Number(maxTokens) || 1200, 256), 8000); // tra 256 e 8000
    const charsLimit = Math.min(Math.max(Number(maxChars) || 4000, 500), 50000); // tra 500 e 50k

    const prompt = `
Spiega il seguente concetto: "${query}".

Target: ${targetPrompt}.
Stile: chiaro, ben strutturato, con esempi adatti al target.
Vincolo LUNGHEZZA: resta ENTRO circa ${Math.floor(charsLimit * 0.85)} caratteri (massimo ${charsLimit}).
Se non basta spazio, dai una sintesi e poi una sezione "In breve" finale.

Formatta con titoli e liste quando utile.
`.trim();

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: tokens
        }
      })
    });

    const data = await r.json();

    if (!r.ok || data?.error) {
      const msg = data?.error?.message || `Errore API (${r.status})`;
      return res.status(500).json({ error: msg });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let out = String(text);

    // ✅ Taglio “hard” per rispettare SEMPRE maxChars
    if (out.length > charsLimit) {
      out = out.slice(0, charsLimit).trimEnd() + "\n\n…(continua)";
    }

    return res.status(200).json({
      text: out,
      used: { maxTokens: tokens, maxChars: charsLimit },
      target: targetLabel || ""
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Errore sconosciuto" });
  }
}
