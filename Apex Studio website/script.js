/* ============================================================
   LUMLA GLASSES — storefront interactions
   ============================================================ */

// ---- Stillness under automation (lets headless screenshots settle) ----
if (navigator.webdriver) document.documentElement.setAttribute("data-still", "");

// ---- Product data (populated from API, with a static fallback) ----
let PRODUCTS = [];

/* Catalog status: "loading" until the request settles, then "ready" (live data)
   or "failed" (API unreachable — the built-in catalog stands in).
   The grid and the product page render skeletons while loading rather than
   guessing from the fallback: showing it first is what made the wrong frames
   flash up, and made a real product read "Frame not found" for a moment. */
let CATALOG_STATE = "loading";

// Fallback catalog — mirrors the franchise line-up so the grid always
// renders when the API is unavailable (static hosting / offline).
const FALLBACK_PRODUCTS = [
  { id: "silver-light-20", name: "Silver Light Metallic 20", category: "Light Metallic", price: 39, image: "assets/products/azure.png",   badge: "BEST SELLER", quantity: 50 },
  { id: "black-light-20",  name: "Black Light Metallic 20",  category: "Light Metallic", price: 39, image: "assets/products/nox.png",     badge: "",            quantity: 50 },
  { id: "gold-light-20",   name: "Gold Light Metallic 20",   category: "Light Metallic", price: 42, image: "assets/products/ember.png",   badge: "NEW",         quantity: 50 },
  { id: "blue-light-20",   name: "Blue Light Metallic 20",   category: "Light Metallic", price: 42, image: "assets/products/riptide.png", badge: "",            quantity: 12 },
  { id: "heavy-chrome-01", name: "Chrome Heavy Metallic 01", category: "Heavy Metallic", price: 49, image: "assets/products/flare.png",   badge: "",            quantity: 50 },
];

// Frames are sold as pictured — one price per pair.
function unitPrice(p) { return p?.price || 0; }

/* ============================================================
   SHIPPING
   ------------------------------------------------------------
   MaltaPost prices Malta → anywhere in the EU as one zone, so the
   destination never changes the cost — only the weight of the parcel does,
   and a packed pair sits in the 101–300 g band (€5.81 untracked / €13.29
   tracked). These rates round that up to absorb two-pair orders.

   Mirrored server-side in create-payment-intent.js, which always
   recalculates the charge — this is only the storefront view.
   ============================================================ */
const SHIPPING = {
  standard: {
    price: 5.95,
    label: "Standard",
    sub:   "No tracking",
  },
  tracked: {
    price: 13.95,
    label: "Tracked & signed",
    sub:   "Tracked, signed for on delivery",
  },
};
const FREE_SHIPPING_OVER = 90;

/* How long the parcel is in transit is set by where it lands, not by which
   service carries it: Malta is a local hop, everywhere else crosses a border.
   Both services quote the same window for a given destination. */
const DELIVERY = {
  malta: { label: "Malta",         eta: "2–3 days",   long: "2–3 business days" },
  intl:  { label: "International", eta: "10–20 days", long: "10–20 business days" },
};
// Anything that isn't Malta is treated as international.
function destKey(country) {
  return String(country || "").trim().toLowerCase() === "malta" ? "malta" : "intl";
}
function chosenCountry() {
  return document.getElementById("coCountry")?.value || "";
}
/* Before a country is picked there is nothing to narrow it down to, so the
   line names both windows rather than guessing at one. */
function deliveryLine(country = chosenCountry()) {
  if (!String(country).trim()) {
    return `${DELIVERY.malta.label} ${DELIVERY.malta.eta} · intl ${DELIVERY.intl.eta}`;
  }
  const d = DELIVERY[destKey(country)];
  return `${d.label} · ${d.eta}`;
}

let shipMethod = "standard";

/* Over the threshold the standard rate is waived, and tracked costs the
   difference — the shop spends the same either way, so upgrading stays
   worth it on a big order. */
function shippingCost(method = shipMethod, goods = cartTotal()) {
  const opt = SHIPPING[method] || SHIPPING.standard;
  const waived = goods >= FREE_SHIPPING_OVER ? SHIPPING.standard.price : 0;
  return Math.round(Math.max(0, opt.price - waived) * 100) / 100;
}

// What the card is actually charged: goods after discount, plus postage.
function orderTotal() {
  return Math.round((cartTotal() + shippingCost()) * 100) / 100;
}

/* ============================================================
   DISCOUNT CODES
   ------------------------------------------------------------
   Codes are set in the admin panel, not in this file. Applying one
   asks the API about that single code — the full list is never
   published, so a code only works for someone who was sent it.

   create-payment-intent.js checks the same store and recalculates the
   charge, so this is only the storefront view of the deal.
   ============================================================ */
