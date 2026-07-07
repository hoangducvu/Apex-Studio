require("dotenv").config();
const express    = require("express");
const stripe     = require("stripe")(process.env.STRIPE_SECRET_KEY);
const path       = require("path");
const fs         = require("fs");
const multer     = require("multer");
const nodemailer = require("nodemailer");
const db         = require("./db");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Upload config ──────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, "Apex Studio website", "assets", "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ok = /^image\/(jpeg|png|webp)$/.test(file.mimetype);
    cb(ok ? null : new Error("Only jpg/png/webp allowed"), ok);
  },
});

// Rename multer temp file to proper extension
function saveUpload(file) {
  if (!file) return null;
  const ext  = path.extname(file.originalname).toLowerCase() || ".jpg";
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const dest = path.join(UPLOADS_DIR, name);
  fs.renameSync(file.path, dest);
  return `/assets/uploads/${name}`;
}

// ── Email ──────────────────────────────────────────────────────────────────
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
        <h3 style="margin:0 0 12px">Items</h3>
        ${items.map(i => `<p>${i.name} × ${i.qty}</p>`).join("")}
        <hr style="border-color:rgba(255,255,255,.1);margin:20px 0">
        <p style="color:#7a7a84;font-size:.8em">View in <a href="https://dashboard.stripe.com/payments/${pi.id}" style="color:#d4fc00">Stripe Dashboard</a></p>
      </div>`,
  });
}

// ── Admin auth ─────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!process.env.ADMIN_PASSWORD || key !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── Serve admin panel ──────────────────────────────────────────────────────
// HTML is served openly so the browser can load the login form.
// All /api/admin/* routes are protected by requireAdmin.
app.get("/admin", (req, res) =>
  res.sendFile(path.join(__dirname, "admin", "index.html"))
);

// ── Product detail pages (pretty URLs) ─────────────────────────────────────
app.get("/products/:id", (req, res) =>
  res.sendFile(path.join(__dirname, "Apex Studio website", "product.html"))
);

// ── Static uploads (before main static) ───────────────────────────────────
app.use("/assets/uploads", express.static(UPLOADS_DIR));

// ── Main static site ───────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "Apex Studio website")));

// ── Stripe webhook (raw body) ──────────────────────────────────────────────
app.post("/api/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig    = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  if (secret) {
    try { event = stripe.webhooks.constructEvent(req.body, sig, secret); }
    catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }
  } else {
    console.warn("⚠  STRIPE_WEBHOOK_SECRET not set — skipping signature check");
    try { event = JSON.parse(req.body); } catch { return res.status(400).end(); }
  }

  if (event.type === "payment_intent.succeeded") {
    const pi    = event.data.object;
    const euros = (pi.amount_received / 100).toFixed(2);
    const items = JSON.parse(pi.metadata?.items_json || "[]");

    // Deduct inventory
    const deduct = db.prepare("UPDATE products SET quantity = MAX(0, quantity - ?) WHERE id = ?");
    db.transaction(() => { items.forEach(i => deduct.run(i.qty, i.id)); })();

    // Save order
    try {
      db.prepare("INSERT OR IGNORE INTO orders (stripe_id,email,items_json,total,status) VALUES (?,?,?,?,'paid')")
        .run(pi.id, pi.receipt_email || null, pi.metadata?.items_json || "[]", parseFloat(euros));
    } catch(e) { console.error("Order save error:", e.message); }

    console.log(`✅  Order saved  ${pi.id}  €${euros}  ${pi.receipt_email || ""}`);
    try { await notifyOwner(pi); } catch(e) { console.error("Email error:", e.message); }
  }

  if (event.type === "payment_intent.payment_failed") {
    console.log(`❌  Payment failed  ${event.data.object.id}`);
  }

  res.json({ received: true });
});

// ── JSON parser ────────────────────────────────────────────────────────────
app.use(express.json());

// ── Public API ─────────────────────────────────────────────────────────────
app.get("/api/config", (_, res) =>
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY })
);

app.get("/api/products", (_, res) => {
  const products = db.prepare(
    "SELECT * FROM products WHERE active=1 ORDER BY sort_order, created_at"
  ).all();
  res.json(products);
});

// ── Create PaymentIntent ───────────────────────────────────────────────────
app.post("/api/create-payment-intent", async (req, res) => {
  try {
    const { amount, items, email, shipping } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });

    const COUNTRY_CODES = {
      Austria:"AT", Belgium:"BE", Bulgaria:"BG", Croatia:"HR", Cyprus:"CY",
      "Czech Republic":"CZ", Denmark:"DK", Estonia:"EE", Finland:"FI",
      France:"FR", Germany:"DE", Greece:"GR", Hungary:"HU", Ireland:"IE",
      Italy:"IT", Latvia:"LV", Lithuania:"LT", Luxembourg:"LU", Malta:"MT",
      Netherlands:"NL", Poland:"PL", Portugal:"PT", Romania:"RO",
      Slovakia:"SK", Slovenia:"SI", Spain:"ES", Sweden:"SE",
    };

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

    res.json({ clientSecret: pi.client_secret });
  } catch (err) {
    console.error("PaymentIntent error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin API ──────────────────────────────────────────────────────────────

// List all products (incl. inactive)
app.get("/api/admin/products", requireAdmin, (req, res) => {
  const products = db.prepare(
    "SELECT p.*, (SELECT COUNT(*) FROM orders o WHERE o.items_json LIKE '%\"id\":\"'||p.id||'\"%') as order_count FROM products p ORDER BY p.sort_order, p.created_at DESC"
  ).all();
  res.json(products);
});

// Create product
app.post("/api/admin/products", requireAdmin, upload.single("image"), (req, res) => {
  try {
    const { name, category, price, badge, quantity, sort_order } = req.body;
    if (!name || !price) return res.status(400).json({ error: "name and price required" });
    const imagePath = saveUpload(req.file);
    if (!imagePath) return res.status(400).json({ error: "image required" });
    const id = `prod_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    db.prepare(
      "INSERT INTO products (id,name,category,price,image,badge,quantity,sort_order) VALUES (?,?,?,?,?,?,?,?)"
    ).run(id, name, category||"", parseFloat(price), imagePath, badge||"", parseInt(quantity)||0, parseInt(sort_order)||0);
    res.json(db.prepare("SELECT * FROM products WHERE id=?").get(id));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Update product
