export const config = { runtime: "edge" };

/* =========================
   CONFIG
========================= */
const FREE_DAILY_CREDITS = 5;
const KEY_PREFIX = "credits:v1";

/* =========================
   Helpers
========================= */
function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
}

function jsonError(message, status = 500, extraHeaders = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: corsHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Expose-Headers": "x-credits-remaining,x-credits-limit,x-retry-after",
      ...extraHeaders,
    }),
  });
}

function getClientIp(req) {
  // Best effort on Vercel/Edge
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function utcDayStamp() {
  // YYYY-MM-DD in UTC
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function upstashFetch(path, body) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("UPSTASH_REDIS env vars mancanti.");

  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Upstash error ${res.status}`);
  }
  return data;
}

/**
 * Decrementa 1 credito al giorno per IP.
 * Inizializza a FREE_DAILY_CREDITS con TTL fino a fine giornata UTC.
 * Ritorna remaining (>=0).
 */
async function consumeDailyCredit(ip) {
  const day = utcDayStamp();
  const key = `${KEY_PREFIX}:${day}:${ip}`;

  // Calcola TTL fino a mezzanotte UTC
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  const ttlSeconds = Math.max(60, Math.floor((end.getTime() - now.getTime()) / 1000));

  // Lua-like atomic approach using Upstash pipeline:
  // 1) SET key FREE_DAILY_CREDITS if not exists + EX ttl
  // 2) DECR key
  // 3) GET key
  const pipeline = [
    ["SET", key, FREE_DAILY_CREDITS, "EX", ttlSeconds, "NX"],
    ["DECR", key],
    ["GET", key],
  ];

  const result = await upstashFetch("/pipeline", pipeline);
  // result.result is array of each command result
  const remainingRaw = result?.result?.[2]?.result;

  let remaining = Number(remainingRaw);
  if (!Number.isFinite(remaining)) remaining = 0;

  // Se per qualche motivo va sotto zero, clamp
  if (remaining < 0) remaining = 0;

  return { remaining, limit: FREE_DAILY_CREDITS, ttlSeconds };
}

/* =========================
   Main handler
========================= */
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

    // Crediti: richiede Upstash
    const ip = getClientIp(req);
    const { remaining, limit } = await consumeDailyCredit(ip);

    // Se crediti finiti -> blocca prima di chiamare Gemini
    if (remaining <= 0) {
      return jsonError(
        "Hai finito i 5 crediti gratuiti di oggi. Torna domani oppure fai upgrade per averne di più.",
        429,
        {
          "x-credits-remaining": "0",
          "x-credits-limit": String(limit),
          "x-retry-after": "tomorrow",
        }
      );
    }

    // Body parsing robusto
    let body = null;
    try {
      body = await req.json();
    } catch {
      return jsonError("Body non valido: invia JSON con Content-Type application/json.", 400, {
        "x-credits-remaining": String(remaining),
        "x-credits-limit": String(limit),
      });
    }

    const { query, targetPrompt, maxTokens, maxChars, mode, previousText } = body || {};
    if (!query || !targetPrompt) {
      return jsonError("Parametri mancanti (query/targetPrompt).", 400, {
        "x-credits-remaining": String(remaining),
        "x-credits-limit": String(limit),
      });
    }

    const tokens = Math.min(Math.max(Number(maxTokens) || 1200, 256), 8000);
    const charsLimit = Math.min(Math.max(Number(maxChars) || 4000, 500), 50000);

    const safeMode = mode === "continue" ? "continue" : "start";
    const prev = String(previousText || "").slice(0, 20000);

    const prompt =
      safeMode === "start"
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

    // Timeout
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
      const msg =
        e?.name === "AbortError"
          ? "Timeout chiamando Gemini (25s)."
          : e?.message || "Errore rete verso Gemini.";
      return jsonError(msg, 502, {
        "x-credits-remaining": String(remaining),
        "x-credits-limit": String(limit),
      });
    } finally {
      clearTimeout(t);
    }

    if (!upstream.ok) {
      // Se Gemini fallisce, hai comunque consumato 1 credito.
      // Se vuoi “refund”, si può fare, ma va deciso (io terrei così: semplice e chiaro).
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
      return jsonError(msg, upstream.status === 429 ? 429 : 500, {
        "x-credits-remaining": String(remaining),
        "x-credits-limit": String(limit),
      });
    }

    const expose = "x-credits-remaining,x-credits-limit,x-retry-after";

    return new Response(upstream.body, {
      status: 200,
      headers: corsHeaders({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Access-Control-Expose-Headers": expose,
        "x-credits-remaining": String(remaining),
        "x-credits-limit": String(limit),
      }),
    });
  } catch (e) {
    return jsonError(e?.message || "Errore sconosciuto (edge).", 500);
  }
}
