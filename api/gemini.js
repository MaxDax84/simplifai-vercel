export const config = { runtime: "edge" };

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
}

function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: corsHeaders({
      "Content-Type": "application/json; charset=utf-8",
    }),
  });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return jsonError("Metodo non consentito. Usa POST.", 405);
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return jsonError("GEMINI_API_KEY mancante su Vercel.", 500);

    let body = null;
    try {
      body = await req.json();
    } catch {
      return jsonError("Body non valido.", 400);
    }

    const { query, targetPrompt, maxTokens, maxChars, mode, previousText } = body || {};
    if (!query || !targetPrompt) {
      return jsonError("Parametri mancanti.", 400);
    }

    const tokens = Math.min(Math.max(Number(maxTokens) || 1200, 256), 8000);
    const charsLimit = Math.min(Math.max(Number(maxChars) || 4000, 500), 50000);

    const safeMode = mode === "continue" ? "continue" : "start";
    const prev = String(previousText || "").slice(0, 20000);

    const prompt = safeMode === "start"
      ? `
Spiega il seguente concetto: "${query}".

Target: ${targetPrompt}.
Stile: chiaro, ben strutturato, con esempi adatti al target.

VINCOLI:
- Resta entro ${Math.floor(charsLimit * 0.85)} caratteri.
- Se finisce lo spazio, termina con: ...(continua)
`.trim()
      : `
Continua questa spiegazione senza ripetere ciò che è già stato detto.

Concetto: "${query}"
Target: ${targetPrompt}

TESTO GIÀ DATO:
"""
${prev}
"""
`.trim();

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: tokens },
      }),
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      return jsonError(txt || `Errore API ${upstream.status}`, upstream.status);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: corsHeaders({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      }),
    });

  } catch (e) {
    return jsonError(e?.message || "Errore sconosciuto.", 500);
  }
}
