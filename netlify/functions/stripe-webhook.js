// netlify/functions/stripe-webhook.js
// Handles Stripe events:
//  • checkout.session.completed (payment)      → admin order email (both) + customer THANK-YOU email
//  • checkout.session.completed (subscription) → Supabase active + magic-link welcome + admin notify
//  • customer.subscription.deleted             → Supabase status = inactive (revoke access)
//  • invoice.payment_failed                    → Supabase status = inactive
//  • invoice.payment_succeeded (renewals)      → renewal confirmation email
// MUST use the raw body for signature verification.

const Stripe = require("stripe");
const {
  ADMIN_EMAILS, SITE, money, esc, brandWrap, resendSend, joinFromMetadata, getSupabase,
} = require("./_shared");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

exports.handler = async (event) => {
  let stripeEvent;
  try {
    const sig = event.headers["stripe-signature"];
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body, "utf8");
    stripeEvent = stripe.webhooks.constructEvent(raw, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const session = await stripe.checkout.sessions.retrieve(stripeEvent.data.object.id, {
          expand: ["line_items", "shipping_cost.shipping_rate", "customer_details", "total_details"],
        });
        if (session.mode === "subscription" || session.metadata?.type === "grimoire_subscription") {
          await handleSubscriptionStarted(session);
        } else {
          await sendOrderEmails(session);
        }
        break;
      }
      case "customer.subscription.deleted":
        await setSubscriberStatus({ subscriptionId: stripeEvent.data.object.id, customerId: stripeEvent.data.object.customer }, "inactive");
        break;
      case "invoice.payment_failed":
        await setSubscriberStatus({ customerId: stripeEvent.data.object.customer, email: stripeEvent.data.object.customer_email }, "inactive");
        break;
      case "invoice.payment_succeeded":
        // Skip the very first invoice (handled by the welcome email); only confirm true renewals.
        if (stripeEvent.data.object.billing_reason === "subscription_cycle") {
          await sendRenewalEmail(stripeEvent.data.object);
        }
        break;
      default:
        break;
    }
    return { statusCode: 200, body: "ok" };
  } catch (err) {
    console.error("Webhook handler error:", err);
    return { statusCode: 200, body: "handled-with-errors" };
  }
};

// ───────── helpers ─────────
function fmtAddress(addr) {
  if (!addr) return "—";
  return [addr.line1, addr.line2, [addr.city, addr.state, addr.postal_code].filter(Boolean).join(", "), addr.country]
    .filter(Boolean).map(esc).join("<br>");
}
function fmtDate(unixSeconds) {
  try { return new Date((unixSeconds || Date.now() / 1000) * 1000).toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "full", timeStyle: "short" }); }
  catch { return new Date().toString(); }
}
function parseOrderMeta(session) {
  try { const j = joinFromMetadata("order_meta", session.metadata || {}); return j ? JSON.parse(j) : {}; } catch { return {}; }
}
function metaBlock(label, value) {
  if (!value) return "";
  const body = typeof value === "object"
    ? Object.entries(value).map(([k, v]) => `<div><strong style="color:#c9a84c">${esc(k)}:</strong> ${esc(Array.isArray(v) ? v.join(", ") : v)}</div>`).join("")
    : esc(value);
  return `<div style="margin:14px 0;padding:12px 14px;background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);border-radius:8px"><div style="text-transform:uppercase;letter-spacing:1px;font-size:11px;color:#8a7a65;margin-bottom:6px">${esc(label)}</div>${body}</div>`;
}

