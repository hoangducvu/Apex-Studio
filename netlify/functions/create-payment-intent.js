const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { supabase, json, options } = require("./_helpers");
const { lookupDiscount } = require("./discounts");

const COUNTRY_CODES = {
  Austria:"AT", Belgium:"BE", Bulgaria:"BG", Croatia:"HR", Cyprus:"CY",
  "Czech Republic":"CZ", Denmark:"DK", Estonia:"EE", Finland:"FI",
  France:"FR", Germany:"DE", Greece:"GR", Hungary:"HU", Ireland:"IE",
  Italy:"IT", Latvia:"LV", Lithuania:"LT", Luxembourg:"LU", Malta:"MT",
  Netherlands:"NL", Poland:"PL", Portugal:"PT", Romania:"RO",
  Slovakia:"SK", Slovenia:"SI", Spain:"ES", Sweden:"SE",
};

/* ── Shipping (mirror of SHIPPING in script.js) ─────────────────────────────
   One flat-rate service per destination: a local hop within Malta, tracked
   post everywhere else. The customer picks nothing, so the browser has no
   say in this — the address the payment is created with decides the service
   and the rate, and an order at or over FREE_SHIPPING_OVER pays neither. */
const SHIPPING_OPTIONS = {
  malta: { price: 3.5, label: "MaltaPost (untracked)" },
  intl:  { price: 13,  label: "Tracked & signed" },
};
const FREE_SHIPPING_OVER = 100;

// Anything that is not Malta is treated as international, matching the
// storefront. Read from the address the payment is created with, never from
// anything the browser asserts about the price.
function destKey(country) {
  return String(country || "").trim().toLowerCase() === "malta" ? "malta" : "intl";
}

// Charge for the goods total and where the parcel is going.
function shippingCost(goodsTotal, country) {
  if (goodsTotal >= FREE_SHIPPING_OVER) return 0;
  return round2(SHIPPING_OPTIONS[destKey(country)].price);
}

/* Discount codes are managed in the admin panel and read here from the same
   store, so the charge is calculated from what the shop actually set — never
   from what the browser claims the discount is worth. */

const round2 = (n) => Math.round(n * 100) / 100;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const { items, email, shipping, discountCode } = JSON.parse(event.body || "{}");
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

    const deal = await lookupDiscount(discountCode);
    const code = deal ? deal.code : "";
    const discount = deal ? round2((subtotal * deal.percent) / 100) : 0;
    const goods = round2(subtotal - discount);

    /* There is one service per destination, so the address settles both which
       one this is and what it costs — nothing the browser sends is consulted. */
    const method  = destKey(shipping?.country);
    const postage = shippingCost(goods, shipping?.country);
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
