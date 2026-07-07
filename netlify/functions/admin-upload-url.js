const { supabase, json, options, requireAdmin } = require("./_helpers");
const path = require("path");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  const authErr = requireAdmin(event);
  if (authErr) return authErr;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const { filename, contentType } = JSON.parse(event.body || "{}");
  if (!filename) return json(400, { error: "filename required" });

  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(contentType)) return json(400, { error: "Only jpg/png/webp allowed" });

  const ext      = path.extname(filename).toLowerCase() || ".jpg";
  const safeName = `products/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

  let { data, error } = await supabase.storage
    .from("product-images")
    .createSignedUploadUrl(safeName);

  // Bucket missing (fresh Supabase project) — create it and retry once
  if (error && /not exist|not found/i.test(error.message)) {
    await supabase.storage.createBucket("product-images", {
      public: true,
      fileSizeLimit: "10MB",
      allowedMimeTypes: allowed,
    });
    ({ data, error } = await supabase.storage
      .from("product-images")
      .createSignedUploadUrl(safeName));
  }

  if (error) return json(500, { error: error.message });

  const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/product-images/${safeName}`;
  return json(200, { signedUrl: data.signedUrl, publicUrl });
};
