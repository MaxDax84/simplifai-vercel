// Proxy edge verso Groq (openai/gpt-oss-120b). Chiave env: GROQ_API_KEY.

export const config = { runtime: "edge", regions: ["fra1"] };

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

// "*" era inutile per il sito stesso (le chiamate da app.html sono same-origin,
// non serve CORS) e apriva l'endpoint a qualunque altro sito. Riflette solo i
// domini reali del progetto.
const ALLOWED_ORIGINS = ["https://www.simplif-ai.it", "https://simplif-ai.it"];

function corsHeadersFor(origin, extra) {
  extra = extra || {};
  var allowOrigin = ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0];
  return Object.assign({
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    // Senza questo, il browser scarta X-Credits-Remaining lato client
    // (i custom header non sono esposti a fetch() di default via CORS).
    "Access-Control-Expose-Headers": "X-Credits-Remaining",
  }, extra);
}

// ── Autenticazione + consumo crediti server-side ──────────────────────────
// Prima non c'era NESSUN controllo qui: chiunque poteva chiamare questo
// endpoint direttamente (curl/fetch) e ottenere generazioni gratuite
// illimitate, bypassando del tutto Supabase e i crediti. Ora, se la
// richiesta arriva con un Authorization Bearer (utente loggato), i crediti
// vengono verificati e scalati PRIMA di chiamare Groq tramite la funzione
// Postgres spend_credits() (SECURITY DEFINER, vedi
// supabase/migrations/spend_credits_server_side.sql) — il costo non è mai
// un numero arbitrario mandato dal client, ma target_cost/length_extra
// validati contro i soli valori reali che esistono in app.html.

async function getSupabaseUser(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ") || !SUPABASE_URL || !SUPABASE_ANON) return null;
  var res = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: {
      "Authorization": authHeader,
      "apikey": SUPABASE_ANON,
    },
  });
  if (!res.ok) return null;
  var user = await res.json();
  return user && user.id ? user : null;
}

async function spendCredits(authHeader, targetCost, lengthExtra) {
  var res = await fetch(SUPABASE_URL + "/rest/v1/rpc/spend_credits", {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "apikey": SUPABASE_ANON,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_target_cost: targetCost, p_length_extra: lengthExtra }),
  });

  if (res.ok) {
    var credits = await res.json();
    return { ok: true, credits: Number(credits) };
  }

  var errBody = "";
  try { errBody = await res.text(); } catch (e) { errBody = ""; }
  var insufficient = errBody.indexOf("insufficient_credits") !== -1;
  return { ok: false, insufficient: insufficient, message: errBody };
}

// ── Rate-limit domande gratuite anonime ────────────────────────────────────
// Usa Upstash Redis se configurato su Vercel; altrimenti (verificato: non lo
// è in produzione) usa una funzione Postgres su Supabase come fallback, così
// il limite è SEMPRE applicato lato server e non "fail-open" di default.
// Prima di questo fix, senza Upstash chiunque poteva chiamare questo
// endpoint senza limiti, consumando la chiave Groq a pagamento.

function getClientIp(req) {
  var xff = req.headers.get("x-forwarded-for") || "";
  var ip = xff.split(",")[0].trim();
  return ip || "unknown";
}

async function checkAnonRateLimitUpstash(ip) {
  var url = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // non configurato: prova il fallback

  var key = "sai_anon:" + ip;
  try {
    var res = await fetch(url + "/pipeline", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([["INCR", key], ["EXPIRE", key, "31536000"]]),
    });
    if (!res.ok) return null; // errore infra: prova il fallback

    var results = await res.json();
    var count = results && results[0] && Number(results[0].result);
    return Number.isFinite(count) ? count <= 2 : null;
  } catch (e) {
    return null;
  }
}

async function checkAnonRateLimitSupabase(ip) {
  if (!SUPABASE_URL || !SUPABASE_ANON) return true; // config mancante: non bloccare
  try {
    var res = await fetch(SUPABASE_URL + "/rest/v1/rpc/check_anon_rate_limit", {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON,
        "Authorization": "Bearer " + SUPABASE_ANON,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_ip: ip }),
    });
    if (!res.ok) return true; // fail-open solo se anche il fallback DB è irraggiungibile
    return await res.json();
  } catch (e) {
    return true;
  }
}

async function checkAnonRateLimit(req) {
  var ip = getClientIp(req);
  var upstashResult = await checkAnonRateLimitUpstash(ip);
  if (upstashResult !== null) return upstashResult;
  return checkAnonRateLimitSupabase(ip);
}

function clamp(n, min, max, fallback) {
  var x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(Math.max(x, min), max);
}

var UI_LANG_NAMES = { it: "italiano", en: "inglese" };

