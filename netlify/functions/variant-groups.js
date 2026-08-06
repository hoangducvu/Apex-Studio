/* Colour-variant grouping store.
 *
 * The grouping ideally lives on products.variant_group / products.color_label
 * (see supabase-migration-variants.sql). Adding columns needs dashboard access,
 * so until that migration is run the same data is kept in a JSON document in
 * Supabase Storage — no schema change required, fully editable from the admin
 * panel. Once the columns exist they take precedence automatically.
 *
 *   GET  /api/variant-groups   → { "<productId>": { group, color }, … }
 *   POST /api/variant-groups   → merge { id, group, color }  (admin key)
 */
const { supabase, json, options, requireAdmin } = require("./_helpers");

const BUCKET = "site-meta";
const FILE   = "variant-groups.json";

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
    const map = await readMap();

    const entries = Array.isArray(body.items)
      ? body.items
      : [{ id: body.id, group: body.group, color: body.color }];

    for (const e of entries) {
      if (!e || !e.id) continue;
      const group = String(e.group || "").trim().slice(0, 80);
      const color = String(e.color || "").trim().slice(0, 60);
      if (!group && !color) delete map[e.id];
      else map[e.id] = { group, color };
    }

    const { error } = await writeMap(map);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, count: Object.keys(map).length });
  }

  return json(405, { error: "Method not allowed" });
};
