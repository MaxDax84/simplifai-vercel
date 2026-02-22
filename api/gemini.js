// gemini.js — Vercel Edge Function
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

function buildPrompt({ query, targetPrompt, mode, previousText, maxChars }) {
  const safeMode = mode === "continue" ? "continue" : "start";
  const prev = String(previousText || "").slice(0, 20000);

  // “Budget” caratteri: diamo un vincolo forte, e chiediamo di chiudere con ...(continua)
  // così il FE può auto-continuare.
  const budget = Math.max(800, Math.floor(maxChars * 0.85));

  if (safeMode === "continue") {
    return `
Stiamo continuando una spiegazione iniziata in precedenza.

DOMANDA/CONCETTO: "${query}"

TARGET/STILE:
${targetPrompt}

TESTO GIÀ DATO (non ripeterlo):
"""
${prev}
"""

ISTRUZIONI:
- Continua dal punto esatto in cui si è interrotta.
- Non ripetere introduzioni o sezioni già fatte.
- Mantieni lo stesso tono e livello del target.
- Stai entro ~${budget} caratteri (massimo ${maxChars}).
- Se non basta spazio, termina con una frase completa e aggiungi ESATTAMENTE: ...(continua)
`.trim();
  }

  return `
Spiega il seguente concetto: "${query}"

TARGET/STILE:
${targetPrompt}

ISTRUZIONI:
- Rispondi in modo chiaro e ben strutturato.
- Usa titoli e liste quando utile.
- Stai entro ~${budget} caratteri (massimo ${maxChars}).
- Se non basta spazio, NON iniziare una sezione nuova: chiudi con una frase completa e termina con ESATTAMENTE: ...(continua)
`.trim();
}

export default async function handler(req) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders({ "X-SimplifAI-API": "gemini-proxy" }),
    });
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

    const query = (body?.query || "").toString().trim();
    const targetPrompt = (body?.targetPrompt || "").toString().trim();
    const mode = body?.mode;
    const previousText = body?.previousText || "";

    if (!query || !targetPrompt) {
      return jsonError("Parametri mancanti: query/targetPrompt.", 400);
    }

    // Limiti (arrivano dal FE, li clampo)
    const maxTokens = clamp(body?.maxTokens, 256, 8000, 1200);
    const maxChars = clamp(body?.maxChars, 500, 50000, 4000);

    const prompt = buildPrompt({ query, targetPrompt, mode, previousText, maxChars });

    // Endpoint SSE Google
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent` +
      `?alt=sse&key=${apiKey}`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: maxTokens,
        },
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
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

    // ====== Trasformazione: SSE Google -> SSE pulito per il client ======
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    let buffer = "";
    let sentAnyText = false;
    let sawDone = false;

    // Tail per capire se finiamo “a metà frase”
    let lastTextTail = "";

    const emitSSE = async (obj) => {
      const data = JSON.stringify(obj);
      await writer.write(encoder.encode(`data: ${data}\n\n`));
    };

    const emitTextAsCandidate = async (text) => {
      const t = String(text || "");
      if (!t) return;

      sentAnyText = true;
      lastTextTail = (lastTextTail + t).slice(-240);

      await emitSSE({
        candidates: [{ content: { parts: [{ text: t }] } }],
      });
    };

    const updateTailFromJson = (json) => {
      try {
        const parts = json?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) return;
        const chunk = parts.map((p) => (p?.text ? String(p.text) : "")).join("");
        if (!chunk) return;
        lastTextTail = (lastTextTail + chunk).slice(-240);
      } catch (_) {}
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
        // Se arriva qualcosa di non parseabile, ignoriamo
        return;
      }

      // Safety / block
      const blockReason = json?.promptFeedback?.blockReason;
      const candidates = json?.candidates;
      const parts = candidates?.[0]?.content?.parts;

      const hasText =
        Array.isArray(parts) && parts.some((p) => typeof p?.text === "string" && p.text.length);

      if (!hasText && blockReason) {
        await emitTextAsCandidate(`⚠️ Contenuto bloccato (${blockReason}). Prova a riformulare la domanda.`);
        sawDone = true;
        return;
      }

      if (hasText) {
        sentAnyText = true;
        updateTailFromJson(json);
        await emitSSE(json);
      }
    };

    const shouldForceContinue = () => {
      const tail = (lastTextTail || "").trim();
      if (!tail) return false;

      // Se già c'è ...(continua) non aggiungere nulla
      if (/\.\.\.\(continua\)\s*$/i.test(tail)) return false;

      // euristica: se non finisce con punteggiatura o chiusura, e termina con lettera/numero
      const endsWell = /[.!?…]\s*$/.test(tail) || tail.endsWith(")") || tail.endsWith("]") || tail.endsWith('"');
      const looksCut = !endsWell && /[A-Za-zÀ-ÖØ-öø-ÿ0-9]$/.test(tail);

      return looksCut;
    };

    // Pump
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

        // Se upstream non ha inviato testo, manda un messaggio utile
        if (!sentAnyText) {
          await emitTextAsCandidate(
            "⚠️ Nessun testo ricevuto dallo stream. Verifica GEMINI_API_KEY su Vercel (Preview/Production) e riprova."
          );
        }

        // Guardia: se sembra tronco e manca ...(continua), aggiungilo noi
        if (sentAnyText && shouldForceContinue()) {
          await emitTextAsCandidate("\n\n...(continua)");
        }

        // chiusura stream per il client
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
