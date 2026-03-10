/**
 * api/send-email.js – Vercel Edge Function
 *
 * Gestisce l'invio di email transazionali via Resend:
 *   - "welcome"  → email di benvenuto con crediti omaggio
 *   - "purchase" → conferma acquisto pacchetto crediti
 *
 * La richiesta deve includere un JWT Supabase valido nell'header
 * Authorization: Bearer <token>
 * per identificare l'utente destinatario.
 */

export const config = { runtime: "edge" };

// ── Costanti ──────────────────────────────────────────────────────────────────

const RESEND_API     = "https://api.resend.com/emails";
const FROM           = "Simplif-AI <info@simplif-ai.it>";
const APP_URL        = "https://simplif-ai.it";
const SUPABASE_URL   = "https://lmmiowagyqypdrdcemdo.supabase.co";
const SUPABASE_ANON  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtbWlvd2FneXF5cGRyZGNlbWRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODg3NDQsImV4cCI6MjA4ODM2NDc0NH0.0DJYe_MFImUsRIrrAtJOY2Jkua-wDCFPOLC-MCkdvoc";

// ── CORS ──────────────────────────────────────────────────────────────────────

function cors(extra) {
  return Object.assign({
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }, extra || {});
}

function jsonRes(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: cors({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

// ── Auth: verifica JWT Supabase ───────────────────────────────────────────────

async function getSupabaseUser(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
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

// ── Template: email di benvenuto ──────────────────────────────────────────────

function welcomeHtml(nome, credits) {
  var displayName = nome || "utente";
  var creditsText = credits > 0 ? credits + " crediti omaggio" : "account attivato";
  var creditsLabel = credits > 0
    ? "<strong style='color:#7c5cff;'>⚡ " + credits + " crediti omaggio</strong> da usare subito."
    : "Il tuo account è pronto. Inizia subito!";

  return "<!DOCTYPE html><html lang='it'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Benvenuto su Simplif-AI</title></head>"
    + "<body style='margin:0;padding:0;background:#eef0ff;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;'>"
    + "<div style='max-width:580px;margin:0 auto;padding:32px 16px;'>"

    // Logo
    + "<div style='text-align:center;margin-bottom:24px;'>"
    + "<table cellpadding='0' cellspacing='0' style='margin:0 auto;'><tr>"
    + "<td style='width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#7c5cff,#26c6ff);'></td>"
    + "<td style='padding-left:10px;font-size:20px;font-weight:900;color:#0d1133;vertical-align:middle;'>Simplif-AI</td>"
    + "</tr></table></div>"

    // Card principale
    + "<div style='background:#fff;border-radius:20px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.08);'>"
    + "<h1 style='margin:0 0 10px;font-size:26px;font-weight:900;color:#0d1133;'>Benvenuto, " + displayName + "! 🎉</h1>"
    + "<p style='color:#555;font-size:15px;margin:0 0 24px;line-height:1.6;'>" + creditsLabel + "</p>"

    // Credits badge (solo se crediti > 0)
    + (credits > 0
        ? "<div style='background:linear-gradient(135deg,rgba(124,92,255,.09),rgba(38,198,255,.09));border:1px solid rgba(124,92,255,.28);border-radius:14px;padding:18px 20px;margin-bottom:28px;text-align:center;'>"
          + "<div style='font-size:36px;font-weight:900;color:#7c5cff;'>⚡ " + credits + " crediti</div>"
          + "<p style='color:#777;font-size:13px;margin:6px 0 0;'>Validi 12 mesi dalla data di registrazione</p>"
          + "</div>"
        : "")

    // Come funziona
    + "<h2 style='font-size:15px;font-weight:900;color:#0d1133;margin:0 0 16px;border-bottom:1px solid #eee;padding-bottom:10px;'>Come funziona Simplif-AI</h2>"
    + "<table cellpadding='0' cellspacing='0' width='100%' style='margin-bottom:28px;'>"
    + row("💬", "Fai una domanda", "Su qualsiasi argomento: scienza, storia, economia, medicina e molto altro.")
    + row("🎯", "Scegli il livello", "Da &ldquo;Spiegami come a un bambino&rdquo; fino al rigore tecnico da ricercatore.")
    + row("⚡", "1–4 crediti per risposta", "Il costo dipende dalla complessità del target e dalla lunghezza richiesta.")
    + row("📄", "Scarica il PDF", "Puoi esportare ogni risposta in PDF per studiarla o condividerla.")
    + "</table>"

    // CTA
    + "<a href='" + APP_URL + "/app.html' style='display:block;text-align:center;background:linear-gradient(135deg,#7c5cff,#26c6ff);color:#0b1020;font-weight:900;font-size:16px;padding:16px 24px;border-radius:14px;text-decoration:none;'>🚀 Inizia a esplorare →</a>"
    + "</div>"

    // Footer
    + "<p style='text-align:center;color:#aaa;font-size:12px;margin-top:24px;line-height:1.6;'>"
    + "© 2025 Simplif-AI &nbsp;·&nbsp; "
    + "<a href='" + APP_URL + "/privacy-policy.html' style='color:#aaa;'>Privacy Policy</a> &nbsp;·&nbsp; "
    + "<a href='" + APP_URL + "/contatti.html' style='color:#aaa;'>Contatti</a>"
    + "</p>"

    + "</div></body></html>";
}

function row(icon, title, desc) {
  return "<tr><td style='width:36px;font-size:22px;vertical-align:top;padding:0 12px 14px 0;'>" + icon + "</td>"
    + "<td style='vertical-align:top;padding-bottom:14px;'>"
    + "<strong style='font-size:14px;color:#0d1133;display:block;margin-bottom:2px;'>" + title + "</strong>"
    + "<span style='font-size:13px;color:#777;line-height:1.5;'>" + desc + "</span>"
    + "</td></tr>";
}

// ── Template: conferma acquisto ───────────────────────────────────────────────

function purchaseHtml(nome, pkg) {
  var displayName = nome || "utente";
  var expiryDate  = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);
  var expiryStr = expiryDate.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });

  return "<!DOCTYPE html><html lang='it'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Acquisto confermato – Simplif-AI</title></head>"
    + "<body style='margin:0;padding:0;background:#eef0ff;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;'>"
    + "<div style='max-width:580px;margin:0 auto;padding:32px 16px;'>"

    // Logo
    + "<div style='text-align:center;margin-bottom:24px;'>"
    + "<table cellpadding='0' cellspacing='0' style='margin:0 auto;'><tr>"
    + "<td style='width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#7c5cff,#26c6ff);'></td>"
    + "<td style='padding-left:10px;font-size:20px;font-weight:900;color:#0d1133;vertical-align:middle;'>Simplif-AI</td>"
    + "</tr></table></div>"

    // Card
    + "<div style='background:#fff;border-radius:20px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.08);'>"
    + "<div style='text-align:center;margin-bottom:24px;'>"
    + "<div style='font-size:48px;'>✅</div>"
    + "<h1 style='margin:12px 0 6px;font-size:24px;font-weight:900;color:#0d1133;'>Acquisto confermato!</h1>"
    + "<p style='color:#777;font-size:14px;margin:0;'>Grazie, " + displayName + ". I crediti sono già sul tuo account.</p>"
    + "</div>"

    // Riepilogo
    + "<div style='background:#f7f8ff;border:1px solid #e0e3ff;border-radius:14px;padding:20px;margin-bottom:24px;'>"
    + "<h2 style='margin:0 0 14px;font-size:14px;font-weight:900;color:#0d1133;text-transform:uppercase;letter-spacing:.5px;'>Riepilogo acquisto</h2>"
    + detailRow("📦 Pacchetto",  pkg.label)
    + detailRow("⚡ Crediti",    "+" + pkg.credits + " crediti")
    + detailRow("💰 Importo",    pkg.price)
    + detailRow("📅 Validità",   "Fino al " + expiryStr)
    + "</div>"

    // Info crediti
    + "<div style='background:rgba(124,92,255,.06);border:1px solid rgba(124,92,255,.2);border-radius:12px;padding:14px 16px;margin-bottom:24px;'>"
    + "<p style='margin:0;font-size:13px;color:#555;line-height:1.6;'>💡 I crediti si accumulano: ogni nuova ricarica estende la validità dell'intero saldo di altri 12 mesi. Non perderai mai i crediti già acquistati.</p>"
    + "</div>"

    // CTA
    + "<a href='" + APP_URL + "/app.html' style='display:block;text-align:center;background:linear-gradient(135deg,#7c5cff,#26c6ff);color:#0b1020;font-weight:900;font-size:16px;padding:16px 24px;border-radius:14px;text-decoration:none;'>Usa i tuoi crediti ora →</a>"
    + "</div>"

    // Footer
    + "<p style='text-align:center;color:#aaa;font-size:12px;margin-top:24px;line-height:1.6;'>"
    + "© 2025 Simplif-AI &nbsp;·&nbsp; "
    + "<a href='" + APP_URL + "/privacy-policy.html' style='color:#aaa;'>Privacy Policy</a> &nbsp;·&nbsp; "
    + "<a href='" + APP_URL + "/contatti.html' style='color:#aaa;'>Contatti</a>"
    + "</p>"
    + "</div></body></html>";
}

function detailRow(label, value) {
  return "<table cellpadding='0' cellspacing='0' width='100%' style='margin-bottom:10px;'><tr>"
    + "<td style='font-size:13px;color:#777;'>" + label + "</td>"
    + "<td style='font-size:14px;font-weight:700;color:#0d1133;text-align:right;'>" + value + "</td>"
    + "</tr></table>";
}

// ── Handler principale ────────────────────────────────────────────────────────

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: cors() });
  }
  if (req.method !== "POST") {
    return jsonRes({ error: "Metodo non consentito." }, 405);
  }

  var apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return jsonRes({ error: "RESEND_API_KEY non configurata." }, 500);

  // Verifica autenticazione
  var authHeader = req.headers.get("Authorization") || "";
  var user = await getSupabaseUser(authHeader);
  if (!user) return jsonRes({ error: "Non autenticato." }, 401);

  var body;
  try { body = await req.json(); } catch (e) { return jsonRes({ error: "Body non valido." }, 400); }

  var type  = body && body.type;
  var email = user.email;

  // Recupera nome dal profilo Supabase
  var nome = "";
  try {
    var profileRes = await fetch(SUPABASE_URL + "/rest/v1/profiles?id=eq." + user.id + "&select=nome", {
      headers: { "apikey": SUPABASE_ANON, "Authorization": authHeader },
    });
    var profileData = await profileRes.json();
    nome = (profileData && profileData[0] && profileData[0].nome) || "";
  } catch (e) { /* non bloccante */ }

  var subject, html;

  if (type === "welcome") {
    var credits = Number(body.credits) || 0;
    subject = credits > 0
      ? "🎉 Benvenuto su Simplif-AI – I tuoi " + credits + " crediti omaggio ti aspettano!"
      : "🎉 Benvenuto su Simplif-AI!";
    html = welcomeHtml(nome, credits);

  } else if (type === "purchase") {
    var pkg = body.pkg;
    if (!pkg || !pkg.label || !pkg.credits || !pkg.price) {
      return jsonRes({ error: "Dati pacchetto mancanti." }, 400);
    }
    subject = "✅ Acquisto confermato – " + pkg.credits + " crediti aggiunti al tuo account";
    html = purchaseHtml(nome, pkg);

  } else {
    return jsonRes({ error: "Tipo email non supportato: " + type }, 400);
  }

  // Invia via Resend
  var resendRes = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ from: FROM, to: email, subject: subject, html: html }),
  });

  if (!resendRes.ok) {
    var errText = await resendRes.text();
    return jsonRes({ error: "Resend error: " + errText }, 502);
  }

  return jsonRes({ ok: true });
}
