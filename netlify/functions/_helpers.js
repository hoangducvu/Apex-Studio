const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-key, x-delete-mode",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

function requireAdmin(event) {
  const key = (event.headers || {})["x-admin-key"];
  if (!process.env.ADMIN_PASSWORD || key !== process.env.ADMIN_PASSWORD) {
    return json(401, { error: "Unauthorized" });
  }
  return null;
}

function json(statusCode, data) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(data),
  };
}

function options() {
  return { statusCode: 200, headers: CORS, body: "" };
}

/* ── Optional columns ────────────────────────────────────────────────────────
 * variant_group / color_label / images only exist once the matching SQL file
 * has been run. PostgREST reports a missing column two different ways:
 *   • from Postgres    — column "images" of relation "products" does not exist
 *   • from its cache   — Could not find the 'images' column of 'products'
 *                        in the schema cache            (code PGRST204)
 * Matching only the first one is why saves used to fail outright.
 */
function missingColumn(error, candidates) {
  if (!error) return null;
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`;
  if (!/does not exist|schema cache/i.test(msg)) return null;
  return candidates.find((c) => new RegExp(`\\b${c}\\b`, "i").test(msg)) || null;
}

/**
 * Runs `attempt(row)` and, whenever the database rejects an optional column,
 * drops that column and tries again — so a product save never fails just
 * because a migration is still pending.
 *
 * @param {(row: object) => Promise<{data:any, error:any}>} attempt
 * @param {object}   row       full row, optional columns included
 * @param {string[]} optional  column names that are safe to drop
 * @returns {Promise<{data:any, error:any, dropped:string[]}>}
 */
async function saveTolerant(attempt, row, optional) {
  const current = { ...row };
  const dropped = [];

  for (let i = 0; i <= optional.length; i++) {
    const res = await attempt(current);
    const missing = missingColumn(res.error, optional);
    if (!missing) return { ...res, dropped };
    delete current[missing];
    dropped.push(missing);
  }

  return { data: null, error: { message: "Could not save product" }, dropped };
}

/* ── Product image gallery ───────────────────────────────────────────────────
 * A product carries an ordered list of images. Position 0 is the main shot
 * (and stays mirrored into products.image so every existing code path keeps
 * working); position 1 is what the storefront reveals on hover.
 */
const MAX_IMAGES = 12;

function normalizeImages(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? safeParseArray(value) : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const url = String(item || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

function safeParseArray(str) {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * A product's full name, built from the two fields the admin panel edits:
 * the style name it is grouped by, and its colour. "VECTOR" + "Black" reads
 * as "VECTOR BLACK" — which is what every existing product is already called,
 * so nothing a customer sees changes.
 *
 * The column stays because the cart, checkout, order emails and past orders
 * all need one label for the exact frame; "Black" on its own would be
 * useless on a receipt.
 *
 * @param {string} styleName grouping name (products.variant_group)
 * @param {string} colour    colour label (products.color_label)
 * @returns {string} "" when there is nothing to build from
 */
function productName(styleName, colour) {
  return `${String(styleName || "").trim()} ${String(colour || "").trim()}`
    .trim()
    .toUpperCase();
}

module.exports = {
  supabase, CORS, requireAdmin, json, options,
  missingColumn, saveTolerant, normalizeImages, MAX_IMAGES, productName,
};
