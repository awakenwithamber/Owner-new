/* NOTE (Awaken Again full build): this seeder is OPTIONAL. The live checkout prices
 * products inline from products.json, so you only strictly need this to create the
 * $7.77/mo Grimoire subscription price -> copy STRIPE_GRIMOIRE_PRICE_ID into Netlify.
 * Running it also creates Stripe products for the catalog (harmless). */
/**
 * Amber's Alchemy Apothecary — Stripe Product Catalog Seeder
 * ============================================================
 * One-time script to create all products + prices in Stripe.
 * Safe to re-run — skips existing products by metadata.aa_id.
 *
 * USAGE
 *   1. npm install stripe
 *   2. export STRIPE_SECRET_KEY=sk_live_...
 *   3. node create-stripe-catalog.js
 *
 * OUTPUT → stripe-catalog-result.json
 */

const Stripe = require("stripe");
const fs     = require("fs");
const path   = require("path");

const stripe = Stripe(
  process.env.STRIPE_SECRET_KEY || "sk_live_REPLACE_ME_DO_NOT_COMMIT"
);

const catalog = require("./products.json");

async function main() {
  console.log(`\n🌿 Amber's Alchemy — Stripe Catalog Seeder\n`);
  const results = {};
  let created = 0, skipped = 0;

  for (const product of catalog.products) {
    process.stdout.write(`  ${product.name}… `);

    // Check if already exists
    const existing = await stripe.products.search({
      query: `metadata['aa_id']:'${product.id}'`,
    }).catch(() => ({ data: [] }));

    if (existing.data.length > 0) {
      const ep = existing.data[0];
      const prices = await stripe.prices.list({ product: ep.id, active: true, limit: 1 });
      results[product.id] = {
        product_id: ep.id,
        price_id:   prices.data[0]?.id || "no_price",
        skipped:    true,
      };
      console.log(`skipped (exists)`);
      skipped++;
      continue;
    }

    // Create product
    const sp = await stripe.products.create({
      name:        product.name,
      description: product.description || product.name,
      metadata: {
        aa_id:    product.id,
        category: product.category,
        physical: String(product.physical || true),
      },
    });

    // Create price
    const price = await stripe.prices.create({
      product:     sp.id,
      unit_amount: product.price,
      currency:    "usd",
      metadata:    { aa_id: product.id },
    });

    results[product.id] = {
      product_id: sp.id,
      price_id:   price.id,
      skipped:    false,
    };

    console.log(`✓ created (${price.id})`);
    created++;

    // Rate limit safety
    await new Promise((r) => setTimeout(r, 120));
  }

  // Create Grimoire subscription product + price
  console.log(`\n  Living Grimoire subscription… `);
  const grimoireExisting = await stripe.products.search({
    query: `metadata['aa_id']:'grimoire-subscription'`,
  }).catch(() => ({ data: [] }));

  if (grimoireExisting.data.length > 0) {
    const gp = grimoireExisting.data[0];
    const gprices = await stripe.prices.list({ product: gp.id, active: true, limit: 1 });
    results["grimoire-subscription"] = {
      product_id: gp.id,
      price_id:   gprices.data[0]?.id || "no_price",
      skipped:    true,
    };
    console.log(`skipped (exists)`);
    skipped++;
  } else {
    const gp = await stripe.products.create({
      name:        "The Living Grimoire — A True Book of Light Magic",
      description: "Monthly subscription granting full access to all 88 pages of the Living Grimoire. Cancel anytime.",
      metadata:    { aa_id: "grimoire-subscription" },
    });
    const gprice = await stripe.prices.create({
      product:        gp.id,
      unit_amount:    777,
      currency:       "usd",
      recurring:      { interval: "month" },
      metadata:       { aa_id: "grimoire-subscription" },
    });
    results["grimoire-subscription"] = {
      product_id: gp.id,
      price_id:   gprice.id,
      skipped:    false,
    };
    console.log(`✓ created (${gprice.id})`);
    created++;
  }

  // Save results
  const outPath = path.join(__dirname, "stripe-catalog-result.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

  console.log(`\n✅ Done — ${created} created, ${skipped} skipped`);
  console.log(`📄 Results saved to stripe-catalog-result.json`);
  console.log(`\n⚠️  Copy the grimoire-subscription price_id to your Netlify env:`);
  console.log(`   STRIPE_GRIMOIRE_PRICE_ID=${results["grimoire-subscription"]?.price_id}\n`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
