// netlify/functions/stripe-config.js
// Returns the publishable key (safe to expose) so the frontend stays key-free in source.
const { json } = require("./_shared");
exports.handler = async () =>
  json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "" });
