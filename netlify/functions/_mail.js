const nodemailer = require("nodemailer");
const ownerEmail = () => process.env.OWNER_EMAIL || "lumlaglassesmt@gmail.com";

function mailStatus() {
  const missing = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]
    .filter(key => !process.env[key]);
  return { configured: !missing.length, missing, ownerEmail: ownerEmail() };
}

function transport() {
  if (!["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].every(key => process.env[key])) {
    throw new Error("Email delivery is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in hosting environment variables, then redeploy.");
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_PORT || "587") === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendMail(message) {
  return transport().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, ...message });
}

async function confirmOrder(order) {
  if (!order.email) throw new Error("Save a customer email address first.");
  if (order.status !== "paid") throw new Error("Only paid orders can receive a payment confirmation.");
  let items = [];
  try { items = JSON.parse(order.items_json || "[]"); } catch {}
  if (!Array.isArray(items)) items = [];
  const reference = `APX-${String(order.stripe_id || order.id).slice(-8).toUpperCase()}`;
  return sendMail({
    to: order.email,
    cc: ownerEmail(),
    replyTo: ownerEmail(),
    subject: `LUMLA GLASSES — Your order is confirmed | ${reference}`,
    text: `Thank you for your order!\n\nOrder: ${reference}\nPayment received: EUR ${Number(order.total || 0).toFixed(2)}\n\n${items.map(i => `${i.name || i.id} × ${i.qty}`).join("\n")}\n\nDelivery address:\n${[order.ship_name, order.ship_line1, order.ship_line2, order.ship_zip, order.ship_city, order.ship_country].filter(Boolean).join("\n")}\n\nThank you for shopping with LUMLA GLASSES.`,
  });
}

module.exports = { mailStatus, sendMail, confirmOrder };
