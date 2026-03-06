export const config = { runtime: "edge" };

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default async function handler(req) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonResp({ error: "GEMINI_API_KEY non configurata su Vercel." }, 500);
  }

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    const data = await r.json();

    if (!r.ok || data?.error) {
      return jsonResp({ error: data?.error?.message || `HTTP ${r.status}` }, 500);
    }

    const names = (data.models || []).map(m => m.name);
    return jsonResp({ models: names });
  } catch (e) {
    return jsonResp({ error: e?.message || "Errore interno" }, 500);
  }
}
