const { supabase, json, options } = require("./_helpers");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return json(500, { error: error.message });
  return json(200, data);
};
