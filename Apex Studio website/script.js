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
  { id: "heavy-chrome-01", name: "Chrome Heavy Metallic 01", category: "Heavy Metallic", price: 49, image: "assets/products/flare.png",   badge: "",            quantity: 50 },
];

/* ============================================================
   LENS CUSTOMISATION
   Surcharge is added on top of the frame price, per pair.
   ------------------------------------------------------------
   The surcharges are mirrored in
   netlify/functions/create-payment-intent.js (LENS_OPTIONS) — the server
   always recalculates the charge. Colour *names* are passed through freely,
   so this list can change without a server change.
   ============================================================ */
const LENS_OPTIONS = {
  none:   { label: "Standard lens — as pictured",       price: 0,  colors: 0 },
  single: { label: "Custom lens — 1 colour",            price: 30, colors: 1 },
  duo:    { label: "Custom lens — 2 colours / gradient", price: 35, colors: 2 },
};

/* ⚠️ PLACEHOLDER HEX VALUES — these drive both the swatches and the live
   preview, so they should be sampled from photographs of the real lenses
   (shot flat on white paper in indirect daylight) rather than eyeballed.
   Swap the `hex` values only; the `name` strings are what the order records. */
const LENS_COLORS = [
  { name: "Black",         hex: "#1c1c1e" },
  { name: "Smoke Grey",    hex: "#6d6d72" },
  { name: "Silver Mirror", hex: "#b6bec7" },
  { name: "Gold Mirror",   hex: "#d2a336" },
  { name: "Bronze",        hex: "#8a5a2b" },
  { name: "Blue",          hex: "#1f6fd0" },
  { name: "Ice Blue",      hex: "#8fc7e8" },
  { name: "Green",         hex: "#1f8a4c" },
  { name: "Purple",        hex: "#6b2fb5" },
  { name: "Pink",          hex: "#e0559b" },
  { name: "Red",           hex: "#c02028" },
  { name: "Orange",        hex: "#f07f1a" },
  { name: "Clear",         hex: "#e6edf2" },
];

function lensHex(name) {
  return (LENS_COLORS.find((c) => c.name === name) || LENS_COLORS[0]).hex;
}

const DEFAULT_LENS = { type: "none", colors: [] };

function lensPrice(lens) { return LENS_OPTIONS[lens?.type]?.price || 0; }
function lensKey(lens) {
  if (!lens || lens.type === "none") return "none";
  return lens.type + ":" + (lens.colors || []).join("+");
}
function lensLabel(lens) {
  if (!lens || lens.type === "none") return "";
  const cols = (lens.colors || []).filter(Boolean);
  if (lens.type === "duo") return `Gradient lens · ${cols.join(" → ") || "colour TBC"}`;
  return `Custom lens · ${cols[0] || "colour TBC"}`;
}
function unitPrice(p, lens) { return (p?.price || 0) + lensPrice(lens); }

/* ============================================================
   DISCOUNT CODES
   Mirrored server-side in create-payment-intent.js — the server
   always recalculates the charge, this is only the storefront view.
   ============================================================ */
const DISCOUNTS = {
  LUMLA: { percent: 10, label: "LUMLA · 10% off" },
};
let promo = null; // { code, percent, label }

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

/* ============================================================
   LIVE LENS RECOLOURING
   ------------------------------------------------------------
   The product shots are photographed with a tinted lens, and that lens is the
   only strongly saturated thing in the picture — the frames are black, the
   background white. So the lens can be repainted by shifting the hue of every
   saturated pixel while keeping that pixel's own lightness, which preserves
   the reflections, the glass falloff and the gradient exactly.

   Two colours are mapped across the lens's own light-to-dark ramp, which in
   these shots runs top to bottom — giving a real gradient lens.

   Frames whose lens is photographed near-neutral (grey/clear) can't be
   separated this way; they simply render unchanged.
   ============================================================ */
const LENS_MIN_SATURATION = 0.18;
// Each render is a full-size data URL (~200KB), and duo mode has 13×13
// combinations — so the cache is bounded and evicts oldest-first.
const LENS_CACHE_LIMIT = 24;
const lensRenderCache = new Map();

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s <= 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}

function hexToHsl(hex) {
  const p = hex.replace("#", "").match(/../g).map((v) => parseInt(v, 16));
  return rgbToHsl(p[0], p[1], p[2]);
}

