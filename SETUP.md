# Awaken Again — Deploy & Go-Live Guide

This package is your **full live site** (theme, music, quiz, Grimoire, shop, reviews) **plus** the new
Stripe checkout + email engine. Deploying it replaces the old code that had the broken/dead checkout.

> ⚠️ Adding Stripe keys alone does nothing until THIS code is deployed — your current live site
> runs the old code. Deploy this, then the keys you set become active.

---

## 1) Deploy to Netlify
The serverless functions use npm packages (`stripe`, `@supabase/supabase-js`, `pdfkit`, `jsonwebtoken`),
so deploy through **Git** — that's what makes Netlify run `npm install` and bundle the functions:
1. Create a GitHub repo and upload everything in this package (GitHub → **Add file → Upload files** → drag the whole folder; this carries the images and the `.mp3` too).
2. In Netlify → your site → **Site configuration → Build & deploy → Continuous deployment**, link that repository. Netlify reads `netlify.toml`, installs dependencies, bundles `netlify/functions/*`, and publishes on every push.

> ⚠️ **Drag-and-drop won't run `npm install`**, so a pure drag-and-drop deploy publishes the static site but the functions' dependencies will be missing (checkout/emails/quiz would fail). Use the Git path above, or the Netlify CLI: `netlify deploy --build --prod`.

## 2) Environment variables  (Site configuration → Environment variables)
| Variable | Needed for | Value |
|---|---|---|
| `STRIPE_SECRET_KEY` | Checkout | `sk_live_…` (or `sk_test_…` to test) |
| `STRIPE_PUBLISHABLE_KEY` | Checkout | `pk_live_…` (or `pk_test_…`) |
| `SITE_URL` | Checkout redirects | `https://awakenagain.com` |
| `RESEND_API_KEY` | Emails | `re_…` |
| `FROM_EMAIL` | Emails | `orders@awakenagain.com` (verified in Resend) |
| `ADMIN_EMAIL_1` | Admin emails | `awaken@consultant.com` |
| `ADMIN_EMAIL_2` | Admin emails | `dare2be4ree@gmail.com` |
| `STRIPE_WEBHOOK_SECRET` | Emails (order confirm) | `whsec_…` (from step 4) |
| `STRIPE_GRIMOIRE_PRICE_ID` | $7.77 subscription | `price_…` (from step 3) |
| `STRIPE_TAX_ENABLED` | Optional tax | `true` only AFTER enabling Stripe Tax |

✅ Card checkout works with just the first three. Emails need Resend + the webhook. The subscription needs the price ID.

## 3) Create the $7.77 subscription price (Stripe)
Products → **Add product** → "The Living Grimoire" → recurring **$7.77 / month** → save → copy the **Price ID** (`price_…`) → set `STRIPE_GRIMOIRE_PRICE_ID`.

## 4) Create the webhook (Stripe) — required for confirmation emails
Developers → **Webhooks** → Add endpoint
- URL: `https://awakenagain.com/.netlify/functions/stripe-webhook`
- Events: `checkout.session.completed` (optionally `customer.subscription.updated`, `customer.subscription.deleted`)
- Copy the **Signing secret** (`whsec_…`) → set `STRIPE_WEBHOOK_SECRET`.

## 5) (Optional) Enable Stripe Tax
Settings → Tax → enable + set your origin address + register your state. Then set `STRIPE_TAX_ENABLED=true`.

## 6) Test in Stripe TEST mode first
Use **test** keys → card `4242 4242 4242 4242`, any future date / CVC / ZIP.
Add a product → cart → **Proceed to Secure Checkout** → **Pay with Card** → complete.
Confirm: thank-you page shows, and (with webhook + Resend set) order emails arrive at both admin inboxes **and** the customer. Then switch to **live** keys and run one small real order.

---

## What works now vs. still being finished
**Works now:** product card checkout; the guided **Custom Soap Builder** (now functional — its buttons were previously undefined) feeding the cart + order emails with a personalized recommendation; the 9 signature-soap **Add to Cart** buttons (also previously dead); a unified cart; $7/$14 shipping; full-detail admin emails to BOTH addresses; customer confirmation + magical Grimoire welcome; a visible **$7.77 Membership** section + working subscribe button; the gated 88-page Grimoire (`grimoir.html`); graceful fallback for the broken herb images; the missing favicon; and Zapier-free site forms.

Bundles, the `products.json` price catalog, and SEO/QA are now complete (see the QA & Go-Live doc). Your **theme, music, and herbal quiz remain untouched.**

---

## v1.1 — Quiz + Subscription Automation (Supabase)

This release adds Supabase-backed automations. New / updated serverless functions:
- **`quiz-submit.js`** — saves each Herbal Ally Quiz submission to Supabase, generates a parchment **PDF** (PDFKit) of the user's allies, emails the taker (PDF attached) **and** notifies BOTH admins.
- **`stripe-webhook.js`** — adds the customer **thank-you email** (product names + `SUBSCRIBER10` + shipping copy + Grimoire invite), the Grimoire **subscriber lifecycle** (active on signup → Supabase + magic-link welcome + admin notify; inactive on `customer.subscription.deleted` / `invoice.payment_failed`), and **renewal** emails on `invoice.payment_succeeded`.
- **`auth-check.js`** — validates against Supabase `grimoire_subscribers` (status = `active`) **or** an admin email, and returns a **signed JWT** (403 otherwise).
- **`grimoire-preview.html`** — the leather-bound book preview (pages 0–8) with the subscribe CTA beyond page 8.

### Additional environment variables
| Variable | Needed for | Value |
|---|---|---|
| `SUPABASE_URL` | DB + auth | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | server DB writes (service role) | `eyJ…` — **server only, never expose** |
| `GRIMOIRE_JWT_SECRET` | auth-check JWT signing | a long random string, e.g. `openssl rand -hex 32` |
| `FROM_EMAIL` | sender | `hello@awakenagain.com` (verify domain in Resend) |

(All Stripe / Resend / `SITE_URL` / admin vars above still apply.)

### Database setup (one time)
Run **`supabase/migrations/0001_quiz_and_grimoire.sql`** in Supabase → SQL Editor. It creates `quiz_submissions` and `grimoire_subscribers` with RLS enabled (the service-role key used by the functions bypasses RLS, so the public/anon key can't read these tables).

### Dependencies
`package.json` now includes `@supabase/supabase-js`, `pdfkit`, and `jsonwebtoken` — Netlify installs them automatically on deploy.

### Stripe webhook events
On your endpoint (`/.netlify/functions/stripe-webhook`) enable: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`.

### Tax (now required)
`automatic_tax` is **on by default**. Activate **Stripe Tax** (Settings → Tax) — or set `STRIPE_TAX_ENABLED=false` only as a temporary escape hatch if Tax isn't activated yet (sessions error otherwise).

### Magic-link auth
The Grimoire welcome uses Supabase Auth magic links. In Supabase → Authentication → URL Configuration, add your `SITE_URL` to the allowed redirect URLs.

### Resend sender
Verify **awakenagain.com** (SPF/DKIM) in Resend so `Amber's Alchemy Apothecary <hello@awakenagain.com>` authenticates.
