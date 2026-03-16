export const config = { runtime: "edge" };

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
      "X-SimplifAI-API": "gemini-proxy",
    }, extra)),
  });
}

function clamp(n, min, max, fallback) {
  var x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(Math.max(x, min), max);
}

var ADULT_RE = /\b(porno|pornografi[a-z]*|sess(?:o|uale|ualit[aà])|rapporto\s+sessuale|rapporti\s+sessuali|orgasmo|masturbazion[a-z]*|masturbars[a-z]*|eiaculazion[a-z]*|pene\b|vagina|clitoride|vulva|erezione|genitali|prostituzion[a-z]*|prostitut[oa]|escort|bordello|squillo|stupro|violenza\s+sessuale|nudit[aà]|erotic[oa]|bdsm|bondage|feticismo|intercourse|porn\b|xxx)\b/i;

var MINOR_BLOCK_MSG = "## Contenuto non disponibile\n\nQuesto argomento non è accessibile per gli account under 18.\nSe hai domande puoi contattarci all'indirizzo info@simplif-ai.it.";

function buildPrompt(query, targetPrompt, mode, previousText, maxChars) {
  var safeMode = mode === "continue" ? "continue" : "start";
  var prev = String(previousText || "").slice(0, 24000);
  var budget = Math.max(1400, Math.floor(maxChars * 0.9));

  if (safeMode === "continue") {
    return [
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
    "Spiega il seguente concetto: " + query,
    "",
    "TARGET/STILE:",
    targetPrompt,
    "",
    "ISTRUZIONI:",
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

async function callGeminiSSE(apiKey, prompt, maxTokens) {
  var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent" +
    "?alt=sse&key=" + apiKey;

  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: maxTokens },
    }),
  });
}

async function callGeminiWithRetry(apiKey, prompt, maxTokens) {
  var MAX_ATTEMPTS = 3;
  var lastError = new Error("Errore sconosciuto");

  for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise(function(resolve) { setTimeout(resolve, 2500 * attempt); });
    }

    var res = await callGeminiSSE(apiKey, prompt, maxTokens);
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
      lower.indexOf("high demand") !== -1 ||
      lower.indexOf("overloaded") !== -1 ||
      lower.indexOf("quota") !== -1;

    if (!retryable) break;
  }

  throw lastError;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders({ "X-SimplifAI-API": "gemini-proxy" }) });
  }
  if (req.method !== "POST") {
    return jsonError("Metodo non consentito. Usa POST.", 405);
  }

  try {
    var apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return jsonError("GEMINI_API_KEY mancante su Vercel.", 500);

    var body;
    try { body = await req.json(); } catch(e) { return jsonError("Body JSON non valido.", 400); }

    var query = String((body && body.query) || "").trim();
    var targetPrompt = String((body && body.targetPrompt) || "").trim();
    var mode = body && body.mode;
    var previousText = (body && body.previousText) || "";
    var isMinor = body && body.isMinor === true;

    if (!query || !targetPrompt) return jsonError("Parametri mancanti: query/targetPrompt.", 400);

    /* Blocco contenuti sensibili per utenti minorenni */
    if (isMinor && ADULT_RE.test(query)) {
      var encoder0 = new TextEncoder();
      var ts0 = new TransformStream();
      var writer0 = ts0.writable.getWriter();
      (async function() {
        var json0 = { candidates: [{ content: { parts: [{ text: MINOR_BLOCK_MSG }] } }] };
        await writer0.write(encoder0.encode("data: " + JSON.stringify(json0) + "\n\n"));
        await writer0.write(encoder0.encode("data: [DONE]\n\n"));
        try { await writer0.close(); } catch(e) {}
      })();
      return new Response(ts0.readable, {
        status: 200,
        headers: corsHeaders({
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-SimplifAI-API": "gemini-proxy",
        }),
      });
    }

    var maxTokens = clamp(body && body.maxTokens, 512, 20000, 3500);
    var maxChars = clamp(body && body.maxChars, 500, 50000, 6000);

    var encoder = new TextEncoder();
    var decoder = new TextDecoder();

    var ts = new TransformStream();
    var readable = ts.readable;
    var writer = ts.writable.getWriter();

    async function emitText(text) {
      var t = String(text || "");
      if (!t) return;
      var json = { candidates: [{ content: { parts: [{ text: t }] } }] };
      await writer.write(encoder.encode("data: " + JSON.stringify(json) + "\n\n"));
    }

    async function closeStream() {
      await writer.write(encoder.encode("data: [DONE]\n\n"));
      try { await writer.close(); } catch(e) {}
    }

    async function runRound(roundMode, currentText) {
      var prompt = buildPrompt(query, targetPrompt, roundMode, currentText, maxChars);
      var upstream = await callGeminiWithRetry(apiKey, prompt, maxTokens);

      if (!upstream.body) throw new Error("Upstream body nullo.");

      var reader = upstream.body.getReader();
      var buffer = "";
      var roundText = "";

      async function processBlock(block) {
        var lines = block.split(/\r?\n/);
        var dataLines = lines.filter(function(l) { return l.startsWith("data:"); })
                             .map(function(l) { return l.slice(5).trim(); });
        if (!dataLines.length) return;

        var data = dataLines.join("\n");
        if (!data || data === "[DONE]") return;

        var parsed;
        try { parsed = JSON.parse(data); } catch(e) { return; }

        var candidates = parsed && parsed.candidates;
        var parts = candidates && candidates[0] && candidates[0].content && candidates[0].content.parts;
        if (!Array.isArray(parts)) return;

        var chunk = parts.map(function(p) { return (p && p.text) ? String(p.text) : ""; }).join("");
        if (!chunk) return;

        roundText += chunk;
        await emitText(chunk);
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
        "X-SimplifAI-API": "gemini-proxy",
      }),
    });
  } catch(e) {
    return jsonError((e && e.message) || "Errore sconosciuto", 500);
  }
}
