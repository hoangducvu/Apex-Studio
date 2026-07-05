/* ============================================================
   LUMLA GLASSES — storefront interactions
   ============================================================ */

// ---- Stillness under automation (lets headless screenshots settle) ----
if (navigator.webdriver) document.documentElement.setAttribute("data-still", "");

// ---- Product data (populated from API, with a static fallback) ----
let PRODUCTS = [];

// Fallback catalog — mirrors the franchise line-up so the grid always
// renders when the API is unavailable (static hosting / offline).
const FALLBACK_PRODUCTS = [
  { id: "silver-light-20", name: "Silver Light Metallic 20", category: "Light Metallic", price: 39, image: "assets/products/azure.png",   badge: "BEST SELLER", quantity: 50 },
  { id: "black-light-20",  name: "Black Light Metallic 20",  category: "Light Metallic", price: 39, image: "assets/products/nox.png",     badge: "",            quantity: 50 },
  { id: "gold-light-20",   name: "Gold Light Metallic 20",   category: "Light Metallic", price: 42, image: "assets/products/ember.png",   badge: "NEW",         quantity: 50 },
  { id: "blue-light-20",   name: "Blue Light Metallic 20",   category: "Light Metallic", price: 42, image: "assets/products/riptide.png", badge: "",            quantity: 12 },
  { id: "heavy-chrome-01", name: "Chrome Heavy Metallic 01", category: "Heavy Metallic", price: 49, image: "assets/products/flare.png",   badge: "WORLD CUP",   quantity: 50 },
];

// ---- Currency ----
function fmt(n) {
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return "€" + n.toLocaleString("de-DE", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
const fmtEur = fmt;

// ---- Render product grid (with optional category filter) ----
const grid = document.getElementById("productGrid");
const filterBar = document.getElementById("filterBar");
let activeFilter = "ALL";

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

function renderGrid() {
  if (!grid) return;
  const list = PRODUCTS.filter((p) =>
    activeFilter === "ALL" ||
    slug(p.category) === activeFilter ||
    (activeFilter === "best-seller" && /best\s*seller/i.test(p.badge || ""))
  );
  if (!list.length) {
    grid.innerHTML = `<div class="grid-loading">No frames in this collection yet — check back soon.</div>`;
    return;
  }
  grid.innerHTML = list.map((p) => `
    <article class="card" data-reveal>
      <div class="card__media">
        ${p.badge ? `<span class="card__badge ${/sale/i.test(p.badge) ? "card__badge--sale" : ""}">${p.badge}</span>` : ""}
        ${p.quantity === 0 ? `<span class="card__badge card__badge--soft card__badge--stock">SOLD OUT</span>` : p.quantity <= 5 ? `<span class="card__badge card__badge--soft card__badge--stock">LOW STOCK</span>` : ""}
        <img src="${p.image}" alt="${p.name} glasses" loading="lazy" />
        ${p.quantity > 0 ? `<button class="card__add" data-add="${p.id}">Add to cart +</button>` : ""}
      </div>
      <div class="card__body">
        <div class="card__name">${p.name}</div>
        <div class="card__cat">${p.category || "Eyewear"}</div>
        <div class="card__stars" aria-hidden="true">★★★★★</div>
        <div class="card__price">${fmt(p.price)}</div>
      </div>
    </article>
  `).join("");
  grid.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
}

function renderFilters() {
  if (!filterBar) return;
  const cats = [...new Set(PRODUCTS.map((p) => p.category).filter(Boolean))];
  filterBar.innerHTML =
    `<button class="filter-btn" data-filter="ALL">All</button>` +
    cats.map((c) => `<button class="filter-btn" data-filter="${slug(c)}">${c}</button>`).join("") +
    `<button class="filter-btn" data-filter="best-seller">Best Seller</button>`;
  syncFilterButtons();
  if (filterBar.dataset.bound) return;
  filterBar.dataset.bound = "1";
  filterBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    activeFilter = btn.dataset.filter;
    syncFilterButtons();
    renderGrid();
  });
}

function syncFilterButtons() {
  if (!filterBar) return;
  filterBar.querySelectorAll(".filter-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.filter === activeFilter)
  );
}

