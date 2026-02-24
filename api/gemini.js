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

function looksCut(text, maxChars) {
    const full = String(text || "").trim();
    const tail = full.slice(-240);
    if (!tail) return false;
    const full = String(text || "").trim();
    if (full.length < 220) return true; // solo se è DAVVERO troppo corto
  
    // marker esplicito
    if (/\.\.\.\(continua\)\s*$/i.test(tail)) return true;
  
    // se finisce con virgola/due punti/punto e virgola -> è quasi sempre taglio
    if (/[,:;]\s*$/.test(tail)) return true;
  
    // se finisce bene con punteggiatura forte o chiusure, ok
    const endsWell =
      /[.!?…]\s*$/.test(tail) ||
      /[\)\]"]\s*$/.test(tail);
    if (endsWell) return false;
  
    // Se è "breve" (maxChars basso), NON forzare continue solo perché è corta.
    // Però se è molto corta e finisce male, sì.
    const veryShortForBudget = full.length < Math.max(220, Math.floor(maxChars * 0.18));
    if (veryShortForBudget) return true;
  
    // se termina con lettera/numero -> probabile taglio
    return /[A-Za-zÀ-ÖØ-öø-ÿ0-9]$/.test(tail);
  }

function stripContinuaMarkers(text) {
  return String(text || "").replace(/\n?\.\.\.\(continua\)\s*$/ig, "").trim();
}

function buildPrompt({ query, targetPrompt, mode, previousText, maxChars }) {
  const safeMode = mode === "continue" ? "continue" : "start";
  const prev = String(previousText || "").slice(0, 24000);

  const budget = Math.max(1400, Math.floor(maxChars * 0.9));

  if (safeMode === "continue") {
    return `
Continua la spiegazione.

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
- Chiudi sempre le frasi (non interromperti a metà).
- IMPORTANTISSIMO: termina SEMPRE con una frase conclusiva completa e un punto finale.
- NON terminare con virgola, due punti, punto e virgola o connettivi tipo "e", "ma", "quindi".
- Se stai per finire, fai una frase finale di chiusura (1 riga) e poi STOP.
- Stai entro ~${budget} caratteri (massimo ${maxChars}).
`.trim();
  }

  return `
Spiega il seguente concetto: "${query}"

TARGET/STILE:
${targetPrompt}

ISTRUZIONI:
- Risposta chiara, ben strutturata.
- Usa titoli e liste quando utile.
- Chiudi sempre le frasi (non interromperti a metà).
- IMPORTANTISSIMO: termina SEMPRE con una frase conclusiva completa e un punto finale.
- NON terminare con virgola, due punti, punto e virgola o connettivi tipo "e", "ma", "quindi".
- Se stai per finire, fai una frase finale di chiusura (1 riga) e poi STOP.
- Non iniziare una frase con lettera MAIUSCOLA dopo una virgola: usa un punto.
- L’ultima frase deve finire con un punto (.) o punto interrogativo (?) o esclamativo (!).
- Stai entro ~${budget} caratteri (massimo ${maxChars}).
`.trim();
}

async function callGeminiSSE({ apiKey, prompt, maxTokens }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent` +
    `?alt=sse&key=${apiKey}`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: maxTokens },
    }),
  });

  return upstream;
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
    try { body = await req.json(); } catch { return jsonError("Body JSON non valido.", 400); }

    const query = String(body?.query || "").trim();
    const targetPrompt = String(body?.targetPrompt || "").trim();
    const mode = body?.mode;
    const previousText = body?.previousText || "";

    if (!query || !targetPrompt) return jsonError("Parametri mancanti: query/targetPrompt.", 400);

    const maxTokens = clamp(body?.maxTokens, 256, 8000, 1200);
    const maxChars = clamp(body?.maxChars, 500, 50000, 6000);

    // ---- STREAM verso client (SSE pulito) ----
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    const emitText = async (text) => {
      const t = String(text || "");
      if (!t) return;
      const json = { candidates: [{ content: { parts: [{ text: t }] } }] };
      await writer.write(encoder.encode(`data: ${JSON.stringify(json)}\n\n`));
    };

    const closeStream = async () => {
      await writer.write(encoder.encode("data: [DONE]\n\n"));
      try { await writer.close(); } catch {}
    };

    // Esegue un “round” (start o continue) e raccoglie il testo completo di quel round,
    // mentre lo streamma anche al client in real time.
    const runRound = async (roundMode, currentText) => {
      const prompt = buildPrompt({
        query,
        targetPrompt,
        mode: roundMode,
        previousText: currentText,
        maxChars
      });

      const upstream = await callGeminiSSE({ apiKey, prompt, maxTokens });
      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        let msg = `Errore upstream (${upstream.status})`;
        try {
          const j = JSON.parse(errText);
          msg = j?.error?.message || msg;
        } catch {
          if (errText) msg = `${msg}: ${errText.slice(0, 300)}`;
        }
        throw new Error(msg);
      }
      if (!upstream.body) throw new Error("Upstream body nullo (stream non disponibile).");

      const reader = upstream.body.getReader();
      let buffer = "";
      let roundText = "";

      const processBlock = async (block) => {
        const lines = block.split(/\r?\n/);
        const dataLines = lines.filter(l => l.startsWith("data:")).map(l => l.slice(5).trim());
        if (!dataLines.length) return;

        const data = dataLines.join("\n");
        if (!data || data === "[DONE]") return;

        let json;
        try { json = JSON.parse(data); } catch { return; }

        const parts = json?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) return;

        const chunk = parts.map(p => p?.text ? String(p.text) : "").join("");
        if (!chunk) return;

        roundText += chunk;
        // streamma subito al client (ma NON marker continua)
        await emitText(chunk);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";

        for (const b of blocks) {
          if (b.trim()) await processBlock(b);
        }
      }
      if (buffer.trim()) await processBlock(buffer);

      return roundText;
    };

    // pump server-side: massimo 3 round per non spendere troppo
    (async () => {
      try {
        let fullText = "";

        // se il client manda mode=continue, partiamo continuando, altrimenti start
        const initialMode = (mode === "continue") ? "continue" : "start";
        if (initialMode === "continue") {
          fullText = String(previousText || "");
        }

        // round 1
        const r1 = await runRound(initialMode, fullText);
        fullText += r1;

        // ripulisci marker se Gemini l’ha messo
        fullText = stripContinuaMarkers(fullText);

        // round 2-3 solo se sembra tagliato
        let hops = 0;
          while (looksCut(fullText) && hops < 4) {
          hops++;
          const r = await runRound("continue", fullText);
          fullText += r;
          fullText = stripContinuaMarkers(fullText);
        }

        await closeStream();
      } catch (e) {
        await emitText(`⚠️ Errore: ${e?.message || "sconosciuto"}`);
        await closeStream();
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