// ───────── product order: admin detail + customer thank-you ─────────
async function sendOrderEmails(session) {
  const cd = session.customer_details || {};
  const meta = parseOrderMeta(session);
  const items = session.line_items?.data || [];
  const itemNames = items.map((li) => li.description).filter(Boolean);

  const rows = items.map((li) => {
    const desc = li.price?.product?.description || "";
    return `<tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.15)">${li.quantity} × ${esc(li.description || "Item")}${desc ? `<div style="font-size:12px;color:#b8a07a">${esc(desc)}</div>` : ""}</td>
      <td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.15);text-align:right;white-space:nowrap">${money(li.amount_total)}</td></tr>`;
  }).join("");

  const shipName = session.shipping_cost?.shipping_rate?.display_name || "Shipping";
  const totals = `
    <tr><td style="padding:6px 0;color:#b8a07a">Subtotal</td><td style="padding:6px 0;text-align:right">${money(session.amount_subtotal || 0)}</td></tr>
    <tr><td style="padding:6px 0;color:#b8a07a">${esc(shipName)}</td><td style="padding:6px 0;text-align:right">${money(session.shipping_cost?.amount_total || 0)}</td></tr>
    <tr><td style="padding:6px 0;color:#b8a07a">Tax</td><td style="padding:6px 0;text-align:right">${money(session.total_details?.amount_tax || 0)}</td></tr>
    <tr><td style="padding:10px 0;border-top:1px solid #c9a84c;font-weight:bold;color:#e8cc80">Total Paid</td>
        <td style="padding:10px 0;border-top:1px solid #c9a84c;text-align:right;font-weight:bold;color:#e8cc80">${money(session.amount_total)}</td></tr>`;

  // ADMIN — full detail to BOTH addresses
  await resendSend({
    to: ADMIN_EMAILS,
    subject: `✦ New Order — ${cd.name || cd.email || "Customer"} — ${money(session.amount_total)}`,
    replyTo: cd.email || undefined,
    html: brandWrap("New Order Received", `
      <p style="color:#d4c8b0">A new order has been placed and paid. Full details below.</p>
      ${metaBlock("Customer", { Name: cd.name || "—", Email: cd.email || "—", Phone: cd.phone || "—" })}
      <div style="margin:14px 0;padding:12px 14px;background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);border-radius:8px">
        <div style="text-transform:uppercase;letter-spacing:1px;font-size:11px;color:#8a7a65;margin-bottom:6px">Shipping Address</div>
        ${fmtAddress(session.shipping_details?.address || session.collected_information?.shipping_details?.address || cd.address)}
      </div>
      ${metaBlock("Payment", { Status: session.payment_status || "—", "Shipping Method": shipName, "Order Date": fmtDate(session.created), "Stripe Session": session.id })}
      <table style="width:100%;border-collapse:collapse;margin:16px 0">${rows}</table>
      <table style="width:100%;border-collapse:collapse">${totals}</table>
      ${metaBlock("Herbal Quiz Results", meta.quiz)}
      ${metaBlock("Custom Soap Builder", meta.soap)}
      ${metaBlock("Custom Remedy Details", meta.customRemedy)}
      ${metaBlock("Notes / Special Requests", meta.notes)}`),
  });

  // CUSTOMER — thank-you (brand voice + product names + SUBSCRIBER10 + shipping + Grimoire invite)
  if (cd.email) {
    const productLine = itemNames.length
      ? `your ${itemNames.map((n) => `<strong style="color:#e8cc80">${esc(n)}</strong>`).join(", ")}`
      : "your handcrafted botanicals";
    const inner = `
      <p style="color:#d4c8b0;line-height:1.85">Dearest one, thank you for your order. ${productLine.charAt(0).toUpperCase() + productLine.slice(1)} ${itemNames.length === 1 ? "is" : "are"} being lovingly prepared by hand, with intention and care. It means the world to us that you've welcomed Amber's Alchemy into your wellness ritual.</p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0">${rows}</table>
      <table style="width:100%;border-collapse:collapse">${totals}</table>
      <div style="margin:20px 0;padding:16px 18px;background:rgba(201,168,76,0.1);border:1px dashed #c9a84c;border-radius:10px;text-align:center">
        <div style="color:#8a7a65;font-size:12px;letter-spacing:1px;text-transform:uppercase">A gift for your next visit</div>
        <div style="color:#e8cc80;font-size:22px;letter-spacing:2px;margin:6px 0"><strong>SUBSCRIBER10</strong></div>
        <div style="color:#d4c8b0;font-size:13px">10% off your next order</div>
      </div>
      <p style="color:#d4c8b0;line-height:1.85">Your order will be lovingly prepared and shipped within 5–7 business days. Standard shipping ($7 + tax) delivers in 5–7 business days after shipment. Priority shipping ($14 + tax) is also available. Once your order ships, you'll receive a tracking number by email.</p>
      <div style="margin:18px 0;padding:16px 18px;background:rgba(61,26,92,0.25);border:1px solid rgba(201,168,76,0.25);border-radius:10px">
        <p style="color:#d4c8b0;margin:0 0 10px">Ready to go deeper? The <strong style="color:#e8cc80">Living Grimoire</strong> opens a members' library of rituals, recipes, and botanical wisdom for $7.77/month.</p>
        <a href="${SITE}/grimoire-preview.html" style="display:inline-block;background:linear-gradient(135deg,#6e4ea1,#8c6bc0);color:#f4e8d0;text-decoration:none;padding:11px 22px;border-radius:24px;font-weight:bold">✦ Explore the Living Grimoire</a>
      </div>
      <p style="color:#b8a07a;font-size:13px">With love and light,<br>Amber — Amber's Alchemy Apothecary ✨</p>`;
    await resendSend({
      to: cd.email,
      subject: "Your Order Has Been Received ✨ — Amber's Alchemy Apothecary",
      html: brandWrap("Your Order Has Been Received", inner, { preheader: "Thank you — your botanicals are being prepared by hand." }),
    });
  }
}

