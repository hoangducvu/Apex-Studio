const { supabase, json, options, requireAdmin, saveTolerant, normalizeImages,
        productName } = require("./_helpers");

// Columns that only exist once their SQL migration has been run. saveTolerant
// drops whichever ones the database rejects rather than failing the save.
const OPTIONAL_COLUMNS = ["variant_group", "color_label", "images"];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  // GET — list all products (incl. inactive)
  if (event.httpMethod === "GET") {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) return json(500, { error: error.message });
    return json(200, data);
  }

  // POST — create product, or delete one outright
  if (event.httpMethod === "POST") {
    const body = JSON.parse(event.body || "{}");

    /* Permanent delete lives on the collection endpoint, not on
     * /products/:id, because every request to a deeper path 404s in
     * production before it reaches a function — while this URL is the one the
     * panel already lists products from, so it is known to arrive. `op` must
     * say "delete" outright, so a malformed create can never erase a row. */
    if (body.op === "delete") {
      const id = String(body.id || "").trim();
      if (!id) return json(400, { error: "Product id required" });
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, deleted: "permanent", id });
    }

    /* Editing and stock, same reason again: PUT /products/:id and PATCH
     * /products/:id/stock never arrive either. Rather than restate their
     * logic, hand the original handlers the event they expect. */
    if (body.op === "update" || body.op === "stock") {
      const id = String(body.id || "").trim();
      if (!id) return json(400, { error: "Product id required" });
      const { op, id: _id, ...rest } = body;

      const forward = (handler, httpMethod) => handler({
        ...event,
        httpMethod,
        queryStringParameters: { ...(event.queryStringParameters || {}), id },
        body: JSON.stringify(rest),
      });

      return body.op === "update"
        ? forward(require("./admin-product").handler, "PUT")
        : forward(require("./admin-stock").handler, "PATCH");
    }

    /* Deactivate, for the same reason — the panel's Deactivate/Activate
     * toggle would otherwise depend on PUT /products/:id reaching us. */
    if (body.op === "set-active") {
      const id = String(body.id || "").trim();
      if (!id) return json(400, { error: "Product id required" });
      const { data, error } = await supabase
        .from("products")
        .update({ active: Boolean(body.active) })
        .eq("id", id)
        .select()
        .single();
      if (error) return json(500, { error: error.message });
      return json(200, data);
    }
    const { name, category, price, badge, quantity, sort_order, image, active,
            variant_group, color_label } = body;

    // The gallery is the source of truth; `image` stays mirrored to its first
    // entry so older code paths (cart, checkout, emails) keep working.
    const images = normalizeImages(body.images);
    const mainImage = images[0] || image || "";
    if (mainImage && !images.length) images.push(mainImage);

    // The panel edits a style name and a colour; the stored `name` is built
    // from the pair. An explicit name still works for anything calling the
    // API directly.
    const style    = (variant_group || "").trim();
    const colour   = (color_label   || "").trim();
    const fullName = productName(style, colour) || (name || "").trim();

    // A colour on its own is not a product: without a style name it would
    // render as a card called "BLUE" that nothing can ever group with.
    if (!style && !(name || "").trim()) return json(400, { error: "name required" });
    if (!fullName || !price) return json(400, { error: "name and price required" });
    if (!mainImage)          return json(400, { error: "image required" });

    const id = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const row = {
      id,
      name: fullName,
      category:   category   || "",
      price:      parseFloat(price),
      image:      mainImage,
      images,
      badge:      badge      || "",
      quantity:   parseInt(quantity)   || 0,
      sort_order: parseInt(sort_order) || 0,
      active:     active !== false,
      variant_group: style,
      color_label:   colour,
    };

    const { data, error } = await saveTolerant(
      (r) => supabase.from("products").insert(r).select().single(),
      row,
      OPTIONAL_COLUMNS
    );

    if (error) return json(500, { error: error.message });
    return json(200, data);
  }

  return json(405, { error: "Method not allowed" });
};
