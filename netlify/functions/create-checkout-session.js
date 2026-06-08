// netlify/functions/create-checkout-session.js
// Creates a Stripe EMBEDDED Checkout session that mounts directly on awakenagain.com.
// Handles: one-time product/soap/custom orders AND the $7.77/mo Grimoire subscription.
//
// Resilience: tax is applied when available, but if Stripe rejects the session (e.g. Stripe
// Tax isn't activated yet) we AUTOMATICALLY retry without automatic_tax so checkout never breaks.
// Security: catalog item prices come from server-side products.json — never trusted from the browser.

const Stripe = require("stripe");
const { json, SITE, chunkToMetadata } = require("./_shared");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Tax ON by default; set STRIPE_TAX_ENABLED=false to force-disable. Either way, a tax-related
// failure falls back to a no-tax session automatically (see createWithTaxFallback).
const TAX_ENABLED = String(process.env.STRIPE_TAX_ENABLED || "true").toLowerCase() !== "false";

// Server-side catalog (id -> price in cents). Optional: clamp fallback covers missing entries.
let CATALOG = { products: [], currency: "usd" };
try { CATALOG = require("../../products.json"); } catch (_) { /* optional */ }
const CATALOG_INDEX = {};
const NAME_INDEX = {};
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
for (const p of CATALOG.products || []) { CATALOG_INDEX[p.id] = p; NAME_INDEX[norm(p.name)] = p; }

const CUSTOM_PRICES = {
  "custom-soap": 999,     // Custom Botanical Soap (single artisan bar)
  "custom-remedy": 3499,  // Custom Herbal Remedy (base; Amber confirms final)
};

const SHIPPING_OPTIONS = [
  { display_name: "Standard Shipping", amount: 700,  min: 4, max: 8 },   // $7
  { display_name: "Priority Shipping", amount: 1400, min: 2, max: 4 },   // $14
];

function priceForItem(item) {
  const id = String(item.id || "");
  const product = CATALOG_INDEX[id] || NAME_INDEX[norm(item.name)] || null;
  if (product) {
    if (product.variants && product.variants.length && item.options) {
      const size = item.options.Size || item.options.size || item.options.Variant || item.options.variant;
      const v = product.variants.find((x) => norm(x.label) === norm(size) || x.id === size);
      if (v) return { cents: v.price };
    }
    if (Number.isFinite(product.price)) return { cents: product.price };
  }
  for (const key of Object.keys(CUSTOM_PRICES)) {
    if (id.startsWith(key)) return { cents: CUSTOM_PRICES[key] };
  }
  const raw = Math.round(Number(item.price || 0) * 100);
  return { cents: Math.max(100, Math.min(50000, raw || 100)) };
}

function describeOptions(options) {
  if (!options || typeof options !== "object") return "";
  return Object.entries(options)
    .filter(([, v]) => v && String(v).trim() && String(v) !== "—")
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ")
    .slice(0, 480);
}

// Try with tax; if Stripe rejects (commonly: Stripe Tax not activated / no origin address),
// retry once WITHOUT automatic_tax so the customer can always complete checkout.
async function createWithTaxFallback(buildParams) {
  try {
    return await stripe.checkout.sessions.create(buildParams(TAX_ENABLED));
  } catch (err) {
    if (TAX_ENABLED) {
      console.error("Checkout failed with tax enabled; retrying without automatic_tax:", err.message);
      return await stripe.checkout.sessions.create(buildParams(false));
    }
    throw err;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json({ error: "Method Not Allowed" }, 405);
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("STRIPE_SECRET_KEY is not set");
    return json({ error: "Payments are not configured yet. Please contact awaken@consultant.com." }, 500);
  }

  try {
    const body = JSON.parse(event.body || "{}");

    // ── GRIMOIRE SUBSCRIPTION ($7.77/mo) ───────────────────────────────
    if (body.mode === "subscription") {
      if (!process.env.STRIPE_GRIMOIRE_PRICE_ID) {
        return json({ error: "Subscription price is not configured yet." }, 400);
      }
      const session = await createWithTaxFallback((withTax) => ({
        ui_mode: "embedded",
        mode: "subscription",
        line_items: [{ price: process.env.STRIPE_GRIMOIRE_PRICE_ID, quantity: 1 }],
        automatic_tax: { enabled: withTax },
        customer_creation: "always",
        phone_number_collection: { enabled: true },
        return_url: `${SITE}/checkout-complete.html?session_id={CHECKOUT_SESSION_ID}`,
        metadata: { type: "grimoire_subscription" },
        subscription_data: { metadata: { type: "grimoire_subscription" } },
      }));
      return json({ clientSecret: session.client_secret });
    }

    // ── ONE-TIME PRODUCT / SOAP / CUSTOM ORDER ─────────────────────────
    const cart = Array.isArray(body.cart) ? body.cart : [];
    if (cart.length === 0) return json({ error: "Your cart is empty." }, 400);

    const baseLineItems = [];
    const itemSummary = [];
    for (const item of cart) {
      const qty = Math.max(1, Math.min(99, parseInt(item.qty, 10) || 1));
      const { cents } = priceForItem(item);
      const name = String(item.name || CATALOG_INDEX[item.id]?.name || "Apothecary Item").slice(0, 250);
      const optionText = describeOptions(item.options);
      baseLineItems.push({
        quantity: qty,
        price_data: {
          currency: CATALOG.currency || "usd",
          unit_amount: cents,
          product_data: {
            name,
            description: optionText || undefined,
            metadata: { item_id: String(item.id || "").slice(0, 200) },
          },
        },
      });
      itemSummary.push(`${qty}x ${name}${optionText ? ` (${optionText})` : ""}`);
    }

    const orderMeta = {
      items: itemSummary,
      quiz: body.orderMeta?.quiz || body.quizResults || null,
      soap: body.orderMeta?.soap || body.soapAnswers || null,
      customRemedy: body.orderMeta?.customRemedy || null,
      notes: body.orderMeta?.notes || body.notes || null,
    };
    const metaChunks = chunkToMetadata("order_meta", JSON.stringify(orderMeta));

    const session = await createWithTaxFallback((withTax) => ({
      ui_mode: "embedded",
      mode: "payment",
      line_items: baseLineItems.map((li) => ({
        ...li,
        price_data: { ...li.price_data, ...(withTax ? { tax_behavior: "exclusive" } : {}) },
      })),
      automatic_tax: { enabled: withTax },
      shipping_address_collection: { allowed_countries: ["US"] },
      phone_number_collection: { enabled: true },
      shipping_options: SHIPPING_OPTIONS.map((s) => ({
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: s.display_name,
          fixed_amount: { amount: s.amount, currency: "usd" },
          ...(withTax ? { tax_behavior: "exclusive" } : {}),
          delivery_estimate: {
            minimum: { unit: "business_day", value: s.min },
            maximum: { unit: "business_day", value: s.max },
          },
        },
      })),
      return_url: `${SITE}/checkout-complete.html?session_id={CHECKOUT_SESSION_ID}`,
      metadata: { type: "product_order", ...metaChunks },
    }));

    return json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return json({ error: err.message || "Could not start checkout." }, 500);
  }
};
