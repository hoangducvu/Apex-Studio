const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { supabase, json, options, requireAdmin, missingColumn } = require("./_helpers");

const SHIP_COLUMNS = [
  "ship_name", "ship_line1", "ship_line2", "ship_city",
  "ship_zip", "ship_state", "ship_country", "ship_phone", "ship_method",
];

// Orders paid before the address was stored still have it on the Stripe
// payment, so fill those in on first view and write the result back — the
// dashboard heals itself instead of needing a migration script. Capped so one
// page load never turns into fifty Stripe calls.
const BACKFILL_LIMIT = 10;

async function backfillAddresses(orders) {
  const stale = orders
    .filter((o) => o.stripe_id && !o.ship_name && !o.ship_line1)
    .slice(0, BACKFILL_LIMIT);

  for (const order of stale) {
    try {
      const pi = await stripe.paymentIntents.retrieve(order.stripe_id);
      const s = pi.shipping;
      if (!s) continue;
      const a = s.address || {};

      const patch = {
        ship_name:    s.name || null,
        ship_line1:   a.line1 || null,
        ship_line2:   a.line2 || null,
        ship_city:    a.city || null,
        ship_zip:     a.postal_code || null,
        ship_state:   a.state || null,
        ship_country: a.country || null,
        ship_phone:   s.phone || null,
        ship_method:  pi.metadata?.shipping_method || null,
      };

      Object.assign(order, patch);
      const { error } = await supabase.from("orders").update(patch).eq("id", order.id);
      // Migration still pending: show the address anyway, just don't store it.
      if (error && !missingColumn(error, SHIP_COLUMNS)) {
        console.error("Address backfill save error:", error.message);
      }
    } catch (e) {
      console.error(`Address backfill failed for ${order.stripe_id}:`, e.message);
    }
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  const authErr = requireAdmin(event);
  if (authErr) return authErr;
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return json(500, { error: error.message });

  const orders = data || [];
  if (process.env.STRIPE_SECRET_KEY) {
    try { await backfillAddresses(orders); }
    catch (e) { console.error("Address backfill error:", e.message); }
  }

  return json(200, orders);
};
