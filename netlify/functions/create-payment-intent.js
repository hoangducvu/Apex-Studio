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

// ── Lens customisation surcharges (mirror of LENS_OPTIONS in script.js) ─────
const LENS_OPTIONS = {
  none:   { price: 0,  colors: 0, label: "Standard lens" },
  single: { price: 30, colors: 1, label: "Custom lens — 1 colour" },
  duo:    { price: 35, colors: 2, label: "Custom lens — 2 colours / gradient" },
};

// ── Discount codes (mirror of DISCOUNTS in script.js) ───────────────────────
const DISCOUNTS = {
  LUMLA: { percent: 10, label: "LUMLA · 10% off" },
};

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
      const lensType = LENS_OPTIONS[i.lens?.type] ? i.lens.type : "none";
      const lensCfg  = LENS_OPTIONS[lensType];
      const colors   = Array.isArray(i.lens?.colors)
        ? i.lens.colors.slice(0, lensCfg.colors).map((c) => String(c).slice(0, 40))
        : [];

      const unit = round2(Number(p.price) + lensCfg.price);
      subtotal += unit * qty;

      lines.push({
        id: p.id,
        name: p.name,
        qty,
        unit,
        lens: lensType === "none"
          ? ""
          : `${lensCfg.label}${colors.length ? " (" + colors.join(" → ") + ")" : ""}`,
      });
    }
    subtotal = round2(subtotal);

    const code = String(discountCode || "").trim().toUpperCase();
    const deal = DISCOUNTS[code];
    const discount = deal ? round2((subtotal * deal.percent) / 100) : 0;
    const total = round2(subtotal - discount);

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
        items_json:    JSON.stringify(lines.map((l) => ({ id: l.id, qty: l.qty, name: l.name, lens: l.lens }))).slice(0, 500),
        items_display: lines.map((l) => `${l.name}${l.lens ? " [" + l.lens + "]" : ""} ×${l.qty}`).join(", ").slice(0, 500),
        subtotal:      subtotal.toFixed(2),
        discount_code: deal ? code : "",
        discount:      discount.toFixed(2),
        source: "lumla-glasses-web",
      },
      payment_method_types: ["card"],
    });

    return json(200, {
      clientSecret: pi.client_secret,
      amount: total,
      subtotal,
      discount,
      discountApplied: !!deal,
    });
  } catch (err) {
    console.error("PaymentIntent error:", err.message);
    return json(500, { error: err.message });
  }
};
