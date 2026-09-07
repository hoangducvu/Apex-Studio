const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const { supabase, missingColumn } = require("./_helpers");

let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

/* ── Shipping address ────────────────────────────────────────────────────────
 * The checkout puts the delivery address on the PaymentIntent, so the payment
 * is the source of truth. These pull it out in the shape the orders table and
 * the admin panel expect. `ship_*` only lands once
 * supabase-migration-shipping.sql has run — until then the save quietly drops
 * the columns rather than losing the order.
 */
const SHIP_COLUMNS = [
  "ship_name", "ship_line1", "ship_line2", "ship_city",
  "ship_zip", "ship_state", "ship_country", "ship_phone", "ship_method",
];

function shippingRow(pi) {
  const s = pi.shipping || {};
  const a = s.address || {};
  return {
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
}

// The address is typed by the customer, so it never goes into the owner's
// notification email as raw markup.
const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Postal-label layout: name, street, postcode + town, country.
function addressLines(row) {
  return [
    row.ship_name,
    row.ship_line1,
    row.ship_line2,
    [row.ship_zip, row.ship_city].filter(Boolean).join(" "),
    [row.ship_state, row.ship_country].filter(Boolean).join(", "),
    row.ship_phone ? `tel ${row.ship_phone}` : "",
  ].filter((l) => l && l.trim());
}

async function notifyOwner(pi) {
  if (!mailer || !process.env.OWNER_EMAIL) return;
  const items = JSON.parse(pi.metadata?.items_json || "[]");
  const euros = (pi.amount_received / 100).toFixed(2);
  const lines = addressLines(shippingRow(pi));
  await mailer.sendMail({
    from: `"LUMLA GLASSES" <${process.env.SMTP_USER}>`,
    to: process.env.OWNER_EMAIL,
    subject: `New order — €${euros} from ${pi.receipt_email || "unknown"}`,
    html: `
      <div style="font-family:monospace;background:#080809;color:#f0f0f2;padding:32px;max-width:520px">
        <h2 style="color:#d4fc00;letter-spacing:.1em;margin:0 0 24px">NEW ORDER</h2>
        <p><b>Payment ID:</b> ${pi.id}</p>
        <p><b>Customer:</b> ${pi.receipt_email || "—"}</p>
        <p><b>Total:</b> €${euros}</p>
        <hr style="border-color:rgba(255,255,255,.1);margin:20px 0">
        ${items.map(i => `<p>${i.name} × ${i.qty}</p>`).join("")}
        <hr style="border-color:rgba(255,255,255,.1);margin:20px 0">
        <p><b>Ship to:</b></p>
        <p style="line-height:1.6">${lines.length ? lines.map(esc).join("<br>") : "— no address on this payment —"}</p>
        <p><b>Postage:</b> ${pi.metadata?.shipping_method || "—"}</p>
        <hr style="border-color:rgba(255,255,255,.1);margin:20px 0">
        <p style="color:#7a7a84;font-size:.8em">View in <a href="https://dashboard.stripe.com/payments/${pi.id}" style="color:#d4fc00">Stripe Dashboard</a></p>
      </div>`,
  });
}

exports.handler = async (event) => {
  const sig    = event.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  if (secret) {
    try {
      const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body;
      stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (err) {
      return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }
  } else {
    console.warn("⚠  STRIPE_WEBHOOK_SECRET not set — skipping signature check");
    try { stripeEvent = JSON.parse(event.body); } catch { return { statusCode: 400, body: "" }; }
  }

  if (stripeEvent.type === "payment_intent.succeeded") {
    const pi    = stripeEvent.data.object;
    const euros = (pi.amount_received / 100).toFixed(2);
    const items = JSON.parse(pi.metadata?.items_json || "[]");

    // Deduct inventory for each item
    for (const item of items) {
      const { data: prod } = await supabase
        .from("products")
        .select("quantity")
        .eq("id", item.id)
        .single();
      if (prod) {
        await supabase
          .from("products")
          .update({ quantity: Math.max(0, prod.quantity - item.qty) })
          .eq("id", item.id);
      }
    }

    // Save order, address included
    const order = {
      stripe_id: pi.id,
      email: pi.receipt_email || null,
      items_json: pi.metadata?.items_json || "[]",
      total: parseFloat(euros),
      status: "paid",
      ...shippingRow(pi),
    };

    const save = (row) => supabase.from("orders").upsert(row, { onConflict: "stripe_id" });
    let { error: orderErr } = await save(order);

    // Migration still pending: keep the order rather than lose it over an
    // address. The admin panel backfills the address from Stripe once the
    // columns exist.
    if (missingColumn(orderErr, SHIP_COLUMNS)) {
      console.warn("⚠  orders has no ship_* columns — run supabase-migration-shipping.sql");
      for (const col of SHIP_COLUMNS) delete order[col];
      ({ error: orderErr } = await save(order));
    }

    if (orderErr) console.error("Order save error:", orderErr.message);
    else console.log(`✅  Order saved  ${pi.id}  €${euros}`);

    try { await notifyOwner(pi); } catch (e) { console.error("Email error:", e.message); }
  }

  if (stripeEvent.type === "payment_intent.payment_failed") {
    console.log(`❌  Payment failed  ${stripeEvent.data.object.id}`);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