// ───────── subscription started ─────────
async function handleSubscriptionStarted(session) {
  const cd = session.customer_details || {};
  const email = (cd.email || "").trim();
  if (!email) return;

  // (a) Supabase upsert → active
  try {
    const sb = getSupabase();
    await sb.from("grimoire_subscribers").upsert({
      email: email.toLowerCase(),
      status: "active",
      stripe_customer_id: session.customer || null,
      stripe_subscription_id: session.subscription || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "email" });
  } catch (e) { console.error("Supabase subscriber upsert failed:", e.message); }

  // (b) magic-link welcome
  let loginLink = `${SITE}/grimoir.html#grimoire`;
  try {
    const sb = getSupabase();
    const { data, error } = await sb.auth.admin.generateLink({
      type: "magiclink", email,
      options: { redirectTo: `${SITE}/grimoir.html#grimoire` },
    });
    if (!error && data?.properties?.action_link) loginLink = data.properties.action_link;
  } catch (e) { console.error("Magic link generation failed:", e.message); }

  await resendSend({
    to: email,
    subject: "🔮 Welcome to the Living Grimoire",
    html: brandWrap("The Grimoire Opens for You", `
      <p style="color:#d4c8b0;line-height:1.85;font-style:italic">Welcome to the hidden library of Awaken Again. Your subscription has unlocked the Grimoire — a living collection of herbal wisdom, rituals, recipes, natural remedies, sacred self-care, spiritual insight, and botanical knowledge created to help you reconnect with your mind, body, and spirit.</p>
      <div style="text-align:center;margin:22px 0">
        <a href="${esc(loginLink)}" style="display:inline-block;background:linear-gradient(135deg,#6e4ea1,#8c6bc0);color:#f4e8d0;text-decoration:none;padding:13px 30px;border-radius:26px;font-weight:bold">✦ Enter the Grimoire</a>
      </div>
      <p style="color:#b8a07a;font-size:13px">This secure login link signs you in to your members' library. $7.77/month · cancel anytime.</p>`,
      { preheader: "Your subscription has unlocked the hidden library." }),
  });

  // (c) admin notify
  await resendSend({
    to: ADMIN_EMAILS,
    subject: `🔮 New Grimoire Subscriber — ${cd.name || email}`,
    replyTo: email,
    html: brandWrap("New Grimoire Subscription", `
      <div style="color:#d4c8b0">
        <div><strong style="color:#c9a84c">Name:</strong> ${esc(cd.name || "—")}</div>
        <div><strong style="color:#c9a84c">Email:</strong> ${esc(email)}</div>
        <div><strong style="color:#c9a84c">Phone:</strong> ${esc(cd.phone || "—")}</div>
        <div><strong style="color:#c9a84c">Date:</strong> ${esc(fmtDate(session.created))}</div>
      </div>`),
  });
}

// ───────── status changes ─────────
async function setSubscriberStatus({ subscriptionId, customerId, email }, status) {
  try {
    const sb = getSupabase();
    let q = sb.from("grimoire_subscribers").update({ status, updated_at: new Date().toISOString() });
    if (subscriptionId) q = q.eq("stripe_subscription_id", subscriptionId);
    else if (customerId) q = q.eq("stripe_customer_id", customerId);
    else if (email) q = q.eq("email", String(email).toLowerCase());
    else return;
    await q;
  } catch (e) { console.error("Supabase status update failed:", e.message); }
}

async function sendRenewalEmail(invoice) {
  const email = invoice.customer_email;
  if (!email) return;
  await resendSend({
    to: email,
    subject: "✦ Your Living Grimoire membership has renewed",
    html: brandWrap("The Grimoire Remains Open", `
      <p style="color:#d4c8b0;line-height:1.85">Thank you for continuing your journey with the Living Grimoire. Your $7.77/month membership has renewed, and your library of rituals, recipes, and botanical wisdom remains open to you.</p>
      <div style="text-align:center;margin:20px 0"><a href="${SITE}/grimoir.html#grimoire" style="display:inline-block;background:linear-gradient(135deg,#6e4ea1,#8c6bc0);color:#f4e8d0;text-decoration:none;padding:12px 26px;border-radius:24px;font-weight:bold">✦ Open the Grimoire</a></div>
      <p style="color:#b8a07a;font-size:13px">With gratitude, Amber — Amber's Alchemy Apothecary. Cancel anytime.</p>`),
  });
}
