/* Every /api/admin/* route, behind one Serverless Function.
 *
 * Vercel turns each file under api/ into its own function, and the Hobby plan
 * allows 12 per deployment. Six separate admin files spent half that budget on
 * routing alone, so the whole deployment failed the moment a seventh endpoint
 * was added anywhere else. One catch-all keeps the same URLs — the admin panel
 * is unchanged — and leaves room to add endpoints again.
 *
 *   /api/admin/stats
 *   /api/admin/orders
 *   /api/admin/upload-url
 *   /api/admin/products
 *   /api/admin/products/:id
 *   /api/admin/products/:id/stock
 *   /api/admin/products/:id/delete
 *
 * Netlify still routes these itself through netlify.toml, so its redirects
 * and the handlers underneath stay exactly as they were.
 */
const adapt = require("../_adapt");

const handlers = {
  stats:      require("../../netlify/functions/admin-stats").handler,
  orders:     require("../../netlify/functions/admin-orders").handler,
  uploadUrl:  require("../../netlify/functions/admin-upload-url").handler,
  products:   require("../../netlify/functions/admin-products").handler,
  product:    require("../../netlify/functions/admin-product").handler,
  stock:      require("../../netlify/functions/admin-stock").handler,
};

/**
 * Picks the handler for a path, and pulls out the :id segment where there is
 * one. Returns null for anything that isn't a route we serve, so an unknown
 * path 404s rather than falling through to a handler that half-matches.
 *
 * @param {string} pathname e.g. "/api/admin/products/black-20/stock"
 * @returns {{handler: Function, id?: string} | null}
 */
function matchRoute(pathname) {
  const parts = pathname.split("/").filter(Boolean);

  // Drop the "api/admin" prefix, however the platform presents it.
  const at = parts.indexOf("admin");
  if (at === -1) return null;
  const rest = parts.slice(at + 1);

  if (rest.length === 1) {
    if (rest[0] === "stats")      return { handler: handlers.stats };
    if (rest[0] === "orders")     return { handler: handlers.orders };
    if (rest[0] === "upload-url") return { handler: handlers.uploadUrl };
    if (rest[0] === "products")   return { handler: handlers.products };
    return null;
  }

  if (rest[0] !== "products") return null;
  const id = safeDecode(rest[1]);
  if (!id) return null;

  if (rest.length === 2) return { handler: handlers.product, id };
  if (rest.length === 3 && rest[2] === "stock")  return { handler: handlers.stock, id };
  if (rest.length === 3 && rest[2] === "delete") return { handler: handlers.product, id };

  return null;
}

// A malformed escape in the path shouldn't take the function down with it.
function safeDecode(segment) {
  try {
    return decodeURIComponent(segment || "");
  } catch {
    return segment || "";
  }
}

module.exports = (req, res) => {
  const base = `http://${req.headers.host || "localhost"}`;
  const url = new URL(req.url, base);

  const match = matchRoute(url.pathname);
  if (!match) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  /* The handlers read the product id from the query string, which is how the
     Netlify redirects hand it over. Writing it onto the URL rather than
     req.query keeps _adapt as the single place that builds the event. */
  if (match.id) {
    url.searchParams.set("id", match.id);
    req.url = url.pathname + url.search;
  }

  return adapt(match.handler)(req, res);
};
