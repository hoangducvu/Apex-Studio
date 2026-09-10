/* Discount code store — edited from the admin panel.
 *
 * The codes live in a JSON document in Supabase Storage, the same approach
 * variant-groups.js takes: no schema change to run, fully editable from the
 * admin panel, and readable server-side when the charge is calculated.
 *
 *   GET  /api/discounts?code=XYZ  → { code, percent, label } for that one code
 *                                   (public — used when a shopper applies it)
 *   GET  /api/discounts           → full list          (admin key)
 *   PUT  /api/discounts           → replace the list   (admin key)
 *
 * The full list is deliberately admin-only: publishing every code would let
 * anyone read a discount they were never sent. A shopper's lookup answers
 * for the one code they typed and nothing else.
 *
 * create-payment-intent.js reads the same document and recalculates the
 * charge itself, so a tampered browser can't invent a discount.
 */
const { supabase, json, options, requireAdmin } = require("./_helpers");

const BUCKET = "site-meta";
const FILE   = "discounts.json";

const MAX_CODES = 60;
const round2 = (n) => Math.round(n * 100) / 100;

// A code is stored as { code, percent, label, active }.
function cleanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
}

function cleanEntry(entry) {
  const code = cleanCode(entry && entry.code);
  if (!code) return null;

  // Percent is the whole deal — a code worth 0% or over 100% is a mistake.
  const percent = round2(Number(entry.percent));
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;

  const label = String((entry && entry.label) || "").trim().slice(0, 80)
    || `${code} · ${percent}% off`;

  return { code, percent, label, active: entry.active !== false };
}

async function readCodes() {
  const { data, error } = await supabase.storage.from(BUCKET).download(FILE);
  if (error || !data) return [];
  try {
    const parsed = JSON.parse(await data.text());
    const list = Array.isArray(parsed) ? parsed : [];
    return list.map(cleanEntry).filter(Boolean);
  } catch {
    return [];
  }
}

async function writeCodes(list) {
  return supabase.storage.from(BUCKET).upload(
    FILE,
    Buffer.from(JSON.stringify(list, null, 1)),
    { contentType: "application/json", upsert: true }
  );
}

/* What create-payment-intent.js calls: the deal for a code, or null.
   Inactive codes resolve to null, so switching one off stops it being
   honoured without deleting the record. */
async function lookupDiscount(rawCode) {
  const code = cleanCode(rawCode);
  if (!code) return null;
  const found = (await readCodes()).find((c) => c.code === code && c.active);
  return found || null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();

  if (event.httpMethod === "GET") {
    const asked = (event.queryStringParameters || {}).code;

    // Shopper applying a code: answer for that code alone.
    if (asked != null) {
      const deal = await lookupDiscount(asked);
      if (!deal) return json(404, { error: "That code isn't valid" });
      return json(200, { code: deal.code, percent: deal.percent, label: deal.label });
    }

    const authErr = requireAdmin(event);
    if (authErr) return authErr;
    return json(200, { codes: await readCodes() });
  }

  if (event.httpMethod === "PUT" || event.httpMethod === "POST") {
    const authErr = requireAdmin(event);
    if (authErr) return authErr;

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON" });
    }

    const incoming = Array.isArray(body) ? body : body.codes;
    if (!Array.isArray(incoming)) return json(400, { error: "Expected a list of codes" });
    if (incoming.length > MAX_CODES) return json(400, { error: `At most ${MAX_CODES} codes` });

    // Last write wins per code, so a duplicate in the form can't create two
    // records that disagree about the same word.
    const byCode = new Map();
    for (const entry of incoming) {
      const clean = cleanEntry(entry);
      if (clean) byCode.set(clean.code, clean);
    }
    const list = [...byCode.values()];

    const { error } = await writeCodes(list);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, codes: list });
  }

  return json(405, { error: "Method not allowed" });
};

exports.lookupDiscount = lookupDiscount;
exports.readCodes = readCodes;