app.put("/api/admin/products/:id", requireAdmin, upload.single("image"), (req, res) => {
  try {
    const { name, category, price, badge, quantity, sort_order, active } = req.body;
    const existing = db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const imagePath = req.file ? saveUpload(req.file) : existing.image;
    db.prepare(
      "UPDATE products SET name=?,category=?,price=?,image=?,badge=?,quantity=?,sort_order=?,active=? WHERE id=?"
    ).run(
      name||existing.name, category??existing.category, parseFloat(price)||existing.price,
      imagePath, badge??existing.badge, parseInt(quantity)??existing.quantity,
      parseInt(sort_order)??existing.sort_order, active!==undefined ? (active==="true"||active===true?1:0) : existing.active,
      req.params.id
    );
    res.json(db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Adjust stock
app.patch("/api/admin/products/:id/stock", requireAdmin, (req, res) => {
  try {
    const { delta } = req.body;
    db.prepare("UPDATE products SET quantity = MAX(0, quantity + ?) WHERE id=?")
      .run(parseInt(delta)||0, req.params.id);
    const { quantity } = db.prepare("SELECT quantity FROM products WHERE id=?").get(req.params.id);
    res.json({ quantity });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Soft delete
app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  db.prepare("UPDATE products SET active=0 WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// Recent orders
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const orders = db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 50").all();
  res.json(orders);
});

// Stats for admin dashboard
app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const totalProducts = db.prepare("SELECT COUNT(*) as n FROM products WHERE active=1").get().n;
  const totalOrders   = db.prepare("SELECT COUNT(*) as n FROM orders").get().n;
  const totalRevenue  = db.prepare("SELECT COALESCE(SUM(total),0) as r FROM orders WHERE status='paid'").get().r;
  res.json({ totalProducts, totalOrders, totalRevenue });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const mode = process.env.STRIPE_SECRET_KEY?.startsWith("sk_live") ? "🟢  LIVE" : "🟡  TEST";
  const adminPw = process.env.ADMIN_PASSWORD ? "✅  set" : "❌  NOT SET (add ADMIN_PASSWORD to .env)";
  console.log(`\n🚀  LUMLA GLASSES  →  http://localhost:${PORT}`);
  console.log(`    Stripe:   ${mode}`);
  console.log(`    Admin PW: ${adminPw}`);
  console.log(`    Webhook:  POST /api/webhook`);
  console.log(`    Admin:    http://localhost:${PORT}/admin\n`);
});
