export const config = { runtime: "edge" };

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
}

function jsonError(message, status = 500, extra = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: corsHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "X-SimplifAI-API": "gemini-proxy",
      ...extra,
    }),
  });
}

function clamp(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(Math.max(x, min), max);
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders({ "X-SimplifAI-API": "gemini-proxy" }) });
  }
  if (req.method !== "POST") {
    return jsonError("Metodo non consentito. Usa POST.", 405);
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return jsonError("GEMINI_API_KEY mancante su Vercel.", 500);

    let body;
    try {
      body = await req.json();
    } catch {
      return jsonError("Body JSON non valido.", 400);
    }

    const { query, targetPrompt, maxTokens, maxChars, mode, previousText } = body || {};
    if (!query || !targetPrompt) {
      return jsonError("Parametri mancanti (query/targetPrompt).", 400);
    }

    const tokens = clamp(maxTokens, 256, 8000, 1200);
    const charsLimit = clamp(maxChars, 500, 50000, 4000);

    const safeMode = mode === "continue" ? "continue" : "start";
    const prev = String(previousText || "").slice(0, 20000);

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

    // Google SSE endpoint
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent` +
      `?alt=sse&key=${apiKey}`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: tokens },
      }),
    });

    if (!upstream.ok) {
      // Google spesso ritorna JSON errore (non stream). Leggiamo text per sicurezza.
      const errText = await upstream.text().catch(() => "");
      // prova a estrarre message se è JSON
      let msg = `Errore upstream (${upstream.status})`;
      try {
        const j = JSON.parse(errText);
        msg = j?.error?.message || msg;
      } catch {
        if (errText) msg = `${msg}: ${errText.slice(0, 300)}`;
      }
      return jsonError(msg, 500, { "X-Upstream-Status": String(upstream.status) });
    }

    if (!upstream.body) {
      return jsonError("Upstream body nullo (stream non disponibile).", 500);
    }

    // === Trasforma SSE Google -> SSE “pulito” ===
    // Obiettivo: assicurare che ogni evento sia un JSON valido e che in caso di blocco ci sia comunque testo.
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    let buffer = "";
    let sentAnyText = false;
    let sawDone = false;

    const emitSSE = async (obj) => {
      const data = JSON.stringify(obj);
      await writer.write(encoder.encode(`data: ${data}\n\n`));
    };

    const emitTextAsCandidate = async (text) => {
      sentAnyText = true;
      await emitSSE({
        candidates: [
          {
            content: { parts: [{ text }] },
          },
        ],
      });
    };

    // Parsing SSE: blocchi separati da riga vuota
    const processBlock = async (block) => {
      const lines = block.split(/\r?\n/);
      const dataLines = lines
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());

      if (!dataLines.length) return;

      const data = dataLines.join("\n");
      if (!data) return;

      if (data === "[DONE]") {
        sawDone = true;
        return;
      }

      let json;
      try {
        json = JSON.parse(data);
      } catch {
        // se Google manda roba non parseabile, ignoriamo (ma non blocchiamo lo stream)
        return;
      }

      // Caso: blocco/safety → spesso candidates vuoto + promptFeedback con blockReason
      const candidates = json?.candidates;
      const parts = candidates?.[0]?.content?.parts;
      const hasText = Array.isArray(parts) && parts.some((p) => typeof p?.text === "string" && p.text.length);

      const blockReason = json?.promptFeedback?.blockReason;
      if (!hasText && blockReason) {
        await emitTextAsCandidate(`⚠️ Contenuto bloccato (${blockReason}). Prova a riformulare la domanda.`);
        sawDone = true;
        return;
      }

      // Caso: nessun testo ma c’è qualche info → non facciamo nulla
      // Caso: ha testo → inoltra evento “compatibile” al client
      if (hasText) {
        sentAnyText = true;
        // inoltra l’evento così com’è (il tuo client legge candidates[0].content.parts[].text)
        await emitSSE(json);
      }
    };

    // Pump: legge upstream e scrive nel TransformStream
    (async () => {
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() || "";

          for (const b of blocks) {
            if (b.trim()) await processBlock(b);
            if (sawDone) break;
          }
          if (sawDone) break;
        }

        if (!sawDone && buffer.trim()) {
          await processBlock(buffer);
        }

        // Se per qualche motivo non è arrivato nulla, invia un messaggio utile
        if (!sentAnyText) {
          await emitTextAsCandidate(
            "⚠️ Nessun testo ricevuto dallo stream. Verifica GEMINI_API_KEY su Vercel (Preview/Production) e riprova."
          );
        }

        // Chiudi lo stream con DONE (così lato client finisce sempre)
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        await emitTextAsCandidate(`⚠️ Errore stream: ${e?.message || "sconosciuto"}`);
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } finally {
        try { await writer.close(); } catch {}
        try { reader.releaseLock(); } catch {}
      }
    })();

    return new Response(readable, {
      status: 200,
      headers: corsHeaders({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-SimplifAI-API": "gemini-proxy",
      }),
    });
  } catch (e) {
    return jsonError(e?.message || "Errore sconosciuto", 500);
  }
}
