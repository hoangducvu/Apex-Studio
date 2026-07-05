const { supabase, json, options, requireAdmin } = require("./_helpers");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  const authErr = requireAdmin(event);
  if (authErr) return authErr;
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return json(500, { error: error.message });
  return json(200, data);
};