async function loadProducts() {
  // Render the static catalog immediately so the grid never waits on the
  // network, then swap in live data if the API answers in time.
  PRODUCTS = FALLBACK_PRODUCTS;
  const want = new URLSearchParams(location.search).get("filter");
  if (want && filterBar) activeFilter = want;
  renderFilters();
  renderGrid();

  try {
    const res = await fetch("/api/products", { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    if (res.ok && Array.isArray(data) && data.length) {
      PRODUCTS = data;
      renderFilters();
      renderGrid();
    }
  } catch {
    /* server offline or slow — static catalog already shown */
  }
}

// ---- Cart state ----
const cart = new Map(); // id -> qty

const els = {
  drawer: document.getElementById("drawer"),
  overlay: document.getElementById("drawerOverlay"),
  items: document.getElementById("drawerItems"),
  count: document.getElementById("cartCount"),
  mobileCount: document.getElementById("mobileCartCount"),
  drawerCount: document.getElementById("drawerCount"),
  total: document.getElementById("drawerTotal"),
  toast: document.getElementById("toast"),
};

function cartQty() {
  let q = 0; cart.forEach((v) => (q += v)); return q;
}
function cartTotal() {
  let t = 0; cart.forEach((v, id) => { t += v * (PRODUCTS.find((p) => p.id === id)?.price ?? 0); }); return t;
}

function renderCart() {
  const q = cartQty();
  els.count.textContent = q;
  if (els.mobileCount) els.mobileCount.textContent = q;
  els.drawerCount.textContent = q;
  els.total.textContent = fmt(cartTotal());

  if (cart.size === 0) {
    els.items.innerHTML = `<p class="drawer__empty">Your cart is empty. Continue shopping.</p>`;
    return;
  }
  els.items.innerHTML = [...cart.entries()].map(([id, qty]) => {
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) return "";
    return `
      <div class="drawer-item">
        <img src="${p.image}" alt="${p.name}" />
        <div>
          <div class="drawer-item__name">${p.name}</div>
          <div class="drawer-item__price">${fmt(p.price)}</div>
          <div class="drawer-item__qty">
            <button data-dec="${id}" aria-label="Decrease">−</button>
            <span>${qty}</span>
            <button data-inc="${id}" aria-label="Increase">+</button>
          </div>
        </div>
        <button class="drawer-item__remove" data-remove="${id}">Remove</button>
      </div>`;
  }).join("");
}

function addToCart(id) {
  cart.set(id, (cart.get(id) || 0) + 1);
  renderCart();
  const p = PRODUCTS.find((p) => p.id === id);
  showToast(`${p ? p.name : id} added to cart`);
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function openDrawer() { els.drawer.classList.add("open"); els.overlay.classList.add("open"); }
function closeDrawer() { els.drawer.classList.remove("open"); els.overlay.classList.remove("open"); }

// ---- Event delegation ----
document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) { addToCart(add.dataset.add); openDrawer(); return; }

  const inc = e.target.closest("[data-inc]");
  if (inc) { cart.set(inc.dataset.inc, cart.get(inc.dataset.inc) + 1); renderCart(); return; }

  const dec = e.target.closest("[data-dec]");
  if (dec) {
    const id = dec.dataset.dec;
    const n = cart.get(id) - 1;
    if (n <= 0) cart.delete(id); else cart.set(id, n);
    renderCart(); return;
  }

  const rm = e.target.closest("[data-remove]");
  if (rm) { cart.delete(rm.dataset.remove); renderCart(); return; }
});