// Hue is a circle — blend the short way round, so purple→orange travels
// through red rather than all the way back through blue and green.
function lerpHue(a, b, t) {
  let d = b - a;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return (a + d * t + 1) % 1;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Product shots are served from Supabase Storage; without this the canvas
    // is tainted and the pixels can't be read back.
    img.crossOrigin = "anonymous";
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Repaints the lens in `src` and resolves to a data URL.
 * `colors` is one hex (flat tint) or two (gradient, dark end first).
 * Resolves to the original `src` whenever the recolour can't be done —
 * a tainted canvas, a neutral lens, a broken image.
 */
async function renderLens(src, colors) {
  const stops = colors.filter(Boolean).map(lensHex);
  if (!src || !stops.length) return src;

  const key = src + "|" + stops.join(",");
  if (lensRenderCache.has(key)) {
    // Refresh recency so the colours being explored stay cached
    const hit = lensRenderCache.get(key);
    lensRenderCache.delete(key);
    lensRenderCache.set(key, hit);
    return hit;
  }

  const promise = (async () => {
    let img;
    try { img = await loadImage(src); } catch { return src; }

    const canvas = document.createElement("canvas");
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    let px;
    try {
      px = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      return src; // cross-origin without CORS headers — leave the shot alone
    }
    const d = px.data;

    // Pass 1 — find the lens and measure its own lightness/saturation spread
    let sumS = 0, sumL = 0, n = 0;
    const hist = new Uint32Array(256);
    const hsl = new Float32Array(d.length / 4 * 3);
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
      if (d[i + 3] < 8) continue;
      const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      hsl[j] = h; hsl[j + 1] = s; hsl[j + 2] = l;
      if (s >= LENS_MIN_SATURATION && l > 0.05 && l < 0.97) {
        hist[(l * 255) | 0]++;
        sumS += s; sumL += l; n++;
      }
    }
    if (n < 200) return src; // no separable lens in this shot

    const avgS = sumS / n, avgL = sumL / n;
    // Span the ramp across the bulk of the lens, not its extremes: a handful of
    // specular highlights and dark rim pixels would otherwise squash every real
    // pixel into the middle of the gradient and flatten it to one colour.
    const percentile = (frac) => {
      let seen = 0;
      const want = n * frac;
      for (let i = 0; i < 256; i++) {
        seen += hist[i];
        if (seen >= want) return i / 255;
      }
      return 1;
    };
    // A tight band leaves both ends of a two-colour lens muddy, because almost
    // every pixel sits mid-ramp. Clamping the outer ~15% to the pure endpoint
    // colours is what makes a gradient actually read as "this colour into that".
    const lo = percentile(0.15), hi = percentile(0.85);
    const [darkH, darkS, darkL]    = hexToHsl(stops[0]);
    const [lightH, lightS, lightL] = hexToHsl(stops[1] || stops[0]);
    // Shift the whole lens toward the target's brightness, so a black lens
    // reads dark and an ice-blue one reads light, without flattening the glass.
    const lOffset = ((darkL + lightL) / 2 - avgL) * 0.7;

    // Pass 2 — repaint
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
      const s = hsl[j + 1], l = hsl[j + 2];
      if (d[i + 3] < 8 || s < LENS_MIN_SATURATION || l <= 0.05 || l >= 0.97) continue;
      const t = hi > lo ? clamp01((l - lo) / (hi - lo)) : 0;
      const [r, g, b] = hslToRgb(
        lerpHue(darkH, lightH, t),
        clamp01((darkS + (lightS - darkS) * t) * (s / avgS)),
        clamp01(l + lOffset)
      );
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }

    ctx.putImageData(px, 0, 0);
    try { return canvas.toDataURL("image/png"); } catch { return src; }
  })();

  lensRenderCache.set(key, promise);
  if (lensRenderCache.size > LENS_CACHE_LIMIT) {
    lensRenderCache.delete(lensRenderCache.keys().next().value);
  }
  return promise;
}

