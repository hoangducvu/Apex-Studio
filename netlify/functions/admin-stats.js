const { supabase, json, options, requireAdmin } = require("./_helpers");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  const authErr = requireAdmin(event);
  if (authErr) return authErr;

  const [{ count: totalProducts }, { count: totalOrders }, { data: revenueRows }] = await Promise.all([
    supabase.from("products").select("*", { count: "exact", head: true }).eq("active", true),
    supabase.from("orders").select("*", { count: "exact", head: true }),
    supabase.from("orders").select("total").eq("status", "paid"),
  ]);

  const totalRevenue = (revenueRows || []).reduce((s, o) => s + (o.total || 0), 0);

  return json(200, {
    totalProducts: totalProducts || 0,
    totalOrders:   totalOrders   || 0,
    totalRevenue,
  });
};