document.getElementById("cartOpen").addEventListener("click", openDrawer);
document.getElementById("cartClose").addEventListener("click", closeDrawer);
els.overlay.addEventListener("click", closeDrawer);
const mobileCartLink = document.getElementById("mobileCart");
if (mobileCartLink) mobileCartLink.addEventListener("click", (e) => { e.preventDefault(); closeMobile(); openDrawer(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

// ---- Announcement bar rotation ----
(function () {
  const msgs = document.querySelectorAll("#announce .announce__msg");
  if (msgs.length < 2) return;
  let i = 0;
  setInterval(() => {
    msgs[i].classList.remove("is-active");
    i = (i + 1) % msgs.length;
    msgs[i].classList.add("is-active");
  }, 3500);
})();

// ---- Stories carousel nav ----
(function () {
  const track = document.getElementById("storiesTrack");
  if (!track) return;
  const step = 258; // story width + gap
  document.getElementById("storiesPrev")?.addEventListener("click", () => track.scrollBy({ left: -step, behavior: "smooth" }));
  document.getElementById("storiesNext")?.addEventListener("click", () => track.scrollBy({ left: step, behavior: "smooth" }));
})();

// ---- Nav scroll state ----
const nav = document.getElementById("nav");
window.addEventListener("scroll", () => {
  nav.classList.toggle("scrolled", window.scrollY > 20);
});

// ---- Mobile menu ----
const burger = document.getElementById("burger");
const mobileMenu = document.getElementById("mobileMenu");
function closeMobile() { burger.classList.remove("active"); mobileMenu.classList.remove("open"); }
burger.addEventListener("click", () => {
  burger.classList.toggle("active");
  mobileMenu.classList.toggle("open");
});
mobileMenu.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMobile));

// ---- Newsletter (index.html only) ----
const newsForm = document.getElementById("newsForm");
if (newsForm) {
  newsForm.addEventListener("submit", (e) => {
    e.preventDefault();
    document.getElementById("newsNote").textContent = "Thanks for subscribing — exclusive offers are on the way.";
    e.target.reset();
  });
}

// ---- Reveal on scroll ----
const io = new IntersectionObserver((entries) => {
  entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
}, { threshold: 0.12 });
// Observe non-product-grid elements immediately (they exist in the DOM on load)
document.querySelectorAll("[data-reveal]:not(#productGrid *)").forEach(el => io.observe(el));

// ---- Year ----
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

// ── Checkout ─────────────────────────────────────────────────────────────
const coOverlay      = document.getElementById("coOverlay");
const coItems        = document.getElementById("coItems");
const coSubtotal     = document.getElementById("coSubtotal");
const coGrandTotal   = document.getElementById("coGrandTotal");
const coConfirmEmail = document.getElementById("coConfirmEmail");
const coOrderNum     = document.getElementById("coOrderNum");
const coPaymentError = document.getElementById("coPaymentError");
const coPlaceOrderBtn = document.getElementById("coPlaceOrder");
const coStripeLoader  = document.getElementById("coStripeLoader");

// ── Stripe state ──────────────────────────────────────────────────────────
let _stripe   = null;
let _elements = null;

async function getStripe() {
  if (!_stripe) {
    const { publishableKey } = await fetch("/api/config").then((r) => r.json());
    _stripe = Stripe(publishableKey);
  }
  return _stripe;
}

async function mountPaymentElement() {
  coStripeLoader.hidden = false;
  document.getElementById("payment-element").innerHTML = "";
  coPlaceOrderBtn.disabled = true;
  coPaymentError.hidden = true;

  try {
    const s = await getStripe();
    const email    = document.getElementById("coEmail").value.trim();
    const first    = document.getElementById("coFirst").value.trim();
    const last     = document.getElementById("coLast").value.trim();
    const address  = document.getElementById("coAddress").value.trim();
    const city     = document.getElementById("coCity").value.trim();
    const zip      = document.getElementById("coZip").value.trim();
    const country  = document.getElementById("coCountry").value;

    const items = [...cart.entries()].map(([id, qty]) => {
      const p = PRODUCTS.find((x) => x.id === id);
      return { id: p.id, name: p.name, qty, price: p.price };
    });

    const res = await fetch("/api/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: cartTotal(),
        items,
        email,
        shipping: { name: `${first} ${last}`.trim(), address, city, zip, country },
      }),
    });
    const { clientSecret, error } = await res.json();
    if (error) throw new Error(error);

    const appearance = {
      theme: "stripe",
      variables: {
        colorPrimary:          "#830083",
        colorBackground:       "#ffffff",
        colorText:             "#121212",
        colorDanger:           "#830083",
        colorTextPlaceholder:  "#9a96a4",
        fontFamily:            "'Poppins', system-ui, sans-serif",
        borderRadius:          "0px",
        spacingUnit:           "4px",
      },
      rules: {
        ".Input": {
          border:      "1px solid rgba(46,42,57,0.20)",
          padding:     "14px 16px",
          fontSize:    "0.95rem",
        },
        ".Input:focus": {
          border:     "1px solid #830083",
          boxShadow:  "0 0 0 3px rgba(131,0,131,0.08)",
        },
        ".Label": {
          color:          "#6d6878",
          fontSize:       "0.72rem",
          letterSpacing:  "0.06em",
          textTransform:  "uppercase",
          marginBottom:   "7px",
        },
        ".Tab": { border: "1px solid rgba(46,42,57,0.16)" },
        ".Tab--selected": { border: "1px solid #830083", color: "#2e2a39" },
        ".Tab--selected:hover": { color: "#2e2a39" },
      },
    };

    _elements = s.elements({ clientSecret, appearance });
    const paymentEl = _elements.create("payment", { layout: "tabs" });
    paymentEl.mount("#payment-element");
    paymentEl.on("ready", () => {
      coStripeLoader.hidden = true;
      coPlaceOrderBtn.disabled = false;
    });

  } catch (err) {
    coStripeLoader.hidden = true;
    coPaymentError.hidden = false;
    coPaymentError.textContent = err.message || "Could not load payment form. Try again.";
  }
}

