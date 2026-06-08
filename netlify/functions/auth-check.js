// netlify/functions/auth-check.js
// Grimoire access gate. Access is granted if the email is an admin OR matches an ACTIVE
// row in Supabase `grimoire_subscribers`. On success returns a short-lived signed JWT
// (+ the gated Grimoire content for injection); otherwise 403.
const jwt = require("jsonwebtoken");
const { json, ADMIN_EMAILS, getSupabase } = require("./_shared");

// These owner emails ALWAYS unlock the full Grimoire, regardless of env-var config,
// and are checked before any database lookup (so they work even if Supabase is down).
const ALWAYS_ADMINS = ["awaken@consultant.com", "dare2be4ree@gmail.com"];
const ADMINS = Array.from(new Set(
  [].concat(ADMIN_EMAILS, ALWAYS_ADMINS).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean)
));
const JWT_SECRET = process.env.GRIMOIRE_JWT_SECRET || process.env.SUPABASE_SERVICE_KEY || "";

// Premium pages live with the functions (never in the public web root); only returned after a valid check.
const GRIMOIRE_CONTENT = (function () {
  try { return require("./_grimoire-content"); }
  catch (e) { console.error("Grimoire content module missing:", e.message); return ""; }
})();

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json({ access: false }, 405);
  try {
    const { email } = JSON.parse(event.body || "{}");
    const clean = (email || "").trim().toLowerCase();
    if (!clean || !clean.includes("@")) return json({ access: false, message: "Please enter a valid email." }, 400);

    let role = null;
    if (ADMINS.includes(clean)) {
      role = "admin";
    } else {
      try {
        const sb = getSupabase();
        const { data, error } = await sb
          .from("grimoire_subscribers")
          .select("status")
          .eq("email", clean)
          .maybeSingle();
        if (!error && data && data.status === "active") role = "subscriber";
      } catch (e) { console.error("auth-check supabase:", e.message); }
    }

    if (!role) {
      return json({ access: false, message: "No active subscription found for this email. Your subscription may have lapsed." }, 403);
    }

    let token = null;
    if (JWT_SECRET) {
      try { token = jwt.sign({ sub: clean, role, scope: "grimoire" }, JWT_SECRET, { expiresIn: "7d" }); }
      catch (e) { console.error("JWT sign failed:", e.message); }
    }
    return json({ access: true, role, token, content: GRIMOIRE_CONTENT });
  } catch (err) {
    console.error("auth-check error:", err);
    return json({ access: false, message: "Unable to verify right now. Please try again." }, 500);
  }
};
