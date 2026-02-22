export const config = { runtime: "edge" };

function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const body = await req.json();
    const { query, targetPrompt, maxTokens, mode, previousText } = body || {};

    let prompt = "";
    if (mode === "start") {
      prompt = `Sei un esperto di semplificazione. ${targetPrompt}\n\nDomanda: ${query}\n\nIMPORTANTE: Se la spiegazione è lunga, interrompi a metà frase e scrivi esattamente " ...(continua)" alla fine.`;
    } else {
      prompt = `TESTO PRECEDENTE:\n"""\n${previousText}\n"""\n\nContinua la spiegazione esattamente da dove si è interrotta. NON ripetere nulla di quanto già scritto. Se serve ancora spazio, scrivi di nuovo " ...(continua)" alla fine.`;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.7, 
          maxOutputTokens: maxTokens || 1000 
        },
      }),
    });

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return jsonError(e.message);
  }
}
