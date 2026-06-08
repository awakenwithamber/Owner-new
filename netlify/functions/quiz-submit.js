// netlify/functions/quiz-submit.js
// Herbal Ally Quiz handler:
//  (a) validate + save to Supabase `quiz_submissions`
//  (b) generate a parchment PDF of the user's herbal allies (PDFKit)
//  (c) email the quiz taker their allies (PDF attached) + notify BOTH admins
const { json, ADMIN_EMAILS, esc, brandWrap, resendSend, getSupabase } = require("./_shared");

// One-line descriptions for common allies (used in the PDF + emails).
const BOTANICALS = {
  "lavender": "Calms the nervous system and eases the mind toward rest.",
  "chamomile": "Gentle relaxation and soothing support for sleep and digestion.",
  "ashwagandha": "An adaptogen that helps the body steady itself under stress.",
  "rhodiola": "Eases fatigue and supports stamina and mental clarity.",
  "holy basil": "Tulsi — uplifts mood and buffers the effects of daily stress.",
  "lemon balm": "Brightens the spirit while quieting a busy, anxious mind.",
  "passionflower": "Quiets racing thoughts and invites deeper, calmer sleep.",
  "valerian": "A traditional ally for falling asleep and staying asleep.",
  "mugwort": "Deepens dreams and supports intuitive, restful sleep.",
  "rosemary": "Sharpens memory and clarity; an herb of remembrance.",
  "peppermint": "Cools, refreshes, and soothes digestion and tension.",
  "ginger": "Warms circulation and settles the stomach.",
  "turmeric": "Golden support for a calm, balanced inflammatory response.",
  "nettle": "Deeply mineral-rich; nourishes and gently restores vitality.",
  "calendula": "Soothing and restorative for skin and tissue.",
  "elderberry": "A beloved seasonal ally for immune resilience.",
  "echinacea": "Activates the body's first line of seasonal defense.",
  "reishi": "The mushroom of stillness — immunity and deep restoration.",
  "lions mane": "Supports focus, clarity, and nervous-system health.",
  "milk thistle": "Classic support for the liver's natural cleansing.",
  "hibiscus": "Heart-bright and vitalizing; rich in antioxidants.",
  "dandelion": "Gentle support for digestion and the body's detox pathways.",
  "ginseng": "Restorative energy and resilience for depleted reserves.",
  "schisandra": "An adaptogenic berry for endurance and balance.",
  "skullcap": "Eases tension and soothes an overstimulated nervous system.",
  "hops": "Bitter and calming; a traditional bedtime ally.",
  "maca": "Andean root for steady energy and hormonal balance.",
  "cinnamon": "Warming, grounding, and supportive of healthy circulation.",
};
function describe(name) {
  const key = String(name || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (BOTANICALS[key]) return BOTANICALS[key];
  for (const k of Object.keys(BOTANICALS)) if (key.includes(k) || k.includes(key)) return BOTANICALS[k];
  return "A botanical ally chosen to support your unique wellness pattern.";
}
function allyName(a) { return typeof a === "string" ? a : (a && (a.name || a.id)) || ""; }
function slug(s) { return String(s || "friend").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "friend"; }

// ── Parchment PDF (returns base64) ───────────────────────────
function buildPdfBase64(name, allies) {
  return new Promise((resolve, reject) => {
    let PDFDocument;
    try { PDFDocument = require("pdfkit"); } catch (e) { return reject(e); }
    const doc = new PDFDocument({ size: "LETTER", margin: 64 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
    doc.on("error", reject);

    const W = doc.page.width, H = doc.page.height;
    const paintBg = () => {
      doc.save();
      doc.rect(0, 0, W, H).fill("#f5ead6");
      doc.rect(28, 28, W - 56, H - 56).lineWidth(1.5).stroke("#c9a84c");
      doc.restore();
    };
    doc.on("pageAdded", paintBg);
    paintBg();

    doc.fillColor("#8a6b28").font("Helvetica").fontSize(11)
      .text("AMBER'S ALCHEMY APOTHECARY", { align: "center", characterSpacing: 3 });
    doc.moveDown(0.4);
    doc.fillColor("#3d1a5c").font("Helvetica-Bold").fontSize(30)
      .text("Your Herbal Allies", { align: "center", characterSpacing: 1 });
    doc.moveDown(0.3);
    doc.fillColor("#5a4a2a").font("Helvetica-Oblique").fontSize(13)
      .text("Curated for " + (name || "you") + " by Amber's Alchemy Apothecary", { align: "center" });
    doc.moveDown(0.6);
    doc.fillColor("#c9a84c").fontSize(13).text("✦  ✦  ✦", { align: "center" });
    doc.moveDown(0.8);

    allies.forEach((a, i) => {
      const nm = allyName(a);
      if (!nm) return;
      doc.fillColor("#3d1a5c").font("Helvetica-Bold").fontSize(14)
        .text((i + 1) + ".  " + nm, { continued: false });
      doc.fillColor("#4a3f2a").font("Helvetica").fontSize(11)
        .text(describe(nm), { indent: 18 });
      doc.moveDown(0.6);
    });

    if (!allies.length) {
      doc.fillColor("#4a3f2a").font("Helvetica-Oblique").fontSize(12)
        .text("Your personalized allies will be revealed with your results.", { align: "center" });
    }

    const footerY = H - 70;
    doc.fillColor("#8a6b28").font("Helvetica").fontSize(10)
      .text("awakenagain.com  —  Save or print this page for your herbal practice", 64, footerY, { align: "center", width: W - 128 });
    doc.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json({ error: "Method Not Allowed" }, 405);
  try {
    const body = JSON.parse(event.body || "{}");
    const name = (body.name || "").trim();
    const email = (body.email || "").trim();
    const phone = (body.phone || body.sms || "").trim();
    let allies = Array.isArray(body.herbalAllies) ? body.herbalAllies : (Array.isArray(body.allies) ? body.allies : []);
    allies = allies.map(allyName).filter(Boolean);

    if (!name) return json({ error: "Name is required." }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "A valid email is required." }, 400);

    // (a) Save to Supabase
    try {
      const sb = getSupabase();
      await sb.from("quiz_submissions").insert({
        name, email, phone: phone || null,
        herbal_allies: allies,
        symptoms: body.symptoms || null,
        quiz_answers: body.quizAnswers || null,
      });
    } catch (e) { console.error("Supabase insert failed:", e.message); }

    // (b) PDF
    let pdfBase64 = null;
    try { pdfBase64 = await buildPdfBase64(name, allies); }
    catch (e) { console.error("PDF generation failed:", e.message); }

    const listHtml = allies.length
      ? "<ol style='line-height:1.8'>" + allies.map((a) => `<li><strong style="color:#e8cc80">${esc(a)}</strong> — ${esc(describe(a))}</li>`).join("") + "</ol>"
      : "<p>Your allies are ready inside the apothecary.</p>";

    // EMAIL A — to the quiz taker (PDF attached)
    const inner = `
      <p style="color:#d4c8b0;line-height:1.85;font-style:italic">Dearest ${esc(name)}, the plants have spoken.</p>
      <p style="color:#d4c8b0;line-height:1.85">Your herbal allies have been chosen with care and intention — a living map for your wellness journey. Find your full list in the attached PDF. Save it, print it, return to it whenever you need guidance.</p>
      <div style="margin:18px 0;padding:14px 18px;background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);border-radius:10px;color:#d4c8b0">${listHtml}</div>
      <p style="color:#d4c8b0;line-height:1.85">With love and light,<br><strong style="color:#e8cc80">Amber</strong> — Amber's Alchemy Apothecary</p>`;
    await resendSend({
      to: email,
      subject: "Your Herbal Allies Are Ready ✨",
      html: brandWrap("The Plants Have Spoken", inner, { preheader: "Your personalized herbal allies, chosen with intention." }),
      attachments: pdfBase64 ? [{ filename: `herbal-allies-${slug(name)}.pdf`, content: pdfBase64 }] : undefined,
    });

    // EMAIL B — admin notification to BOTH admins
    const rows = `
      <tr><td style="padding:6px 12px 6px 0;color:#c9a84c">Name</td><td>${esc(name)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#c9a84c">Email</td><td>${esc(email)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#c9a84c">Phone</td><td>${esc(phone || "—")}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#c9a84c;vertical-align:top">Herbal Allies</td><td>${esc(allies.join(", ") || "—")}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#c9a84c">Submitted</td><td>${esc(new Date().toLocaleString("en-US", { timeZone: "America/Denver" }))}</td></tr>`;
    await resendSend({
      to: ADMIN_EMAILS,
      subject: `New Herbal Quiz Submission — ${name}`,
      html: brandWrap("New Herbal Quiz Submission", `<table style="width:100%;border-collapse:collapse;color:#d4c8b0">${rows}</table>`),
      replyTo: email,
    });

    return json({ ok: true });
  } catch (err) {
    console.error("quiz-submit error:", err);
    return json({ error: "Could not process your submission. Please try again." }, 500);
  }
};
