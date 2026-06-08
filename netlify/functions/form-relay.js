// netlify/functions/form-relay.js
// Receives every non-payment site form (contact, consultation, custom soap order,
// manual order, email capture) and emails BOTH admins via Resend — no Zapier needed.
// Also sends the visitor a warm branded acknowledgment when an email is provided.
const { json, ADMIN_EMAILS, esc, brandWrap, resendSend } = require("./_shared");

const LABELS = {
  contact: "Contact Message",
  consultation: "Free Consultation Request",
  "soap-order": "Custom Soap Order",
  order: "Manual Order",
  "email-capture": "Free Guide / Email Signup",
};

const ACKS = {
  contact: "✦ Message received! Amber will reply within 1–2 business days.",
  consultation: "✦ Your consultation request is received. Amber will respond within 24–48 hours with your personalized guidance.",
  "soap-order": "✦ Your custom soap request is received! Amber will confirm details before crafting your bar.",
  order: "✦ Order received! Amber will be in touch to confirm and prepare your items.",
  "email-capture": "✦ Your free guide is on its way — check your inbox.",
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json({ error: "Method Not Allowed" }, 405);
  try {
    const data = JSON.parse(event.body || "{}");
    const formType = String(data.formType || "contact");
    delete data.formType;

    const rows = Object.entries(data)
      .filter(([k, v]) => v != null && String(v).trim() !== "" && k !== "_honey")
      .map(([k, v]) => `<tr>
        <td style="padding:6px 12px 6px 0;color:#c9a84c;vertical-align:top;text-transform:capitalize">${esc(k.replace(/[_-]/g, " "))}</td>
        <td style="padding:6px 0;color:#d4c8b0">${esc(Array.isArray(v) ? v.join(", ") : v)}</td></tr>`)
      .join("");

    await resendSend({
      to: ADMIN_EMAILS,
      subject: `✦ ${LABELS[formType] || "Website Form"} — ${data.name || data.email || "New submission"}`,
      html: brandWrap(LABELS[formType] || "New Website Submission", `
        <p style="color:#d4c8b0">A new ${esc(LABELS[formType] || "form")} submission arrived from awakenagain.com:</p>
        <table style="width:100%;border-collapse:collapse;margin-top:12px">${rows}</table>`),
      replyTo: data.email || undefined,
    });

    if (data.email && /@/.test(data.email)) {
      await resendSend({
        to: data.email,
        subject: "✦ We received your message — Amber's Alchemy Apothecary",
        html: brandWrap("Thank You ✦", `<p style="color:#d4c8b0;line-height:1.8">${esc(ACKS[formType] || ACKS.contact)}</p>
          <p style="color:#b8a07a;font-size:13px">With botanical care,<br>Amber</p>`),
      });
    }

    return json({ ok: true });
  } catch (err) {
    console.error("form-relay error:", err);
    return json({ ok: false, error: "Could not send right now. Please email awaken@consultant.com." }, 500);
  }
};
