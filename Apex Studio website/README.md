# LUMLA GLASSES — Website

Premium streetwear eyewear storefront. Static HTML/CSS/JS — no build step.
Inspired by lumlaglasses (attitude) × Oakley (structure), built around your
chrome / liquid-metal logo.

## Run it

Just open `index.html` in a browser. Or serve it:

```
npx serve "Apex Studio website" -l 4321
```

Then visit http://localhost:4321

## What's here

| File | Purpose |
|------|---------|
| `index.html` | All page sections (hero, shop, collections, lookbook, story, newsletter, footer, cart drawer) |
| `styles.css` | Full design system — chrome/charcoal theme, responsive, animations |
| `script.js` | Product grid, working cart drawer, reveal-on-scroll, mobile menu, newsletter |
| `assets/logo.jpg` | Your logo (used in nav + footer + favicon) |
| `assets/hero-glasses.svg` | Hero showpiece frame |
| `assets/products/*.svg` | 6 product placeholders |
| `assets/lookbook/*.svg` | 3 editorial placeholders |
| `assets/_gen-placeholders.js` | Regenerates the placeholder art (`node assets/_gen-placeholders.js`) |

## Swapping in YOUR photos (the whole point of the skeleton)

The placeholders are temporary. To use your own images, **just replace the files —
keep the same filename** and everything updates automatically:

- **Products:** drop a `.jpg`/`.png` into `assets/products/` and point to it.
  Product names, prices, and image paths live in one array at the top of
  `script.js` (the `PRODUCTS` list) — edit names, prices, and `img:` paths there.
- **Hero frame:** replace `assets/hero-glasses.svg` (or change the `src` in
  `index.html` → `.hero__product img`).
- **Lookbook:** replace `assets/lookbook/look-1/2/3.svg` (or change `src`s in the
  `.lookbook__grid` section).

Product cards use a 1:1 (square) crop and lookbook tiles are portrait/landscape —
shoot/crop accordingly for the cleanest result. Images on a dark or neutral
background match the aesthetic best.

## Quick brand edits

- **Colors:** top of `styles.css` → `:root` variables (`--bg`, `--chrome-*`, etc.)
- **Copy / headlines:** directly in `index.html`
- **Announcement bar text:** the `.ticker` section in `index.html`
- **Instagram link:** footer (`.footer__col` → "Follow") currently points to
  lumlaglasses — change to your own handle.

## Notes

- The cart, checkout button, and newsletter are front-end only (no payment/backend).
  When you're ready to sell, this can connect to Shopify, Stripe, or similar.
- Fonts: **Clash Display** + **Satoshi** (from Fontshare) and **Space Mono** (Google
  Fonts) for the spec-sheet labels. Internet required for the exact type; there are
  system fallbacks otherwise.
