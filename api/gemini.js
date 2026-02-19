export default async function handler(req, res) {
  // CORS base
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito. Usa POST." });
  }

  // ---- SSE verso il browser ----
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // a volte aiuta contro buffering proxy
  res.setHeader("X-Accel-Buffering", "no");

  if (typeof res.flushHeaders === "function") res.flushHeaders();
  // ping iniziale per forzare flush
  res.write(`:ok\n\n`);

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      send({ type: "error", error: "GEMINI_API_KEY mancante su Vercel." });
      return res.end();
    }

    const {
      query,
      targetLabel,
      targetPrompt,
      maxTokens,
      maxChars,
      mode,           // "start" | "continue"
      previousText
    } = req.body || {};

    if (!query || !targetPrompt) {
      send({ type: "error", error: "Parametri mancanti (query/targetPrompt)." });
      return res.end();
    }

    // Limiti safe
    const tokens = Math.min(Math.max(Number(maxTokens) || 1200, 256), 8000);
    const charsLimit = Math.min(Math.max(Number(maxChars) || 4000, 500), 50000);

    const safeMode = (mode === "continue") ? "continue" : "start";
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

    // ✅ Stream SSE da Gemini (alt=sse)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: tokens
        }
      })
    });

    if (!upstream.ok) {
      let msg = `Errore API (${upstream.status})`;
      try {
        const j = await upstream.json();
        msg = j?.error?.message || msg;
      } catch {}
      send({ type: "error", error: msg });
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buf = "";
    let accumulated = "";
    let lastModelText = "";
    let abortedForLimit = false;

    const extractText = (obj) => {
      const parts = obj?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) return "";
      return parts.map(p => (typeof p?.text === "string" ? p.text : "")).join("");
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });

      // SSE events separati da \n\n
      const events = buf.split("\n\n");
      buf = events.pop() || "";

      for (const evt of events) {
        const lines = evt.split("\n").map(l => l.trim());
        const dataLines = lines.filter(l => l.startsWith("data:"));
        for (const dl of dataLines) {
          const jsonStr = dl.slice(5).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          let obj;
          try {
            obj = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          const modelText = extractText(obj);
          if (!modelText) continue;

          // delta robusto
          let delta = modelText;
          if (modelText.startsWith(lastModelText)) {
            delta = modelText.slice(lastModelText.length);
          }
          lastModelText = modelText;

          if (!delta) continue;

          // enforce maxChars
          const remaining = charsLimit - accumulated.length;
          if (remaining <= 0) {
            abortedForLimit = true;
            break;
          }

          let toSend = delta;
          if (toSend.length > remaining) {
            toSend = toSend.slice(0, remaining);
            abortedForLimit = true;
          }

          accumulated += toSend;
          send({ type: "chunk", text: toSend });

          if (accumulated.trimEnd().endsWith("...(continua)")) {
            abortedForLimit = true;
            break;
          }
        }
        if (abortedForLimit) break;
      }
      if (abortedForLimit) break;
    }

    let out = String(accumulated).trimEnd();

    const endsWithMarker = out.endsWith("...(continua)");
    const endsNicely = /[.!?…]"?\s*$/.test(out);
    const nearLimit = out.length >= Math.floor(charsLimit * 0.92);

    let needsContinue = endsWithMarker || nearLimit || !endsNicely || abortedForLimit;

    if (needsContinue && !endsWithMarker) {
      const marker = "\n\n...(continua)";
      if (out.length + marker.length <= charsLimit) {
        out += marker;
        send({ type: "chunk", text: marker });
      }
    }

    send({
      type: "done",
      needsContinue,
      used: { maxTokens: tokens, maxChars: charsLimit },
      target: targetLabel || "",
      mode: safeMode
    });

    return res.end();
  } catch (e) {
    send({ type: "error", error: e?.message || "Errore sconosciuto" });
    return res.end();
  }
}
