/* Product image gallery store.
 *
 * The gallery ideally lives on products.images (see
 * supabase-migration-images.sql). Adding a column needs dashboard access, so
 * until that migration is run the same data is kept in a JSON document in
 * Supabase Storage — no schema change required, fully editable from the admin
 * panel. Once the column exists it takes precedence automatically.
 *
 *   GET  /api/product-images   → { "<productId>": ["url", …], … }
 *   POST /api/product-images   → merge { id, images: [...] }  (admin key)
 */
const { supabase, json, options, requireAdmin, normalizeImages } = require("./_helpers");

const BUCKET = "site-meta";
const FILE   = "product-images.json";

async function readMap() {
  const { data, error } = await supabase.storage.from(BUCKET).download(FILE);
  if (error || !data) return {};
  try {
    return JSON.parse(await data.text()) || {};
  } catch {
    return {};
  }
}

async function writeMap(map) {
  return supabase.storage.from(BUCKET).upload(
    FILE,
    Buffer.from(JSON.stringify(map, null, 1)),
    { contentType: "application/json", upsert: true }
  );
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();

  if (event.httpMethod === "GET") {
    return json(200, await readMap());
  }

  if (event.httpMethod === "POST" || event.httpMethod === "PUT") {
    const authErr = requireAdmin(event);
    if (authErr) return authErr;

    const body = JSON.parse(event.body || "{}");
    const map  = await readMap();

    const entries = Array.isArray(body.items)
      ? body.items
      : [{ id: body.id, images: body.images }];

    for (const e of entries) {
      if (!e || !e.id) continue;
      const images = normalizeImages(e.images);
      // A single image (or none) is just the main shot — nothing to remember.
      if (images.length < 2) delete map[e.id];
      else map[e.id] = images;
    }

    const { error } = await writeMap(map);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, count: Object.keys(map).length });
  }

  return json(405, { error: "Method not allowed" });
};