/* ── Lens picker markup (product detail page) ───────────────────────────── */
// A row of real colour chips. The chosen name lives in a hidden input, so
// readLens() stays a plain value read and the order still records the name.
function lensSwatchRow(inputId, selected) {
  return `
    <div class="lens__swatches" data-swatch-row="${inputId}">
      ${LENS_COLORS.map((c) => `
        <button type="button" class="lens__swatch${c.name === selected ? " is-on" : ""}"
                data-color="${esc(c.name)}" style="--sw:${esc(c.hex)}"
                title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join("")}
    </div>
    <input type="hidden" id="${inputId}" value="${esc(selected)}" />`;
}

function lensPickerHtml() {
  const opts = Object.entries(LENS_OPTIONS).map(([key, o]) => `
    <label class="lens__opt${key === "none" ? " is-on" : ""}" data-lens-opt="${key}">
      <input type="radio" name="lensType" value="${key}"${key === "none" ? " checked" : ""} />
      <span class="lens__opt-label">${esc(o.label)}</span>
      <span class="lens__opt-price">${o.price ? "+" + fmt(o.price) : "Included"}</span>
    </label>`).join("");

  const first  = LENS_COLORS[0].name;
  const second = (LENS_COLORS[6] || LENS_COLORS[0]).name;

  return `
    <div class="lens" id="pdLens">
      <div class="lens__title">Customise your lenses</div>
      <div class="lens__opts">${opts}</div>
      <div class="lens__colors" id="pdLensColors" hidden>
        <div class="lens__color">
          <label>Lens colour — <span data-swatch-name="pdLensColor1">${esc(first)}</span></label>
          ${lensSwatchRow("pdLensColor1", first)}
        </div>
        <div class="lens__color" id="pdLensColor2Wrap" hidden>
          <label>Fades into — <span data-swatch-name="pdLensColor2">${esc(second)}</span></label>
          ${lensSwatchRow("pdLensColor2", second)}
        </div>
      </div>
      <p class="lens__note">
        The preview is generated from this frame's own photo, so it shows the real
        shape and finish. Custom lenses are made to order — add 3–5 days to delivery.
      </p>
    </div>`;
}

function readLens() {
  const el = document.getElementById("pdLens");
  if (!el) return { ...DEFAULT_LENS };
  const type = el.querySelector('input[name="lensType"]:checked')?.value || "none";
  const need = LENS_OPTIONS[type]?.colors || 0;
  const colors = [];
  if (need >= 1) colors.push(document.getElementById("pdLensColor1").value);
  if (need >= 2) colors.push(document.getElementById("pdLensColor2").value);
  return { type, colors };
}

// The uncoloured shot the preview is generated from — follows the gallery.
let pdBaseShot = "";

// Repaint the main image for the lens colours currently selected. Guarded by a
// token so a slow render can never overwrite a newer selection.
let pdLensToken = 0;
async function applyLensPreview() {
  const main = document.getElementById("pdMainImg");
  if (!main || !pdBaseShot) return;

  const lens = readLens();
  const need = LENS_OPTIONS[lens.type]?.colors || 0;
  const token = ++pdLensToken;

  const src = need === 0
    ? pdBaseShot
    : await renderLens(pdBaseShot, lens.colors.slice(0, need));

  if (token !== pdLensToken) return; // a newer selection already won
  main.src = src;
  // Colour-variant hover previews restore from this, so keep it in step.
  main.dataset.default = src;
}

function bindLensPicker(product) {
  const el = document.getElementById("pdLens");
  if (!el) return;
  const colorsWrap = document.getElementById("pdLensColors");
  const secondWrap = document.getElementById("pdLensColor2Wrap");
  const priceEl = document.querySelector(".pd__price");

  // Colour chips write into their hidden input, then re-run the same sync the
  // radio buttons use.
  el.addEventListener("click", (e) => {
    const chip = e.target.closest(".lens__swatch");
    if (!chip) return;
    e.preventDefault();
    const row = chip.closest("[data-swatch-row]");
    const id  = row.dataset.swatchRow;
    document.getElementById(id).value = chip.dataset.color;
    row.querySelectorAll(".lens__swatch").forEach((s) => s.classList.toggle("is-on", s === chip));
    const nameEl = el.querySelector(`[data-swatch-name="${id}"]`);
    if (nameEl) nameEl.textContent = chip.dataset.color;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const sync = () => {
    const lens = readLens();
    const need = LENS_OPTIONS[lens.type]?.colors || 0;
    colorsWrap.hidden = need === 0;
    secondWrap.hidden = need < 2;
    el.querySelectorAll(".lens__opt").forEach((o) =>
      o.classList.toggle("is-on", o.dataset.lensOpt === lens.type));
    if (priceEl) {
      const total = unitPrice(product, lens);
      priceEl.innerHTML = fmt(total) +
        (lensPrice(lens) ? ` <span class="pd__price-add">incl. ${fmt(lensPrice(lens))} lens</span>` : "");
    }
    applyLensPreview();
  };
  el.addEventListener("change", sync);
  sync();
}

/* ── Product detail ────────────────────────────────────────────────────── */
function renderProductDetail() {
  if (!pdContent) return;
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
  const lowStock = !soldOut && p.quantity <= 5;
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
  pdBaseShot = shots[0];
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
      <div class="pd__media">
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
        ${soldOut ? "Sold out" : lowStock ? `Low stock — only ${p.quantity} left` : "In stock — ships in 2–3 business days"}
      </p>

      ${variantsHtml}

      ${soldOut ? "" : lensPickerHtml()}

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

      <p class="pd__note">Custom lens colours available on every frame — 1 colour ${fmt(30)}, 2 colours or a gradient ${fmt(35)}. Questions? <a href="/contact.html">Contact us</a>.</p>

      <ul class="pd__specs">
        <li><span>Fit</span> Freesize — suits most face shapes</li>
        <li><span>Lenses</span> UV400 protection</li>
        <li><span>Includes</span> Protective case &amp; cleaning cloth</li>
        <li><span>Shipping</span> Fast EU shipping · prices in EUR €</li>
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
      // Re-run the lens preview against the newly chosen shot
      pdBaseShot = src;
      applyLensPreview();
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
    bindLensPicker(p);
    const qtyVal = document.getElementById("pdQtyVal");
    document.getElementById("pdQtyMinus").addEventListener("click", () => {
      qtyVal.textContent = Math.max(1, parseInt(qtyVal.textContent, 10) - 1);
    });
    document.getElementById("pdQtyPlus").addEventListener("click", () => {
      qtyVal.textContent = Math.min(p.quantity, parseInt(qtyVal.textContent, 10) + 1);
    });
    document.getElementById("pdAdd").addEventListener("click", () => {
      addToCart(p.id, parseInt(qtyVal.textContent, 10) || 1, readLens());
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
    <article class="card" data-reveal data-card>
      <div class="card__media">
        ${p.badge ? `<span class="card__badge ${/sale/i.test(p.badge) ? "card__badge--sale" : ""}" data-card-badge>${esc(p.badge)}</span>` : `<span class="card__badge" data-card-badge hidden></span>`}
        ${p.quantity === 0 ? `<span class="card__badge card__badge--soft card__badge--stock" data-card-stock>SOLD OUT</span>` : p.quantity <= 5 ? `<span class="card__badge card__badge--soft card__badge--stock" data-card-stock>LOW STOCK</span>` : `<span class="card__badge card__badge--soft card__badge--stock" data-card-stock hidden></span>`}
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
  });
  set("[data-card-name]", (el) => { el.textContent = styleName(p); });
  set("[data-card-cat]", (el) => { el.textContent = colorOf(p); });
  set("[data-card-price]", (el) => { el.textContent = fmt(p.price); });
  set("[data-card-badge]", (el) => { el.textContent = p.badge || ""; el.hidden = !p.badge; });
  set("[data-card-stock]", (el) => {
    const txt = p.quantity === 0 ? "SOLD OUT" : p.quantity <= 5 ? "LOW STOCK" : "";
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

// Hover (and tap) a swatch → swap the main image
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
  // Render the static catalog immediately so the grid never waits on the
  // network, then swap in live data if the API answers in time.
  PRODUCTS = FALLBACK_PRODUCTS;
  const want = new URLSearchParams(location.search).get("filter");
  if (want && filterBar) activeFilter = want;
  renderFilters();
  renderGrid();
  renderProductDetail();

  try {
    const sideload = (url) =>
      fetch(url, { signal: AbortSignal.timeout(4000) })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));

    const [res, groups, galleries] = await Promise.all([
      fetch("/api/products", { signal: AbortSignal.timeout(4000) }),
      sideload("/api/variant-groups"),
      sideload("/api/product-images"),
    ]);
    VARIANT_MAP    = groups    && typeof groups    === "object" ? groups    : {};
    PRODUCT_IMAGES = galleries && typeof galleries === "object" ? galleries : {};
    const data = await res.json();
    if (res.ok && Array.isArray(data) && data.length) {
      PRODUCTS = data;
      renderFilters();
      renderGrid();
      renderProductDetail();
      renderCollectionArt();
      renderCart();
    }
  } catch {
    /* server offline or slow — static catalog already shown */
  }
}

/* ============================================================
   CART  —  keyed by product + lens choice, so the same frame with
   different lenses lives on its own line.
   ============================================================ */
const cart = new Map(); // lineKey -> { id, qty, lens }

function lineKey(id, lens) { return id + "|" + lensKey(lens); }

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
    t += l.qty * unitPrice(p, l.lens);
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
    const label = lensLabel(line.lens);
    return `
      <div class="drawer-item">
        <img src="${imgUrl(p)}" alt="${esc(p.name)}" />
        <div>
          <div class="drawer-item__name">${esc(p.name)}</div>
          ${label ? `<div class="drawer-item__lens">${esc(label)} · +${fmt(lensPrice(line.lens))}</div>` : ""}
          <div class="drawer-item__price">${fmt(unitPrice(p, line.lens))}</div>
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

