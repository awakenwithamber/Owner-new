// netlify/functions/session-status.js
// Called by checkout-complete.html to confirm the result after payment.
const Stripe = require("stripe");
const { json } = require("./_shared");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  try {
    const sessionId = (event.queryStringParameters || {}).session_id;
    if (!sessionId) return json({ error: "Missing session_id" }, 400);

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer_details"],
    });

    return json({
      status: session.status,                  // "complete" | "open" | "expired"
      payment_status: session.payment_status,   // "paid" | "unpaid" | "no_payment_required"
      email: session.customer_details?.email || null,
      name: session.customer_details?.name || null,
      type: session.metadata?.type || null,
      amount_total: session.amount_total,
    });
  } catch (err) {
    console.error("session-status error:", err);
    return json({ error: err.message }, 500);
  }
};
