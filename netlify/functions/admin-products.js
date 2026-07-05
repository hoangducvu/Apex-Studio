const { supabase, json, options, requireAdmin } = require("./_helpers");

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
    const { name, category, price, badge, quantity, sort_order, image, active } = body;

    if (!name || !price) return json(400, { error: "name and price required" });
    if (!image)          return json(400, { error: "image required" });

    const id = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const { data, error } = await supabase
      .from("products")
      .insert({
        id,
        name,
        category:   category   || "",
        price:      parseFloat(price),
        image,
        badge:      badge      || "",
        quantity:   parseInt(quantity)   || 0,
        sort_order: parseInt(sort_order) || 0,
        active:     active !== false,
      })
      .select()
      .single();

    if (error) return json(500, { error: error.message });
    return json(200, data);
  }

  return json(405, { error: "Method not allowed" });
};