function addToCart(id, qty = 1, lens = DEFAULT_LENS) {
  const key = lineKey(id, lens);
  const line = cart.get(key) || { id, qty: 0, lens };
  line.qty += qty;
  cart.set(key, line);
  renderCart();
  const p = PRODUCTS.find((p) => p.id === id);
  const extra = lensLabel(lens);
  showToast(`${p ? p.name : id}${extra ? " · " + extra : ""} added to cart`);
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
  promoForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = document.getElementById("promoInput").value.trim().toUpperCase();
    note.classList.remove("is-ok", "is-err");
    if (!raw) { promo = null; note.textContent = ""; renderCart(); return; }
    const d = DISCOUNTS[raw];
    if (!d) {
      promo = null;
      note.textContent = "That code isn't valid";
      note.classList.add("is-err");
    } else {
      promo = { code: raw, percent: d.percent, label: d.label };
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
const coDiscountRow  = document.getElementById("coDiscountRow");
const coDiscountLbl  = document.getElementById("coDiscountLabel");
const coDiscountVal  = document.getElementById("coDiscount");
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

function cartLines() {
  return [...cart.values()].map((l) => {
    const p = PRODUCTS.find((x) => x.id === l.id);
    return {
      id: l.id,
      name: p?.name || l.id,
      qty: l.qty,
      price: unitPrice(p, l.lens),
      lens: l.lens,
      lensLabel: lensLabel(l.lens),
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
        amount: cartTotal(),
        items: cartLines(),
        discountCode: promo?.code || "",
        email,
        shipping: { name: `${first} ${last}`.trim(), address, city, zip, country },
      }),
    });
    const { clientSecret, error, amount } = await res.json();
    if (error) throw new Error(error);

    // Server is the source of truth for the charge — reflect it in the summary.
    if (typeof amount === "number" && Math.abs(amount - cartTotal()) > 0.005) {
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
    const label = lensLabel(line.lens);
    return `
      <div class="co__item">
        <img class="co__item-img" src="${imgUrl(p)}" alt="${esc(p.name)}" />
        <div>
          <div class="co__item-name">${esc(p.name)}</div>
          ${label ? `<div class="co__item-lens">${esc(label)}</div>` : ""}
          <div class="co__item-qty">Qty: ${line.qty}</div>
        </div>
        <div class="co__item-price">${fmtEur(unitPrice(p, line.lens) * line.qty)}</div>
      </div>`;
  }).join("");

  const disc = discountAmount();
  coSubtotal.textContent = fmtEur(cartSubtotal());
  if (coDiscountRow) {
    coDiscountRow.hidden = !promo || disc === 0;
    if (coDiscountLbl && promo) coDiscountLbl.textContent = promo.label;
    if (coDiscountVal) coDiscountVal.textContent = "−" + fmtEur(disc);
  }
  coGrandTotal.textContent = fmtEur(cartTotal());
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
