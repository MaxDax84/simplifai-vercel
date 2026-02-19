export default async function handler(req, res) {
  // CORS base
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito. Usa POST." });
  }

  // Helper: invia evento SSE
  const sendEvent = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

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

    // Attiva streaming verso il browser (SSE)
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    // flush headers (su alcune piattaforme aiuta)
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    // Chiamiamo l'endpoint streaming di Gemini
    // Nota: endpoint streamGenerateContent
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${apiKey}`;

    const controller = new AbortController();

    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: tokens
        }
      })
    });

    if (!upstream.ok) {
      let errMsg = `Errore API (${upstream.status})`;
      try {
        const j = await upstream.json();
        errMsg = j?.error?.message || errMsg;
      } catch {}
      sendEvent({ type: "error", error: errMsg });
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buffer = "";
    let accumulated = "";     // testo totale che mandiamo al client
    let lastModelText = "";   // testo "totale" visto dal modello (per calcolare delta se serve)
    let abortedForLimit = false;

    // Parsing robusto: l'endpoint spesso manda JSON separati da newline
    const extractTextsFromJson = (obj) => {
      // obj: { candidates: [ { content: { parts: [{text:"..."}] } } ] }
      const parts = obj?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) return "";
      return parts.map(p => (typeof p?.text === "string" ? p.text : "")).join("");
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Di solito sono JSON objects separati da "\n"
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Alcuni stream prefissano con "data:"
        const jsonStr = trimmed.startsWith("data:")
          ? trimmed.slice(5).trim()
          : trimmed;

        // A volte arriva "[DONE]"
        if (jsonStr === "[DONE]") continue;

        let obj;
        try {
          obj = JSON.parse(jsonStr);
        } catch {
          // Se non è JSON completo, lo rimettiamo in buffer
          buffer = jsonStr + "\n" + buffer;
          continue;
        }

        const modelText = extractTextsFromJson(obj);
        if (!modelText) continue;

        // Alcuni stream inviano "testo totale finora", altri delta.
        // Qui calcoliamo un delta robusto:
        let delta = modelText;

        if (modelText.startsWith(lastModelText)) {
          delta = modelText.slice(lastModelText.length);
        } else if (lastModelText && lastModelText.includes(modelText)) {
          // caso strano: regressione, ignora
          delta = "";
        }
        lastModelText = modelText;

        if (!delta) continue;

        // Enforce maxChars in streaming
        const remaining = charsLimit - accumulated.length;
        if (remaining <= 0) {
          abortedForLimit = true;
          controller.abort();
          break;
        }

        // Taglia delta se supera limite residuo
        let toSend = delta;
        if (toSend.length > remaining) {
          toSend = toSend.slice(0, remaining);
          abortedForLimit = true;
          controller.abort();
        }

        accumulated += toSend;

        // manda chunk al client
        sendEvent({ type: "chunk", text: toSend });

        // Se abbiamo già “...(continua)” possiamo fermarci presto
        if (accumulated.trimEnd().endsWith("...(continua)")) {
          abortedForLimit = true;
          controller.abort();
          break;
        }
      }

      if (abortedForLimit) break;
    }

    // Post-processing: marker e needsContinue
    let out = String(accumulated).trimEnd();

    const endsWithMarker = out.endsWith("...(continua)");
    const endsNicely = /[.!?…]"?\s*$/.test(out);
    const nearLimit = out.length >= Math.floor(charsLimit * 0.92);

    let needsContinue = endsWithMarker || nearLimit || !endsNicely || abortedForLimit;

    // Se deve continuare e non ha marker, aggiungilo (ma manda come chunk finale)
    if (needsContinue && !endsWithMarker) {
      const marker = "\n\n...(continua)";
      // rispetta maxChars
      if (out.length + marker.length <= charsLimit) {
        out += marker;
        sendEvent({ type: "chunk", text: marker });
      } else {
        // se non c'è spazio, almeno garantiamo needsContinue
      }
    }

    sendEvent({
      type: "done",
      needsContinue,
      used: { maxTokens: tokens, maxChars: charsLimit },
      target: targetLabel || "",
      mode: safeMode
    });

    return res.end();
  } catch (e) {
    try {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ type: "error", error: e?.message || "Errore sconosciuto" })}\n\n`);
      return res.end();
    } catch {
      return res.status(500).json({ error: e?.message || "Errore sconosciuto" });
    }
  }
}
