const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { supabase, json, options } = require("./_helpers");

const COUNTRY_CODES = {
  Austria:"AT", Belgium:"BE", Bulgaria:"BG", Croatia:"HR", Cyprus:"CY",
  "Czech Republic":"CZ", Denmark:"DK", Estonia:"EE", Finland:"FI",
  France:"FR", Germany:"DE", Greece:"GR", Hungary:"HU", Ireland:"IE",
  Italy:"IT", Latvia:"LV", Lithuania:"LT", Luxembourg:"LU", Malta:"MT",
  Netherlands:"NL", Poland:"PL", Portugal:"PT", Romania:"RO",
  Slovakia:"SK", Slovenia:"SI", Spain:"ES", Sweden:"SE",
};

/* ── Shipping (mirror of SHIPPING in script.js) ─────────────────────────────
   MaltaPost prices Malta → anywhere in the EU as a single zone, so only the
   weight of the parcel moves the cost, never the destination. A packed pair
   sits in the 101–300 g band: €5.81 untracked, €13.29 tracked. These rates
   round that up a little to absorb two-pair orders (301–500 g).

   Over FREE_SHIPPING_OVER the standard rate is waived, and tracked costs the
   difference — so the shop spends the same either way. */
const SHIPPING_OPTIONS = {
  standard: { price: 5.95,  label: "Standard (untracked)" },
  tracked:  { price: 13.95, label: "Tracked & signed" },
};
const FREE_SHIPPING_OVER = 90;

// Charge for `method`, given what the customer pays for the goods themselves.
function shippingCost(method, goodsTotal) {
  const opt = SHIPPING_OPTIONS[method] || SHIPPING_OPTIONS.standard;
  const waived = goodsTotal >= FREE_SHIPPING_OVER ? SHIPPING_OPTIONS.standard.price : 0;
  return round2(Math.max(0, opt.price - waived));
}

// ── Discount codes (mirror of DISCOUNTS in script.js) ───────────────────────
const DISCOUNTS = {
  LUMLA: { percent: 10, label: "LUMLA · 10% off" },
};

const round2 = (n) => Math.round(n * 100) / 100;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const { items, email, shipping, discountCode, shippingMethod } = JSON.parse(event.body || "{}");
    if (!Array.isArray(items) || !items.length) return json(400, { error: "Cart is empty" });

    // Price the order from the database — the amount sent by the browser is
    // never trusted, it only drives what the customer sees before paying.
    const ids = [...new Set(items.map((i) => i.id))];
    const { data: rows, error } = await supabase
      .from("products")
      .select("id, name, price, quantity, active")
      .in("id", ids);
    if (error) return json(500, { error: error.message });

    const byId = new Map((rows || []).map((r) => [r.id, r]));

    let subtotal = 0;
    const lines = [];
    for (const i of items) {
      const p = byId.get(i.id);
      if (!p || p.active === false) {
        return json(400, { error: `"${i.name || i.id}" is no longer available` });
      }

      const qty = Math.max(1, Math.min(parseInt(i.qty, 10) || 1, 99));
      const unit = round2(Number(p.price));
      subtotal += unit * qty;

      lines.push({ id: p.id, name: p.name, qty, unit });
    }
    subtotal = round2(subtotal);

    const code = String(discountCode || "").trim().toUpperCase();
    const deal = DISCOUNTS[code];
    const discount = deal ? round2((subtotal * deal.percent) / 100) : 0;
    const goods = round2(subtotal - discount);

    const method = SHIPPING_OPTIONS[shippingMethod] ? shippingMethod : "standard";
    const postage = shippingCost(method, goods);
    const total = round2(goods + postage);

    if (!(total > 0)) return json(400, { error: "Invalid amount" });

    const pi = await stripe.paymentIntents.create({
      amount: Math.round(total * 100),
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
        items_json:    JSON.stringify(lines.map((l) => ({ id: l.id, qty: l.qty, name: l.name }))).slice(0, 500),
        items_display: lines.map((l) => `${l.name} ×${l.qty}`).join(", ").slice(0, 500),
        subtotal:      subtotal.toFixed(2),
        discount_code: deal ? code : "",
        discount:      discount.toFixed(2),
        shipping_method: SHIPPING_OPTIONS[method].label,
        shipping:      postage.toFixed(2),
        source: "lumla-glasses-web",
      },
      payment_method_types: ["card"],
    });

    return json(200, {
      clientSecret: pi.client_secret,
      amount: total,
      subtotal,
      discount,
      shipping: postage,
      shippingMethod: method,
      discountApplied: !!deal,
    });
  } catch (err) {
    console.error("PaymentIntent error:", err.message);
    return json(500, { error: err.message });
  }
};
