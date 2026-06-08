// netlify/functions/_shared.js
// Shared helpers for Awaken Again serverless functions:
// JSON responses, money formatting, HTML escaping, Resend email sending,
// a branded "enchanted apothecary" email wrapper, and the admin recipient list.
// No secrets are hardcoded — everything comes from environment variables.

const ADMIN_EMAILS = [
  process.env.ADMIN_EMAIL_1 || "awaken@consultant.com",
  process.env.ADMIN_EMAIL_2 || "dare2be4ree@gmail.com",
].filter(Boolean);

const FROM_EMAIL = process.env.FROM_EMAIL || "hello@awakenagain.com";
const SITE = process.env.SITE_URL || "https://awakenagain.com";

// Supabase service-role client (server-side only; bypasses RLS).
function getSupabase() {
  const { createClient } = require("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function json(obj, statusCode = 200, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(obj),
  };
}

function money(cents) {
  const n = Number(cents || 0) / 100;
  return `$${n.toFixed(2)}`;
}

function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Magical, warm, professional email shell shared by every customer + admin email.
function brandWrap(title, innerHtml, opts = {}) {
  const preheader = opts.preheader ? `<span style="display:none;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(opts.preheader)}</span>` : "";
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0f0b18;">
  ${preheader}
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:620px;margin:0 auto;background:linear-gradient(180deg,#1a0f2e 0%,#150b26 100%);color:#f4e8d0;border:1px solid rgba(201,168,76,0.25);border-radius:16px;overflow:hidden">
    <div style="text-align:center;padding:28px 24px 8px">
      <div style="letter-spacing:3px;font-size:11px;color:#c9a84c;text-transform:uppercase">Awaken With Amber</div>
      <div style="font-size:22px;color:#e8cc80;margin-top:6px">Amber's Alchemy Apothecary</div>
      <div style="color:#8a7a65;font-size:13px;margin-top:4px">✦ &nbsp; ✦ &nbsp; ✦</div>
    </div>
    <div style="padding:8px 32px 8px">
      <h1 style="color:#d4af37;text-align:center;font-size:22px;font-weight:normal;margin:14px 0 18px">${esc(title)}</h1>
      ${innerHtml}
    </div>
    <div style="border-top:1px solid rgba(201,168,76,0.2);margin-top:18px;padding:18px 32px 28px;text-align:center;color:#8a7a65;font-size:12px;line-height:1.7">
      Amber's Alchemy Apothecary · <a href="${SITE}" style="color:#c9a84c;text-decoration:none">awakenagain.com</a><br>
      ✦ These statements have not been evaluated by the FDA. Products are not intended to diagnose, treat, cure, or prevent any disease. ✦
    </div>
  </div></body></html>`;
}

async function resendSend({ to, bcc, subject, html, replyTo, attachments }) {
  const key = process.env.RESEND_API_KEY;
  const toList = Array.isArray(to) ? to : [to];
  if (!key) {
    console.error("RESEND_API_KEY missing — email not sent:", subject, "->", toList.join(", "));
    return { ok: false, error: "RESEND_API_KEY missing" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Amber's Alchemy Apothecary <${FROM_EMAIL}>`,
        to: toList,
        bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
        reply_to: replyTo || ADMIN_EMAILS[0],
        subject,
        html,
        attachments: attachments && attachments.length ? attachments : undefined,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("Resend failed:", res.status, text);
      return { ok: false, error: text };
    }
    return { ok: true };
  } catch (err) {
    console.error("Resend threw:", err);
    return { ok: false, error: err.message };
  }
}

// Stripe metadata values are capped at 500 chars. These helpers split a long
// string across numbered keys (order_meta_0, order_meta_1, ...) and rejoin it.
function chunkToMetadata(prefix, str, max = 480, maxKeys = 40) {
  const out = {};
  const s = String(str || "");
  for (let i = 0, k = 0; i < s.length && k < maxKeys; i += max, k++) {
    out[`${prefix}_${k}`] = s.slice(i, i + max);
  }
  return out;
}
function joinFromMetadata(prefix, metadata = {}) {
  let parts = [];
  for (let k = 0; k < 60; k++) {
    const v = metadata[`${prefix}_${k}`];
    if (v == null) break;
    parts.push(v);
  }
  return parts.join("");
}

module.exports = {
  ADMIN_EMAILS,
  FROM_EMAIL,
  SITE,
  json,
  money,
  esc,
  brandWrap,
  resendSend,
  chunkToMetadata,
  joinFromMetadata,
  getSupabase,
};