let promo = null; // { code, percent, label }

// Asks the API whether one code is live. Resolves to the deal, or null.
async function lookupDiscount(code) {
  try {
    const res = await fetch(`/api/discounts?code=${encodeURIComponent(code)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const deal = await res.json();
    return deal && deal.percent > 0 ? deal : null;
  } catch {
    return null;
  }
}

/* ============================================================
   COLOUR VARIANT GROUPING  —  controlled from the admin panel
   ------------------------------------------------------------
   Two frames belong together when they share the same "Colour group"
   label (products.variant_group). Nothing is guessed from the name:
   set the group in Admin → Edit product → Colour group, and give each
   one a "Colour name" for its swatch. A blank group = stands alone.
   ============================================================ */
// Grouping set in the admin panel. Prefers the products.variant_group column
// and falls back to the Storage-backed map when that column doesn't exist yet.
let VARIANT_MAP = {};
function groupOf(p) {
  return String(p?.variant_group || VARIANT_MAP[p?.id]?.group || "").trim();
}

// Unique per product when no group is set, so it renders as its own card.
function styleKey(p) {
  const g = groupOf(p);
  return g ? "G:" + g.toUpperCase() : "P:" + p.id;
}
function colorOf(p) {
  return String(p?.color_label || VARIANT_MAP[p?.id]?.color || "").trim() || String(p?.name || "");
}
// Headline for a grouped card: the group label reads as the style name.
function styleName(p) {
  return groupOf(p) || String(p?.name || "");
}
function groupVariants(list) {
  const map = new Map();
  list.forEach((p) => {
    const k = styleKey(p);
    if (!map.has(k)) map.set(k, { key: k, items: [] });
    map.get(k).items.push(p);
  });
  return [...map.values()];
}

// ---- Currency ----
function fmt(n) {
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return "€" + n.toLocaleString("de-DE", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
const fmtEur = fmt;
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Render product grid (with optional category filter) ----
const grid = document.getElementById("productGrid");
const filterBar = document.getElementById("filterBar");
let activeFilter = "ALL";

// ---- Product detail page (/products/<id> → product.html) ----
const pdContent = document.getElementById("pdContent");
const isProductPage = !!pdContent;

function currentProductId() {
  const m = location.pathname.match(/\/products\/([^\/?#]+)/);
  if (m) return decodeURIComponent(m[1]);
  return new URLSearchParams(location.search).get("id");
}

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

/* ============================================================
   PRODUCT IMAGES  —  ordered gallery, managed in the admin panel
   ------------------------------------------------------------
   Each product carries an ordered list of shots:
     [0] the main image
     [1] revealed when the shopper hovers the card / main image
     [2…] extra thumbnails on the product page
   Prefers the products.images column and falls back to the
   Storage-backed map when that column doesn't exist yet.
   ============================================================ */
let PRODUCT_IMAGES = {};

// Resolve an image path to a root-absolute URL so it works from any page
// depth (the detail pages live at /products/<id>).
function resolveUrl(src) {
  const s = String(src || "");
  return /^(https?:)?\/\//.test(s) || s.startsWith("/") ? s : "/" + s;
}

// The full gallery, main shot first, always at least one entry.
function imagesOf(p) {
  if (!p) return [];
  const raw = Array.isArray(p.images) && p.images.length
    ? p.images
    : PRODUCT_IMAGES[p.id] || [];
  const list = [p.image, ...raw]
    .map(resolveUrl)
    .filter((s, i, a) => s && s !== "/" && a.indexOf(s) === i);
  return list.length ? list : [resolveUrl(p.image)];
}

function imgUrl(p) { return imagesOf(p)[0] || ""; }

// The shot to reveal on hover — null when there's only one image.
function hoverUrl(p) { return imagesOf(p)[1] || null; }
/* ── Loading skeletons ─────────────────────────────────────────────────── */
function skeletonCards(n) {
  return Array.from({ length: n }, () => `
    <article class="card card--skeleton" aria-hidden="true">
      <div class="card__media skeleton"></div>
      <div class="card__body">
        <div class="skeleton skeleton--line" style="width:72%"></div>
        <div class="skeleton skeleton--line" style="width:40%"></div>
        <div class="skeleton skeleton--line" style="width:28%"></div>
      </div>
    </article>`).join("");
}

function productDetailSkeleton() {
  return `
    <div class="pd__col" aria-hidden="true">
      <div class="pd__media skeleton"></div>
    </div>
    <div class="pd__info" aria-hidden="true">
      <div class="skeleton skeleton--line" style="width:26%"></div>
      <div class="skeleton skeleton--line skeleton--title"></div>
      <div class="skeleton skeleton--line" style="width:22%"></div>
      <div class="skeleton skeleton--line" style="width:52%"></div>
      <div class="skeleton skeleton--block"></div>
    </div>`;
}

/* ── Product detail ────────────────────────────────────────────────────── */
function renderProductDetail() {
  if (!pdContent) return;

  // Don't accuse a real product of not existing before the catalog has landed
  if (CATALOG_STATE === "loading") {
    pdContent.innerHTML = productDetailSkeleton();
    return;
  }

  const id = currentProductId();
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) {
    pdContent.innerHTML = `
      <div class="pd__missing">
        <h1>Frame not found</h1>
        <p>This product may have sold out or been removed.</p>
        <a class="btn btn--primary" href="/shop.html">Browse the catalog <span>→</span></a>
      </div>`;
    return;
  }

  document.title = `${p.name} — LUMLA GLASSES`;
  const soldOut  = p.quantity === 0;
  const prevQty  = parseInt(document.getElementById("pdQtyVal")?.textContent, 10) || 1;
  const qty      = soldOut ? 1 : Math.min(prevQty, p.quantity);

  // Same frame, other colours
  const siblings = PRODUCTS.filter((x) => styleKey(x) === styleKey(p));
  const variantsHtml = siblings.length > 1 ? `
    <div class="pd__variants">
      <div class="pd__variants-title">Colour — ${esc(colorOf(p))} · ${siblings.length} available</div>
      <div class="card__swatches">
        ${siblings.map((v) => `
          <a class="swatch${v.id === p.id ? " is-active" : ""}" href="/products/${encodeURIComponent(v.id)}"
             data-preview="${esc(imgUrl(v))}" title="${esc(colorOf(v))} — ${esc(fmt(v.price))}">
            <img src="${esc(imgUrl(v))}" alt="${esc(colorOf(v))}" loading="lazy" />
          </a>`).join("")}
      </div>
    </div>` : "";

  // Gallery — main shot plus every extra image, in the admin panel's order
  const shots = imagesOf(p);
  const galleryHtml = shots.length > 1 ? `
    <div class="pd__gallery" id="pdGallery">
      ${shots.map((src, i) => `
        <button type="button" class="pd__thumb${i === 0 ? " is-active" : ""}"
                data-shot="${esc(src)}" aria-label="View image ${i + 1} of ${shots.length}">
          <img src="${esc(src)}" alt="" loading="lazy" />
        </button>`).join("")}
    </div>` : "";

  pdContent.innerHTML = `
    <div class="pd__col">
      <div class="pd__media${shots[1] ? " pd__media--has-alt" : ""}">
        ${p.badge ? `<span class="card__badge ${/sale/i.test(p.badge) ? "card__badge--sale" : ""}">${esc(p.badge)}</span>` : ""}
        <img src="${esc(shots[0])}" alt="${esc(p.name)} glasses" id="pdMainImg" data-default="${esc(shots[0])}" />
        ${shots[1] ? `<img class="pd__media-alt" src="${esc(shots[1])}" alt="" aria-hidden="true" id="pdAltImg" />` : ""}
      </div>
      ${galleryHtml}
    </div>
    <div class="pd__info">
      <p class="pd__cat">${esc(p.category || "Eyewear")}</p>
      <h1 class="pd__name">${esc(p.name)}</h1>
      <div class="pd__stars" aria-hidden="true">★★★★★ <span>Loved by our customers</span></div>
      <div class="pd__price">${fmt(p.price)}</div>
      <p class="pd__stock ${soldOut ? "pd__stock--out" : ""}">
        ${soldOut ? "Sold out" : `In stock — ${deliveryLine()}`}
      </p>

      ${variantsHtml}

      <div class="pd__buy">
        <div class="pd__qty" ${soldOut ? "hidden" : ""}>
          <button id="pdQtyMinus" aria-label="Decrease quantity">−</button>
          <span id="pdQtyVal">${qty}</span>
          <button id="pdQtyPlus" aria-label="Increase quantity">+</button>
        </div>
        <button class="btn btn--primary pd__add" id="pdAdd" ${soldOut ? "disabled" : ""}>
          ${soldOut ? "Sold out" : "Add to cart +"}
        </button>
      </div>

      <p class="pd__note">Every pair ships as pictured. Questions? <a href="/contact.html">Contact us</a>.</p>

      <ul class="pd__specs">
        <li><span>Fit</span> Freesize — suits most face shapes</li>
        <li><span>Lenses</span> UV400 protection</li>
        <li><span>Includes</span> Protective case &amp; cleaning cloth</li>
        <li><span>Shipping</span> From ${fmt(SHIPPING.standard.price)} · free over ${fmt(FREE_SHIPPING_OVER)}</li>
        <li><span>Delivery</span> ${deliveryLine()}</li>
      </ul>
    </div>`;

  // Gallery thumbnails — click to make one the main shot. The hover overlay
  // always previews whatever comes next in the admin panel's order.
  const gallery = document.getElementById("pdGallery");
  if (gallery) {
    gallery.addEventListener("click", (e) => {
      const thumb = e.target.closest(".pd__thumb");
      if (!thumb) return;
      const src  = thumb.dataset.shot;
      const alt  = document.getElementById("pdAltImg");
      const main = document.getElementById("pdMainImg");
      if (main) { main.src = src; main.dataset.default = src; }
      if (alt) {
        const next = shots[shots.indexOf(src) + 1];
        alt.hidden = !next;
        if (next) alt.src = next;
      }
      gallery.querySelectorAll(".pd__thumb").forEach((t) =>
        t.classList.toggle("is-active", t === thumb));
    });
  }

  if (!soldOut) {
    const qtyVal = document.getElementById("pdQtyVal");
    document.getElementById("pdQtyMinus").addEventListener("click", () => {
      qtyVal.textContent = Math.max(1, parseInt(qtyVal.textContent, 10) - 1);
    });
    document.getElementById("pdQtyPlus").addEventListener("click", () => {
      qtyVal.textContent = Math.min(p.quantity, parseInt(qtyVal.textContent, 10) + 1);
    });
    document.getElementById("pdAdd").addEventListener("click", () => {
      addToCart(p.id, parseInt(qtyVal.textContent, 10) || 1);
      openDrawer();
    });
  }
}

/* ── Product grid (colour variants collapsed into one card) ─────────────── */
function cardHtml(group) {
  const p = group.items[0];
  const many = group.items.length > 1;

  const swatches = many ? `
    <div class="card__swatches">
      ${group.items.map((v, i) => `
        <button type="button" class="swatch${i === 0 ? " is-active" : ""}"
                data-variant="${esc(v.id)}" title="${esc(colorOf(v))}" aria-label="${esc(colorOf(v))}">
          <img src="${esc(imgUrl(v))}" alt="${esc(colorOf(v))}" loading="lazy" />
        </button>`).join("")}
    </div>` : "";

  return `
    <article class="card${hoverUrl(p) ? " card--has-alt" : ""}" data-reveal data-card>
      <div class="card__media">
        ${p.badge ? `<span class="card__badge ${/sale/i.test(p.badge) ? "card__badge--sale" : ""}" data-card-badge>${esc(p.badge)}</span>` : `<span class="card__badge" data-card-badge hidden></span>`}
        ${p.quantity === 0 ? `<span class="card__badge card__badge--soft card__badge--stock" data-card-stock>SOLD OUT</span>` : `<span class="card__badge card__badge--soft card__badge--stock" data-card-stock hidden></span>`}
        <a class="card__media-link" href="/products/${encodeURIComponent(p.id)}" data-card-link aria-label="View ${esc(p.name)}">
          <img src="${imgUrl(p)}" alt="${esc(p.name)} glasses" data-card-img loading="lazy" />
          <img class="card__media-alt" src="${esc(hoverUrl(p) || "")}" alt="" aria-hidden="true"
               data-card-img-alt loading="lazy" ${hoverUrl(p) ? "" : "hidden"} />
        </a>
        ${p.quantity > 0 ? `<button class="card__add" data-add="${esc(p.id)}" data-card-add>Add to cart +</button>` : `<button class="card__add" data-card-add hidden></button>`}
      </div>
      ${swatches}
      <a class="card__link" href="/products/${encodeURIComponent(p.id)}" data-card-link>
        <div class="card__body">
          <div class="card__name" data-card-name>${esc(many ? styleName(p) : p.name)}</div>
          <div class="card__cat" data-card-cat>${esc(many ? colorOf(p) : (p.category || "Eyewear"))}</div>
          <div class="card__price" data-card-price>${fmt(p.price)}</div>
          ${many ? `<div class="card__variant-count">${group.items.length} colours</div>` : ""}
        </div>
      </a>
    </article>`;
}

// Swap a card over to one of its colour variants (hover / tap on a swatch)
function showVariant(card, id) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return;
  const set = (sel, fn) => { const el = card.querySelector(sel); if (el) fn(el); };
  set("[data-card-img]", (el) => { el.src = imgUrl(p); el.alt = `${p.name} glasses`; });
  set("[data-card-img-alt]", (el) => {
    const alt = hoverUrl(p);
    el.hidden = !alt;
    if (alt) el.src = alt;
    // Whether this colour has a second shot at all; the listener above reads
    // it to decide if hovering the photo should swap.
    card.classList.toggle("card--has-alt", !!alt);
    if (!alt) card.classList.remove("card--show-alt");
  });
  set("[data-card-name]", (el) => { el.textContent = styleName(p); });
  set("[data-card-cat]", (el) => { el.textContent = colorOf(p); });
  set("[data-card-price]", (el) => { el.textContent = fmt(p.price); });
  set("[data-card-badge]", (el) => { el.textContent = p.badge || ""; el.hidden = !p.badge; });
  set("[data-card-stock]", (el) => {
    const txt = p.quantity === 0 ? "SOLD OUT" : "";
    el.textContent = txt; el.hidden = !txt;
  });
  set("[data-card-add]", (el) => {
    el.hidden = p.quantity === 0;
    el.textContent = "Add to cart +";
    el.dataset.add = p.id;
  });
  card.querySelectorAll("[data-card-link]").forEach((a) => {
    a.href = "/products/" + encodeURIComponent(p.id);
  });
  card.querySelectorAll(".swatch").forEach((s) =>
    s.classList.toggle("is-active", s.dataset.variant === id));
}

function renderGrid() {
  if (!grid) return;

  if (CATALOG_STATE === "loading") {
    // The "You may also like" rail stays hidden until there's something real
    if (isProductPage) {
      const related = document.getElementById("pdRelated");
      if (related) related.hidden = true;
      grid.innerHTML = "";
    } else {
      grid.innerHTML = skeletonCards(filterBar ? 8 : 4);
    }
    return;
  }

  let list;
  if (isProductPage) {
    // Detail page: grid becomes "You may also like" (everything but this style)
    const current = currentProductId();
    const cur = PRODUCTS.find((x) => x.id === current);
    const curKey = cur ? styleKey(cur) : null;
    list = PRODUCTS.filter((p) => p.id !== current && styleKey(p) !== curKey);
    const related = document.getElementById("pdRelated");
    if (related) related.hidden = list.length === 0;
  } else if (!filterBar) {
    // Homepage "Best Sellers": just a few frames, best-seller badges first
    const isBest = (p) => /best\s*seller/i.test(p.badge || "");
    list = [...PRODUCTS.filter(isBest), ...PRODUCTS.filter((p) => !isBest(p))];
  } else {
    list = PRODUCTS.filter((p) =>
      activeFilter === "ALL" ||
      slug(p.category) === activeFilter ||
      (activeFilter === "best-seller" && /best\s*seller/i.test(p.badge || ""))
    );
  }

  let groups = groupVariants(list);
  if (isProductPage) groups = groups.slice(0, 4);
  else if (!filterBar) groups = groups.slice(0, 8);

  if (!groups.length) {
    grid.innerHTML = isProductPage ? "" : `<div class="grid-loading">No frames in this collection yet — check back soon.</div>`;
    return;
  }
  grid.innerHTML = groups.map(cardHtml).join("");
  grid.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
}

/* Which card, if any, should be showing its second image.
 *
 * CSS cannot express this on its own: :hover covers the whole card, and the
 * swatches sit inside it, so a swatch preview would inherit the hover shot.
 * One listener decides it here instead — mouseover fires on whatever the
 * pointer enters, so this runs on every move between the parts of a card.
 *
 * Over the swatches there is no hover effect at all: the card shows that
 * colour's first shot, which is the photo a colour preview is meant to show.
 */
document.addEventListener("mouseover", (e) => {
  const card     = e.target.closest("[data-card]");
  const onSwatch = !!e.target.closest(".card__swatches");
  const show     = card && !onSwatch && card.classList.contains("card--has-alt") ? card : null;

  document.querySelectorAll(".card--show-alt")
    .forEach((c) => { if (c !== show) c.classList.remove("card--show-alt"); });
  if (show) show.classList.add("card--show-alt");
});

// Hover (and tap) a swatch → swap the card over to that colour.
document.addEventListener("mouseover", (e) => {
  const sw = e.target.closest(".swatch[data-variant]");
  if (!sw) return;
  const card = sw.closest("[data-card]");
  if (card) showVariant(card, sw.dataset.variant);
});
document.addEventListener("click", (e) => {
  const sw = e.target.closest(".swatch[data-variant]");
  if (!sw) return;
  e.preventDefault();
  const card = sw.closest("[data-card]");
  if (card) showVariant(card, sw.dataset.variant);
});
// Product page: hovering a colour previews it in the main shot
document.addEventListener("mouseover", (e) => {
  const sw = e.target.closest(".swatch[data-preview]");
  const main = document.getElementById("pdMainImg");
  if (!sw || !main) return;
  main.src = sw.dataset.preview;
});
document.addEventListener("mouseout", (e) => {
  const sw = e.target.closest(".swatch[data-preview]");
  const main = document.getElementById("pdMainImg");
  if (!sw || !main) return;
  main.src = main.dataset.default;
});

function renderFilters() {
  if (!filterBar) return;
  const cats = [...new Set(PRODUCTS.map((p) => p.category).filter(Boolean))];
  filterBar.innerHTML =
    `<button class="filter-btn" data-filter="ALL">All</button>` +
    cats.map((c) => `<button class="filter-btn" data-filter="${slug(c)}">${esc(c)}</button>`).join("") +
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

// Collection cards marked data-collection-art pull their artwork from the live
// catalog. Cards without it keep the hand-picked image in the HTML.
function renderCollectionArt() {
  document.querySelectorAll("[data-collection][data-collection-art]").forEach((el) => {
    const cat = el.dataset.collection.toLowerCase();
    const inCat = PRODUCTS.filter(
      (p) => (p.category || "").toLowerCase() === cat && p.image
    );
    if (!inCat.length) return;
    const newest = inCat.reduce((a, b) =>
      new Date(b.created_at || 0) > new Date(a.created_at || 0) ? b : a);
    const img = el.querySelector("img");
    if (!img) return;
    img.src = imgUrl(newest);
    img.alt = `${el.dataset.collection} collection`;
    el.classList.add("collection-card--shot");
  });
}

async function loadProducts() {
  const want = new URLSearchParams(location.search).get("filter");
  if (want && filterBar) activeFilter = want;

  // Skeletons first — never the built-in catalog. Everything below renders
  // once, when the real answer is in, so the shopper sees one state change
  // instead of the wrong frames followed by the right ones.
  renderGrid();
  renderProductDetail();

  try {
    const sideload = (url) =>
      fetch(url, { signal: AbortSignal.timeout(8000) })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));

    const [res, groups, galleries] = await Promise.all([
      fetch("/api/products", { signal: AbortSignal.timeout(8000) }),
      sideload("/api/variant-groups"),
      sideload("/api/product-images"),
    ]);
    VARIANT_MAP    = groups    && typeof groups    === "object" ? groups    : {};
    PRODUCT_IMAGES = galleries && typeof galleries === "object" ? galleries : {};

    const data = await res.json();
    if (!res.ok || !Array.isArray(data) || !data.length) throw new Error("empty catalog");
    PRODUCTS = data;
    CATALOG_STATE = "ready";
  } catch {
    // API unreachable (offline, or served as plain static files) — stand the
    // built-in catalog up so the shop still works.
    PRODUCTS = FALLBACK_PRODUCTS;
    CATALOG_STATE = "failed";
  }

  renderFilters();
  renderGrid();
  renderProductDetail();
  renderCollectionArt();
  renderCart();
}

/* ============================================================
   CART  —  one line per product.
   ============================================================ */
const cart = new Map(); // id -> { id, qty }

const els = {
  drawer: document.getElementById("drawer"),
  overlay: document.getElementById("drawerOverlay"),
  items: document.getElementById("drawerItems"),
  count: document.getElementById("cartCount"),
  mobileCount: document.getElementById("mobileCartCount"),
  drawerCount: document.getElementById("drawerCount"),
  subtotal: document.getElementById("drawerSubtotal"),
  discountRow: document.getElementById("drawerDiscountRow"),
  discountLabel: document.getElementById("drawerDiscountLabel"),
  discount: document.getElementById("drawerDiscount"),
  total: document.getElementById("drawerTotal"),
  toast: document.getElementById("toast"),
};

function cartQty() {
  let q = 0; cart.forEach((l) => (q += l.qty)); return q;
}
function cartSubtotal() {
  let t = 0;
  cart.forEach((l) => {
    const p = PRODUCTS.find((x) => x.id === l.id);
    t += l.qty * unitPrice(p);
  });
  return Math.round(t * 100) / 100;
}
function discountAmount() {
  if (!promo) return 0;
  return Math.round(cartSubtotal() * promo.percent) / 100;
}
function cartTotal() {
  return Math.round((cartSubtotal() - discountAmount()) * 100) / 100;
}

function renderCart() {
  const q = cartQty();
  els.count.textContent = q;
  if (els.mobileCount) els.mobileCount.textContent = q;
  els.drawerCount.textContent = q;

  const sub = cartSubtotal();
  const disc = discountAmount();
  if (els.subtotal) els.subtotal.textContent = fmt(sub);
  if (els.discountRow) {
    els.discountRow.hidden = !promo || disc === 0;
    if (els.discountLabel && promo) els.discountLabel.textContent = promo.label;
    if (els.discount) els.discount.textContent = "−" + fmt(disc);
  }
  els.total.textContent = fmt(cartTotal());

  if (cart.size === 0) {
    els.items.innerHTML = `<p class="drawer__empty">Your cart is empty. Continue shopping.</p>`;
    return;
  }
  els.items.innerHTML = [...cart.entries()].map(([key, line]) => {
    const p = PRODUCTS.find((x) => x.id === line.id);
    if (!p) return "";
    return `
      <div class="drawer-item">
        <img src="${imgUrl(p)}" alt="${esc(p.name)}" />
        <div>
          <div class="drawer-item__name">${esc(p.name)}</div>
          <div class="drawer-item__price">${fmt(unitPrice(p))}</div>
          <div class="drawer-item__qty">
            <button data-dec="${esc(key)}" aria-label="Decrease">−</button>
            <span>${line.qty}</span>
            <button data-inc="${esc(key)}" aria-label="Increase">+</button>
          </div>
        </div>
        <button class="drawer-item__remove" data-remove="${esc(key)}">Remove</button>
      </div>`;
  }).join("");
}

function addToCart(id, qty = 1) {
  const line = cart.get(id) || { id, qty: 0 };
  line.qty += qty;
  cart.set(id, line);
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
  if (add) { e.preventDefault(); addToCart(add.dataset.add); openDrawer(); return; }

  const inc = e.target.closest("[data-inc]");
  if (inc) {
    const l = cart.get(inc.dataset.inc);
    if (l) { l.qty += 1; renderCart(); }
    return;
  }

  const dec = e.target.closest("[data-dec]");
  if (dec) {
    const key = dec.dataset.dec;
    const l = cart.get(key);
    if (!l) return;
    l.qty -= 1;
    if (l.qty <= 0) cart.delete(key);
    renderCart(); return;
  }

  const rm = e.target.closest("[data-remove]");
  if (rm) { cart.delete(rm.dataset.remove); renderCart(); return; }
});

/* ---- Discount code ---- */
const promoForm = document.getElementById("promoForm");
if (promoForm) {
  const note = document.getElementById("promoNote");
  const promoBtn = promoForm.querySelector("button");
  promoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = document.getElementById("promoInput").value.trim().toUpperCase();
    note.classList.remove("is-ok", "is-err");
    if (!raw) { promo = null; note.textContent = ""; renderCart(); return; }

    // The check is a round trip now, so say so rather than looking frozen.
    note.textContent = "Checking…";
    if (promoBtn) promoBtn.disabled = true;
    const d = await lookupDiscount(raw);
    if (promoBtn) promoBtn.disabled = false;

    if (!d) {
      promo = null;
      note.textContent = "That code isn't valid";
      note.classList.add("is-err");
    } else {
      promo = { code: d.code, percent: d.percent, label: d.label };
      note.textContent = `${d.label} applied`;
      note.classList.add("is-ok");
    }
    renderCart();
    if (coOverlay?.classList.contains("open")) renderCheckoutSummary();
  });
}

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

// ---- Nav scroll state ----
const nav = document.getElementById("nav");
const topbar = document.getElementById("topbar");
window.addEventListener("scroll", () => {
  const on = window.scrollY > 20;
  nav.classList.toggle("scrolled", on);
  topbar?.classList.toggle("scrolled", on);
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
const coDiscountRow  = document.getElementById("coDiscountRow");
const coDiscountLbl  = document.getElementById("coDiscountLabel");
const coDiscountVal  = document.getElementById("coDiscount");
const coGrandTotal   = document.getElementById("coGrandTotal");
const coShipping     = document.getElementById("coShipping");
const coShipNote     = document.getElementById("coShipNote");
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

function cartLines() {
  return [...cart.values()].map((l) => {
    const p = PRODUCTS.find((x) => x.id === l.id);
    return {
      id: l.id,
      name: p?.name || l.id,
      qty: l.qty,
      price: unitPrice(p),
    };
  });
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

    const res = await fetch("/api/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: orderTotal(),
        items: cartLines(),
        discountCode: promo?.code || "",
        shippingMethod: shipMethod,
        email,
        shipping: { name: `${first} ${last}`.trim(), address, city, zip, country },
      }),
    });
    const { clientSecret, error, amount } = await res.json();
    if (error) throw new Error(error);

    // Server is the source of truth for the charge — reflect it in the summary.
    if (typeof amount === "number" && Math.abs(amount - orderTotal()) > 0.005) {
      coGrandTotal.textContent = fmt(amount);
    }

    const appearance = {
      theme: "flat",
      variables: {
        colorPrimary:          "#0a0a0a",
        colorBackground:       "#ffffff",
        colorText:             "#0a0a0a",
        colorDanger:           "#ff2d2d",
        colorTextPlaceholder:  "#9a9a9a",
        fontFamily:            "'Archivo', system-ui, sans-serif",
        borderRadius:          "0px",
        spacingUnit:           "4px",
      },
      rules: {
        ".Input": {
          border:      "1px solid rgba(10,10,10,0.14)",
          padding:     "14px 14px",
          fontSize:    "0.95rem",
          boxShadow:   "none",
        },
        ".Input:focus": {
          border:     "1px solid #0a0a0a",
          boxShadow:  "none",
        },
        ".Input--invalid": { border: "1px solid #ff2d2d", color: "#0a0a0a" },
        ".Label": {
          color:          "#6f6f6f",
          fontSize:       "0.62rem",
          fontWeight:     "600",
          letterSpacing:  "0.14em",
          textTransform:  "uppercase",
          marginBottom:   "8px",
        },
        ".Tab": {
          border: "1px solid rgba(10,10,10,0.14)",
          boxShadow: "none",
          borderRadius: "0px",
        },
        ".Tab:hover": { color: "#0a0a0a" },
        ".Tab--selected": { border: "1px solid #0a0a0a", color: "#0a0a0a", boxShadow: "none" },
        ".Tab--selected:hover": { color: "#0a0a0a" },
        ".TabIcon--selected": { fill: "#0a0a0a" },
        ".Error": { color: "#ff2d2d", fontSize: "0.8rem" },
        ".Block": { border: "1px solid rgba(10,10,10,0.14)", boxShadow: "none", borderRadius: "0px" },
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
  renderShipOptions();
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
  coItems.innerHTML = [...cart.values()].map((line) => {
    const p = PRODUCTS.find((x) => x.id === line.id);
    if (!p) return "";
    return `
      <div class="co__item">
        <img class="co__item-img" src="${imgUrl(p)}" alt="${esc(p.name)}" />
        <div>
          <div class="co__item-name">${esc(p.name)}</div>
          <div class="co__item-qty">Qty: ${line.qty}</div>
        </div>
        <div class="co__item-price">${fmtEur(unitPrice(p) * line.qty)}</div>
      </div>`;
  }).join("");

  const disc = discountAmount();
  coSubtotal.textContent = fmtEur(cartSubtotal());
  if (coDiscountRow) {
    coDiscountRow.hidden = !promo || disc === 0;
    if (coDiscountLbl && promo) coDiscountLbl.textContent = promo.label;
    if (coDiscountVal) coDiscountVal.textContent = "−" + fmtEur(disc);
  }
  const post = shippingCost();
  if (coShipping) {
    coShipping.textContent = post === 0 ? "FREE" : fmtEur(post);
    coShipping.classList.toggle("co__free", post === 0);
  }
  if (coShipNote) {
    const short = Math.round((FREE_SHIPPING_OVER - cartTotal()) * 100) / 100;
    coShipNote.hidden = short <= 0;
    if (short > 0) coShipNote.textContent = `Spend ${fmtEur(short)} more for free standard shipping`;
  }
  coGrandTotal.textContent = fmtEur(orderTotal());
}

/* The two delivery choices, priced for the cart as it stands — the labels
   show what this order would actually pay, threshold included. */
function renderShipOptions() {
  const wrap = document.getElementById("coShipOpts");
  if (!wrap) return;
  wrap.innerHTML = Object.entries(SHIPPING).map(([key, o]) => {
    const cost = shippingCost(key);
    return `
      <label class="co__ship-opt${key === shipMethod ? " is-on" : ""}" data-ship="${key}">
        <input type="radio" name="shipMethod" value="${key}"${key === shipMethod ? " checked" : ""} />
        <span class="co__ship-text">
          <span class="co__ship-name">${esc(o.label)}</span>
          <span class="co__ship-sub">${esc(deliveryLine())} · ${esc(o.sub)}</span>
        </span>
        <span class="co__ship-price">${cost === 0 ? "FREE" : fmtEur(cost)}</span>
      </label>`;
  }).join("");
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

// Delivery choice — repricing the options keeps the free-shipping line honest
// when the threshold changes what "tracked" costs.
document.getElementById("coShipOpts")?.addEventListener("change", (e) => {
  const opt = e.target.closest("[data-ship]");
  if (!opt) return;
  shipMethod = opt.dataset.ship;
  renderShipOptions();
  renderCheckoutSummary();
});

// Destination sets the transit window, so requote the options when it changes.
document.getElementById("coCountry")?.addEventListener("change", renderShipOptions);

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
    const coConfirmEta = document.getElementById("coConfirmEta");
    if (coConfirmEta) coConfirmEta.textContent = DELIVERY[destKey(chosenCountry())].long;
    coOrderNum.textContent = "Order LML-" + paymentIntent.id.slice(-8).toUpperCase();
    cart.clear();
    promo = null;
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
