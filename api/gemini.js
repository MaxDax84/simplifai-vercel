export const config = { runtime: "edge" };

function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonError("Metodo non consentito. Usa POST.", 405);
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return jsonError("GEMINI_API_KEY mancante su Vercel.", 500);

    // Body parsing robusto
    let body = null;
    try {
      body = await req.json();
    } catch {
      return jsonError("Body non valido: invia JSON con Content-Type application/json.", 400);
    }

    const { query, targetPrompt, maxTokens, maxChars, mode, previousText } = body || {};
    if (!query || !targetPrompt) {
      return jsonError("Parametri mancanti (query/targetPrompt).", 400);
    }

    const tokens = Math.min(Math.max(Number(maxTokens) || 1200, 256), 8000);
    const charsLimit = Math.min(Math.max(Number(maxChars) || 4000, 500), 50000);

    const safeMode = mode === "continue" ? "continue" : "start";
    const prev = String(previousText || "").slice(0, 20000);

    const prompt = (safeMode === "start")
      ? `
Spiega il seguente concetto: "${query}".

Target: ${targetPrompt}.
Stile: chiaro, ben strutturato, con esempi adatti al target.

VINCOLI:
- Resta ENTRO circa ${Math.floor(charsLimit * 0.85)} caratteri (massimo ${charsLimit}).
- Se non basta spazio, NON iniziare una sezione nuova: chiudi con una frase completa e termina con la scritta esatta: ...(continua)

Formatta con titoli e liste quando utile.
`.trim()
      : `
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

    // Timeout per evitare crash/attese infinite
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 25000);

    let upstream;
    try {
      upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: tokens },
        }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(t);
      const msg = e?.name === "AbortError" ? "Timeout chiamando Gemini (25s)." : (e?.message || "Errore rete verso Gemini.");
      return jsonError(msg, 502);
    } finally {
      clearTimeout(t);
    }

    if (!upstream.ok) {
      let msg = `Errore API (${upstream.status})`;
      try {
        const ct = (upstream.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("application/json")) {
          const j = await upstream.json();
          msg = j?.error?.message || msg;
        } else {
          const txt = await upstream.text();
          if (txt && txt.trim()) msg = txt.trim().slice(0, 400);
        }
      } catch {}
      return jsonError(msg, upstream.status === 429 ? 429 : 500);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  } catch (e) {
    return jsonError(e?.message || "Errore sconosciuto (edge).", 500);
  }
}