// ── Checkout flow ─────────────────────────────────────────────────────────
function openCheckout() {
  if (cart.size === 0) { showToast("Your cart is empty!"); return; }
  renderCheckoutSummary();
  coOverlay.classList.add("open");
  coOverlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setCoStep(1);
}
function closeCheckout() {
  coOverlay.classList.remove("open");
  coOverlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function renderCheckoutSummary() {
  coItems.innerHTML = [...cart.entries()].map(([id, qty]) => {
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) return "";
    return `
      <div class="co__item">
        <img class="co__item-img" src="${p.image}" alt="${p.name}" />
        <div>
          <div class="co__item-name">${p.name}</div>
          <div class="co__item-qty">Qty: ${qty}</div>
        </div>
        <div class="co__item-price">${fmtEur(p.price * qty)}</div>
      </div>`;
  }).join("");
  const total = cartTotal();
  coSubtotal.textContent   = fmtEur(total);
  coGrandTotal.textContent = fmtEur(total);
}

function setCoStep(n) {
  [1, 2, 3].forEach((i) => {
    document.getElementById(`coPane${i}`).classList.toggle("co__pane--hidden", i !== n);
  });
  document.querySelectorAll(".co__step").forEach((el) => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.remove("co__step--active", "co__step--done");
    if (s === n) el.classList.add("co__step--active");
    if (s < n)  el.classList.add("co__step--done");
  });
  coOverlay.scrollTo({ top: 0, behavior: "smooth" });
}

// Step 1 → 2: validate info, then create PaymentIntent & mount Stripe element
document.getElementById("coToPayment").addEventListener("click", async () => {
  const email   = document.getElementById("coEmail").value.trim();
  const first   = document.getElementById("coFirst").value.trim();
  const address = document.getElementById("coAddress").value.trim();
  if (!email || !first || !address) {
    showToast("Please fill in your contact and address details");
    return;
  }
  setCoStep(2);
  await mountPaymentElement();
});

// Step 2 → back to 1
document.getElementById("coToInfo").addEventListener("click", () => setCoStep(1));

// Step 2 → place order via Stripe
coPlaceOrderBtn.addEventListener("click", async () => {
  if (!_elements) return;

  coPlaceOrderBtn.disabled = true;
  coPlaceOrderBtn.textContent = "Processing…";
  coPaymentError.hidden = true;

  const s = await getStripe();
  const { error, paymentIntent } = await s.confirmPayment({
    elements: _elements,
    confirmParams: {
      return_url: window.location.href,
      receipt_email: document.getElementById("coEmail").value.trim(),
    },
    redirect: "if_required",
  });

  if (error) {
    coPaymentError.hidden = false;
    coPaymentError.textContent = error.message;
    coPlaceOrderBtn.disabled = false;
    coPlaceOrderBtn.innerHTML = "Place Order <span>→</span>";
    return;
  }

  if (paymentIntent && paymentIntent.status === "succeeded") {
    const email = document.getElementById("coEmail").value.trim();
    coConfirmEmail.textContent = email || "your email";
    coOrderNum.textContent = "Order LML-" + paymentIntent.id.slice(-8).toUpperCase();
    cart.clear();
    renderCart();
    setCoStep(3);
  }
});

document.getElementById("checkoutBtn").addEventListener("click", () => { closeDrawer(); openCheckout(); });
document.getElementById("coBack").addEventListener("click", () => { closeCheckout(); openDrawer(); });
document.getElementById("coDone").addEventListener("click", () => {
  closeCheckout();
  _elements = null; // reset for next order
  coPlaceOrderBtn.disabled = false;
  coPlaceOrderBtn.innerHTML = "Place Order <span>→</span>";
});

// Handle redirect return (3DS or bank-redirect payment methods)
(async () => {
  const params = new URLSearchParams(window.location.search);
  const piSecret = params.get("payment_intent_client_secret");
  if (!piSecret) return;
  const s = await getStripe();
  const { paymentIntent } = await s.retrievePaymentIntent(piSecret);
  if (paymentIntent?.status === "succeeded") {
    history.replaceState({}, "", window.location.pathname);
    showToast("Payment confirmed — thank you!");
  }
})();

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && coOverlay.classList.contains("open")) closeCheckout();
});

// ---- Init ----
renderCart();
loadProducts();
