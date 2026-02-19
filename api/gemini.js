export default async function handler(req, res) {
  // CORS base
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito. Usa POST." });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY mancante su Vercel." });

    const {
      query,
      targetLabel,
      targetPrompt,
      maxTokens,
      maxChars,
      mode,           // "start" | "continue"
      previousText    // testo già mostrato (solo per continue)
    } = req.body || {};

    if (!query || !targetPrompt) {
      return res.status(400).json({ error: "Parametri mancanti (query/targetPrompt)." });
    }

    // Limiti safe
    const tokens = Math.min(Math.max(Number(maxTokens) || 1200, 256), 8000);
    const charsLimit = Math.min(Math.max(Number(maxChars) || 4000, 500), 50000);

    const safeMode = (mode === "continue") ? "continue" : "start";
    const prev = String(previousText || "").slice(0, 20000); // sicurezza: max 20k char nel prompt

    let prompt = "";

    if (safeMode === "start") {
      prompt = `
Spiega il seguente concetto: "${query}".

Target: ${targetPrompt}.
Stile: chiaro, ben strutturato, con esempi adatti al target.

VINCOLI:
- Resta ENTRO circa ${Math.floor(charsLimit * 0.85)} caratteri (massimo ${charsLimit}).
- Se non basta spazio, NON iniziare una sezione nuova: chiudi con una frase completa e termina con la scritta esatta: ...(continua)

Formatta con titoli e liste quando utile.
`.trim();
    } else {
      prompt = `
Stiamo continuando una spiegazione iniziata in precedenza.

Concetto: "${query}"
Target: ${targetPrompt}

TESTO GIÀ DATO (non ripeterlo, continua da dove eri rimasto):
"""
${prev}
"""

Ora continua dal punto esatto in cui si è interrotta.
- NON ripetere introduzioni o titoli già dati (a meno che serva un sottotitolo nuovo)
- Mantieni lo stesso tono e livello del target
- Se anche questa parte rischia di essere troppo lunga, termina di nuovo con: ...(continua)
`.trim();
    }

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
    let out = String(text).trimEnd();

    // 1) Taglio hard se supera maxChars
    if (out.length > charsLimit) {
      out = out.slice(0, charsLimit).trimEnd();
    }

    // 2) Heuristics: se sembra "tagliato" o finisce male, forziamo ...(continua)
    const endsWithMarker = out.endsWith("...(continua)");
    const endsNicely = /[.!?…]"?\s*$/.test(out); // finisce con punteggiatura
    const nearLimit = out.length >= Math.floor(charsLimit * 0.92);

    // se finisce senza punteggiatura (es: "con i") è quasi certamente troncato
    const needsContinue = endsWithMarker || nearLimit || !endsNicely;

    if (needsContinue && !endsWithMarker) {
      out = out.trimEnd() + "\n\n...(continua)";
    }

    return res.status(200).json({
      text: out,
      needsContinue,
      used: { maxTokens: tokens, maxChars: charsLimit },
      target: targetLabel || "",
      mode: safeMode
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Errore sconosciuto" });
  }
}
