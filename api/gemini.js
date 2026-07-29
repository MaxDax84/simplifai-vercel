// NOTA: questo file usa Groq (llama-3.3-70b-versatile) ma mantiene il nome
// "gemini.js" per non cambiare i riferimenti nell'HTML. Chiave env: GROQ_API_KEY.

export const config = { runtime: "edge" };

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

function corsHeaders(extra) {
  extra = extra || {};
  return Object.assign({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }, extra);
}

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

    var encoder = new TextEncoder();
    var decoder = new TextDecoder();

    var ts = new TransformStream();
    var readable = ts.readable;
    var writer = ts.writable.getWriter();

    async function emitText(text) {
      var t = String(text || "");
      if (!t) return;
      // Emette nel formato Gemini che app.html si aspetta
      var json = { candidates: [{ content: { parts: [{ text: t }] } }] };
      await writer.write(encoder.encode("data: " + JSON.stringify(json) + "\n\n"));
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
      headers: corsHeaders({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-SimplifAI-API": "groq-proxy",
      }),
    });
  } catch(e) {
    return jsonError((e && e.message) || "Errore sconosciuto", 500);
  }
}
