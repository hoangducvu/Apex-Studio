const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { json, options } = require("./_helpers");

const COUNTRY_CODES = {
  Austria:"AT", Belgium:"BE", Bulgaria:"BG", Croatia:"HR", Cyprus:"CY",
  "Czech Republic":"CZ", Denmark:"DK", Estonia:"EE", Finland:"FI",
  France:"FR", Germany:"DE", Greece:"GR", Hungary:"HU", Ireland:"IE",
  Italy:"IT", Latvia:"LV", Lithuania:"LT", Luxembourg:"LU", Malta:"MT",
  Netherlands:"NL", Poland:"PL", Portugal:"PT", Romania:"RO",
  Slovakia:"SK", Slovenia:"SI", Spain:"ES", Sweden:"SE",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const { amount, items, email, shipping } = JSON.parse(event.body || "{}");
    if (!amount || amount <= 0) return json(400, { error: "Invalid amount" });

    const pi = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "eur",
      receipt_email: email || undefined,
      shipping: shipping?.name ? {
        name: shipping.name,
        address: {
          line1:       shipping.address || "",
          city:        shipping.city    || "",
          postal_code: shipping.zip     || "",
          country:     COUNTRY_CODES[shipping.country] || "NL",
        },
      } : undefined,
      metadata: {
        items_json:    JSON.stringify(items.map(i => ({ id: i.id, qty: i.qty, name: i.name }))),
        items_display: items.map(i => `${i.name} ×${i.qty}`).join(", "),
        source: "lumla-glasses-web",
      },
      payment_method_types: ["card"],
    });

    return json(200, { clientSecret: pi.client_secret });
  } catch (err) {
    console.error("PaymentIntent error:", err.message);
    return json(500, { error: err.message });
  }
};
