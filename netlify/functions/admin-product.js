const { supabase, json, options, requireAdmin } = require("./_helpers");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const id = (event.queryStringParameters || {}).id;
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
    const update = {
      name:       body.name       ?? existing.name,
      category:   body.category   ?? existing.category,
      price:      body.price   != null ? parseFloat(body.price)    : existing.price,
      image:      body.image      ?? existing.image,
      badge:      body.badge      ?? existing.badge,
      quantity:   body.quantity   != null ? parseInt(body.quantity)    : existing.quantity,
      sort_order: body.sort_order != null ? parseInt(body.sort_order)  : existing.sort_order,
      active:     body.active     != null ? Boolean(body.active)       : existing.active,
    };

    const { data, error } = await supabase
      .from("products")
      .update(update)
      .eq("id", id)
      .select()
      .single();

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
