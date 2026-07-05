const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const { supabase } = require("./_helpers");

let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function notifyOwner(pi) {
  if (!mailer || !process.env.OWNER_EMAIL) return;
  const items = JSON.parse(pi.metadata?.items_json || "[]");
  const euros = (pi.amount_received / 100).toFixed(2);
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

    // Save order
    const { error: orderErr } = await supabase.from("orders").upsert({
      stripe_id: pi.id,
      email: pi.receipt_email || null,
      items_json: pi.metadata?.items_json || "[]",
      total: parseFloat(euros),
      status: "paid",
    }, { onConflict: "stripe_id" });

    if (orderErr) console.error("Order save error:", orderErr.message);
    else console.log(`✅  Order saved  ${pi.id}  €${euros}`);

    try { await notifyOwner(pi); } catch (e) { console.error("Email error:", e.message); }
  }

  if (stripeEvent.type === "payment_intent.payment_failed") {
    console.log(`❌  Payment failed  ${stripeEvent.data.object.id}`);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
