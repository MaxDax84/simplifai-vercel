export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito. Usa POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY non trovata su Vercel (Environment Variables).",
    });
  }

  try {
    const { query, target } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Query mancante." });
    }

    const prompt = `
Spiega il seguente concetto: "${query}"

Adatta il linguaggio, gli esempi, il tono e il livello di profondità
specificamente per questo target: ${target}.

Usa paragrafi brevi, esempi concreti e un tono coinvolgente.
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Nessuna risposta generata.";

    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
