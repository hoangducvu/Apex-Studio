const { supabase, json, options, requireAdmin, saveTolerant, normalizeImages } = require("./_helpers");

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

  // POST — create product
  if (event.httpMethod === "POST") {
    const body = JSON.parse(event.body || "{}");
    const { name, category, price, badge, quantity, sort_order, image, active,
            variant_group, color_label } = body;

    // The gallery is the source of truth; `image` stays mirrored to its first
    // entry so older code paths (cart, checkout, emails) keep working.
    const images = normalizeImages(body.images);
    const mainImage = images[0] || image || "";
    if (mainImage && !images.length) images.push(mainImage);

    if (!name || !price) return json(400, { error: "name and price required" });
    if (!mainImage)      return json(400, { error: "image required" });

    const id = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const row = {
      id,
      name,
      category:   category   || "",
      price:      parseFloat(price),
      image:      mainImage,
      images,
      badge:      badge      || "",
      quantity:   parseInt(quantity)   || 0,
      sort_order: parseInt(sort_order) || 0,
      active:     active !== false,
      variant_group: (variant_group || "").trim(),
      color_label:   (color_label   || "").trim(),
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
