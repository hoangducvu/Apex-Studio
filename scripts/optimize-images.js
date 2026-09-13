#!/usr/bin/env node
/**
 * Re-encode the catalog's stored shots as lossless WebP.
 *
 *   node scripts/optimize-images.js --dry-run   # report only, write nothing
 *   node scripts/optimize-images.js             # apply
 *
 * Lossless is the whole point: the pixels a shopper sees do not change at all,
 * the file is simply packed better — about half the bytes of the PNGs coming
 * out of the design tools. Nothing is resized, so a frame is as sharp as the
 * day it was uploaded.
 *
 * Every image has to prove it before it replaces anything: the encode is
 * decoded again and compared to the original, and it is only uploaded if the
 * alpha channel matches bit for bit, every visible pixel matches exactly, and
 * the result is actually smaller. (Under a fully transparent pixel the colour
 * is invisible and libwebp normalises it; that is not a difference anyone can
 * see, and it is the one thing this ignores.)
 *
 * Objects keep their existing keys, so no stored URL changes and no product
 * row is touched. Safe to re-run — an image that is already WebP is skipped
 * because re-encoding it cannot get smaller.
 *
 * Uploads are stored exactly as picked, so run this after adding images.
 * Browsers cannot produce lossless WebP, which is why this is a step here
 * rather than something the admin panel does on the way in.
 *
 * Needs `sharp`, which is not a runtime dependency of the site:
 *   npm install --no-save sharp
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { createClient } = require("@supabase/supabase-js");
let sharp;
try {
  sharp = require("sharp");
} catch {
  console.error("sharp is needed for this script:  npm install --no-save sharp");
  process.exit(1);
}

const BUCKET = "product-images";
const DRY = process.argv.includes("--dry-run");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const rgba = (buf) => sharp(buf).ensureAlpha().raw().toBuffer();

/** Same picture, to the eye and to the compositor. */
function visuallyIdentical(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] !== b[i + 3]) return false;               // alpha, exactly
    if (a[i + 3] === 0) continue;                          // colour is invisible here
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return false;
  }
  return true;
}

/** Every image the catalog can still reach: product rows plus the gallery map. */
async function referencedKeys() {
  const keys = new Set();
  const add = (u) => {
    const s = String(u || "");
    const i = s.indexOf(`/${BUCKET}/`);
    if (s.startsWith("http") && i >= 0) keys.add(decodeURIComponent(s.slice(i + BUCKET.length + 2)));
  };

  const { data: rows, error } = await supabase.from("products").select("image,images");
  if (error) throw new Error(error.message);
  for (const p of rows) { add(p.image); for (const u of p.images || []) add(u); }

  const { data } = await supabase.storage.from("site-meta").download("product-images.json");
  if (data) {
    try {
      for (const list of Object.values(JSON.parse(await data.text()) || {})) {
        for (const u of list || []) add(u);
      }
    } catch { /* the map is optional */ }
  }
  return [...keys];
}

(async () => {
  const keys = await referencedKeys();
  let shrunk = 0, left = 0, before = 0, after = 0;
  const failed = [];

  for (const key of keys) {
    const { data, error } = await supabase.storage.from(BUCKET).download(key);
    if (error || !data) { failed.push(`${key}: ${error && error.message}`); continue; }
    const orig = Buffer.from(await data.arrayBuffer());
    before += orig.length;

    let out;
    try {
      out = await sharp(orig).webp({ lossless: true, effort: 6 }).toBuffer();
    } catch (err) {
      failed.push(`${key}: ${err.message}`);
      after += orig.length;
      continue;
    }

    const same = visuallyIdentical(await rgba(orig), await rgba(out));
    const worth = same && out.length < orig.length;
    after += worth ? out.length : orig.length;
    if (!worth) { left++; continue; }

    if (!DRY) {
      const up = await supabase.storage.from(BUCKET).upload(key, out, {
        contentType: "image/webp", upsert: true, cacheControl: "604800",
      });
      if (up.error) { failed.push(`${key}: ${up.error.message}`); continue; }
    }
    shrunk++;
  }

  const mb = (b) => (b / 1048576).toFixed(2) + " MB";
  console.log(DRY ? "Dry run — nothing was written." : "Applied.");
  console.log(`  repacked:   ${shrunk}`);
  console.log(`  left as-is: ${left}   (already WebP, or the encode was no smaller)`);
  console.log(`  stored:     ${mb(before)} -> ${mb(after)}` +
              (before ? `  (${(100 - after / before * 100).toFixed(1)}% smaller)` : ""));
  if (failed.length) {
    console.log(`  failed:     ${failed.length}`);
    for (const f of failed.slice(0, 10)) console.log("    " + f);
  }
})().catch((err) => { console.error(err.message); process.exit(1); });
