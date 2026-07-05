const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

function requireAdmin(event) {
  const key = (event.headers || {})["x-admin-key"];
  if (!process.env.ADMIN_PASSWORD || key !== process.env.ADMIN_PASSWORD) {
    return json(401, { error: "Unauthorized" });
  }
  return null;
}

function json(statusCode, data) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(data),
  };
}

function options() {
  return { statusCode: 200, headers: CORS, body: "" };
}

module.exports = { supabase, CORS, requireAdmin, json, options };
