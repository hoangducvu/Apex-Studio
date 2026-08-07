const { supabase, json, options, requireAdmin, saveTolerant, normalizeImages } = require("./_helpers");

// Columns that only exist once their SQL migration has been run. saveTolerant
// drops whichever ones the database rejects rather than failing the save.
const OPTIONAL_COLUMNS = ["variant_group", "color_label", "images"];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  // Id arrives as ?id= locally, but production redirects drop query
  // placeholders — so also parse it from the original request path.
  const id = (event.queryStringParameters || {}).id ||
    decodeURIComponent((event.path.match(/\/products\/([^/]+)/) || [])[1] || "");
  if (!id) return json(400, { error: "Product id required" });

  // PUT — update product
  if (event.httpMethod === "PUT") {
    const { data: existing, error: fetchErr } = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) return json(404, { error: "Not found" });

    const body = JSON.parse(event.body || "{}");

    // Gallery order is what the admin panel sends; position 0 is the main shot
    // and is mirrored into `image` so older code paths keep working. An absent
    // `images` key means "not edited" — keep whatever the row already has.
    const images = body.images != null
      ? normalizeImages(body.images)
      : normalizeImages(existing.images || [existing.image]);
    const mainImage = images[0] || body.image || existing.image || "";
    if (mainImage && !images.length) images.push(mainImage);

    const update = {
      name:       body.name       ?? existing.name,
      category:   body.category   ?? existing.category,
      price:      body.price   != null ? parseFloat(body.price)    : existing.price,
      image:      mainImage,
      images,
      badge:      body.badge      ?? existing.badge,
      quantity:   body.quantity   != null ? parseInt(body.quantity)    : existing.quantity,
      sort_order: body.sort_order != null ? parseInt(body.sort_order)  : existing.sort_order,
      active:     body.active     != null ? Boolean(body.active)       : existing.active,
      variant_group: body.variant_group != null ? String(body.variant_group).trim() : existing.variant_group,
      color_label:   body.color_label   != null ? String(body.color_label).trim()   : existing.color_label,
    };

    const { data, error } = await saveTolerant(
      (r) => supabase.from("products").update(r).eq("id", id).select().single(),
      update,
      OPTIONAL_COLUMNS
    );

    if (error) return json(500, { error: error.message });
    return json(200, data);
  }

  // DELETE — soft delete (set active = false)
  if (event.httpMethod === "DELETE") {
    const { error } = await supabase
      .from("products")
      .update({ active: false })
      .eq("id", id);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(405, { error: "Method not allowed" });
};