function buildPrompt(query, targetPrompt, mode, previousText, maxChars, uiLang) {
  var safeMode = mode === "continue" ? "continue" : "start";
  var prev = String(previousText || "").slice(0, 24000);
  var budget = Math.max(1400, Math.floor(maxChars * 0.9));
  var langName = UI_LANG_NAMES[uiLang] || null;

  // Direttiva lingua: se conosciamo la lingua dell'interfaccia, quella e' il
  // default vincolante (l'auto-rilevamento su testo breve/maiuscolo/keyword
  // non e' affidabile). Solo una domanda scritta in modo chiaro e univoco in
  // un'altra lingua specifica fa scattare l'eccezione.
  var langDirectiveTop = langName
    ? "LINGUA RISPOSTA OBBLIGATORIA: " + langName.toUpperCase() + ". Rispondi SEMPRE in " + langName + ", anche se la domanda contiene parole in un'altra lingua, sigle, maiuscole o e' molto breve. Fai eccezione SOLO se l'intera domanda e' scritta in modo chiaro e inequivocabile in un'altra lingua specifica: in quel caso rispondi in quella lingua."
    : "LINGUA RISPOSTA: rispondi nella stessa lingua in cui e' scritta la DOMANDA/CONCETTO, qualunque lingua sia.";
  var langRule = langName
    ? "- Rispondi in " + langName + " (vedi LINGUA RISPOSTA OBBLIGATORIA sopra)."
    : "- Rispondi nella stessa lingua in cui e' scritta la DOMANDA/CONCETTO, qualunque lingua sia.";

  if (safeMode === "continue") {
    return [
      langDirectiveTop,
      "",
      "Continua la spiegazione.",
      "",
      "DOMANDA/CONCETTO: " + query,
      "",
      "TARGET/STILE:",
      targetPrompt,
      "",
      "TESTO GIA DATO (non ripeterlo):",
      "---",
      prev,
      "---",
      "",
      "ISTRUZIONI:",
      langRule,
      "- Continua dal punto esatto in cui si e interrotta.",
      "- Non ripetere introduzioni o sezioni gia fatte.",
      "- Mantieni lo stesso tono e livello del target.",
      "- Chiudi sempre le frasi.",
      "- Termina SEMPRE con una frase conclusiva completa e un punto finale.",
      "- NON terminare con virgola, due punti o connettivi.",
      "- Se stai per finire, fai una frase finale di chiusura e poi STOP.",
      "- Stai entro circa " + budget + " caratteri (massimo " + maxChars + ")."
    ].join("\n");
  }

  return [
    langDirectiveTop,
    "",
    "Spiega il seguente concetto: " + query,
    "",
    "TARGET/STILE:",
    targetPrompt,
    "",
    "ISTRUZIONI:",
    langRule,
    "- Risposta chiara, ben strutturata.",
    "- Usa titoli e liste quando utile.",
    "- Chiudi sempre le frasi.",
    "- Termina SEMPRE con una frase conclusiva completa e un punto finale.",
    "- NON terminare con virgola, due punti o connettivi.",
    "- Se stai per finire, fai una frase finale di chiusura e poi STOP.",
    "- Non iniziare una frase con lettera maiuscola dopo una virgola.",
    "- Stai entro circa " + budget + " caratteri (massimo " + maxChars + ")."
  ].join("\n");
}

async function callGroqSSE(apiKey, prompt, maxTokens) {
  return fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
      max_tokens: maxTokens,
      stream: true,
    }),
  });
}

async function callGroqWithRetry(apiKey, prompt, maxTokens) {
  var MAX_ATTEMPTS = 3;
  var lastError = new Error("Errore sconosciuto");

  for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise(function(resolve) { setTimeout(resolve, 2500 * attempt); });
    }

    var res = await callGroqSSE(apiKey, prompt, maxTokens);
    if (res.ok) return res;

    var errBody = "";
    try { errBody = await res.text(); } catch(e) { errBody = ""; }

    var msg = "Errore upstream (" + res.status + ")";
    try {
      var j = JSON.parse(errBody);
      if (j && j.error && j.error.message) msg = j.error.message;
    } catch(e) {
      if (errBody) msg = msg + ": " + errBody.slice(0, 300);
    }
    lastError = new Error(msg);

    var lower = msg.toLowerCase();
    var retryable = res.status === 429 || res.status >= 500 ||
      lower.indexOf("rate limit") !== -1 ||
      lower.indexOf("overloaded") !== -1 ||
      lower.indexOf("quota") !== -1;

    if (!retryable) break;
  }

  throw lastError;
}

