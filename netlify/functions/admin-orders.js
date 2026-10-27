const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { supabase, json, options, requireAdmin, missingColumn } = require("./_helpers");
const { mailStatus, sendMail, confirmOrder } = require("./_mail");

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
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { error: "Invalid JSON" }); }
    try {
      if (body.op === "mail-status") return json(200, mailStatus());
      if (body.op === "test-notification") {
        if (!mailStatus().configured) return json(409, { error: `Configure these hosting environment variables, then redeploy: ${mailStatus().missing.join(", ")}` });
        await sendMail({ to: mailStatus().ownerEmail, subject: "LUMLA GLASSES — Notification test", text: "Your order notification email settings are working." });
        return json(200, { message: "Test notification accepted by the mail server. Check your inbox and spam folder." });
      }
      if (!["update-email", "resend-confirmation"].includes(body.op)) return json(400, { error: "Unknown action" });
      if (!Number.isSafeInteger(body.id) || body.id < 1) return json(400, { error: "Invalid order ID" });
      const { data: order, error } = await supabase.from("orders").select("*").eq("id", body.id).maybeSingle();
      if (error) throw error;
      if (!order) return json(404, { error: "Order not found" });
      if (body.op === "update-email") {
        const email = String(body.email || "").trim();
        if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return json(400, { error: "Enter a valid email address" });
        const { error: saveError } = await supabase.from("orders").update({ email }).eq("id", order.id);
        if (saveError) throw saveError;
        return json(200, { message: "Email saved. Use Resend confirmation to send it to the corrected address." });
      }
      await confirmOrder(order);
      return json(200, { message: "Confirmation accepted by the mail server. Ask the customer to check their inbox and spam folder." });
    } catch (error) {
      console.error("Admin order action failed:", error.message);
      return json(502, { error: error.message });
    }
  }
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
