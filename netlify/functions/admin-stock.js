const { supabase, json, options, requireAdmin } = require("./_helpers");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  const authErr = requireAdmin(event);
  if (authErr) return authErr;
  if (event.httpMethod !== "PATCH") return json(405, { error: "Method not allowed" });

  // Id arrives as ?id= locally, but production redirects drop query
  // placeholders — so also parse it from the original request path.
  const id = (event.queryStringParameters || {}).id ||
    decodeURIComponent((event.path.match(/\/products\/([^/]+)/) || [])[1] || "");
  if (!id) return json(400, { error: "Product id required" });

  const { delta } = JSON.parse(event.body || "{}");

  const { data: current, error: fetchErr } = await supabase
    .from("products")
    .select("quantity")
    .eq("id", id)
    .single();

  if (fetchErr || !current) return json(404, { error: "Not found" });

  const newQty = Math.max(0, current.quantity + (parseInt(delta) || 0));

  const { error } = await supabase
    .from("products")
    .update({ quantity: newQty })
    .eq("id", id);

  if (error) return json(500, { error: error.message });
  return json(200, { quantity: newQty });
};