export default async function handler(req) {
  // Chiuse sull'origin di QUESTA richiesta (non stato condiviso a livello di
  // modulo, che sarebbe incorretto con richieste concorrenti sullo stesso
  // isolate edge).
  var origin = req.headers.get("origin");
  function corsHeaders(extra) { return corsHeadersFor(origin, extra); }
  function jsonError(message, status, extra) {
    status = status || 500;
    extra = extra || {};
    return new Response(JSON.stringify({ error: message }), {
      status: status,
      headers: corsHeaders(Object.assign({
        "Content-Type": "application/json; charset=utf-8",
        "X-SimplifAI-API": "groq-proxy",
      }, extra)),
    });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders({ "X-SimplifAI-API": "groq-proxy" }) });
  }
  if (req.method !== "POST") {
    return jsonError("Metodo non consentito. Usa POST.", 405);
  }

  try {
    var apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return jsonError("GROQ_API_KEY mancante su Vercel.", 500);

    var body;
    try { body = await req.json(); } catch(e) { return jsonError("Body JSON non valido.", 400); }

    var query = String((body && body.query) || "").trim();
    var targetPrompt = String((body && body.targetPrompt) || "").trim();
    var mode = body && body.mode;
    var previousText = (body && body.previousText) || "";
    var uiLangRaw = String((body && body.uiLang) || "").toLowerCase();
    var uiLang = (uiLangRaw === "en" || uiLangRaw === "it") ? uiLangRaw : null;

    if (!query || !targetPrompt) return jsonError("Parametri mancanti: query/targetPrompt.", 400);

    var maxTokens = clamp(body && body.maxTokens, 512, 8000, 3500);
    var maxChars = clamp(body && body.maxChars, 500, 50000, 6000);

    var authHeader = req.headers.get("Authorization") || "";
    var creditsRemaining = null;

    if (authHeader.startsWith("Bearer ")) {
      // Utente loggato: i crediti si scalano QUI, prima di spendere un
      // solo token su Groq. targetCost/lengthExtra vengono validati
      // dentro spend_credits() contro i soli valori reali esistenti.
      var user = await getSupabaseUser(authHeader);
      if (!user) return jsonError("Sessione non valida. Rieffettua l'accesso.", 401);

      var targetCost = Number(body && body.targetCost);
      var lengthExtra = Number(body && body.lengthExtra);
      if (![1, 2, 3].includes(targetCost) || ![0, 1].includes(lengthExtra)) {
        return jsonError("Parametri costo non validi.", 400);
      }

      var spend = await spendCredits(authHeader, targetCost, lengthExtra);
      if (!spend.ok) {
        return jsonError(
          spend.insufficient ? "Crediti insufficienti." : "Impossibile verificare i crediti. Riprova.",
          spend.insufficient ? 402 : 401
        );
      }
      creditsRemaining = spend.credits;
    } else {
      // Utente anonimo: limite domande gratuite (solo se Upstash e' collegato).
      var allowed = await checkAnonRateLimit(req);
      if (!allowed) {
        return jsonError("Limite domande gratuite raggiunto. Registrati per continuare.", 429);
      }
    }

    var encoder = new TextEncoder();
    var decoder = new TextDecoder();

    var ts = new TransformStream();
    var readable = ts.readable;
    var writer = ts.writable.getWriter();

    async function emitText(text) {
      var t = String(text || "");
      if (!t) return;
      await writer.write(encoder.encode("data: " + JSON.stringify({ text: t }) + "\n\n"));
    }

    async function closeStream() {
      await writer.write(encoder.encode("data: [DONE]\n\n"));
      try { await writer.close(); } catch(e) {}
    }

    async function runRound(roundMode, currentText) {
      var prompt = buildPrompt(query, targetPrompt, roundMode, currentText, maxChars, uiLang);
      var upstream = await callGroqWithRetry(apiKey, prompt, maxTokens);

      if (!upstream.body) throw new Error("Upstream body nullo.");

      var reader = upstream.body.getReader();
      var buffer = "";
      var roundText = "";

      async function processBlock(block) {
        var lines = block.split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith("data:")) continue;
          var data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          var parsed;
          try { parsed = JSON.parse(data); } catch(e) { continue; }

          var delta = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
          var chunk = (delta && delta.content) ? String(delta.content) : "";
          if (!chunk) continue;

          roundText += chunk;
          await emitText(chunk);
        }
      }

      while (true) {
        var result = await reader.read();
        if (result.done) break;

        buffer += decoder.decode(result.value, { stream: true });
        var blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";

        for (var i = 0; i < blocks.length; i++) {
          if (blocks[i].trim()) await processBlock(blocks[i]);
        }
      }
      if (buffer.trim()) await processBlock(buffer);

      return roundText;
    }

    (async function() {
      try {
        await runRound("start", "");
        await closeStream();
      } catch(e) {
        await emitText("Errore: " + ((e && e.message) ? e.message : "sconosciuto"));
        await closeStream();
      }
    })();

    return new Response(readable, {
      status: 200,
      headers: corsHeaders(Object.assign({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-SimplifAI-API": "groq-proxy",
      }, creditsRemaining !== null ? { "X-Credits-Remaining": String(creditsRemaining) } : {})),
    });
  } catch(e) {
    return jsonError((e && e.message) || "Errore sconosciuto", 500);
  }
}
