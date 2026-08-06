#!/usr/bin/env node
/**
 * Apply catalog-rename-plan.json to the live Supabase products table.
 *
 *   node scripts/apply-catalog.js            # apply
 *   node scripts/apply-catalog.js --dry-run  # show what would change, write nothing
 *
 * Safe to re-run: it only sends fields that actually differ from what is live,
 * so editing the plan and running again just applies the delta.
 *
 * Every run first writes a fresh backup to catalog-backups/ — restore with:
 *   node scripts/restore-catalog.js catalog-backups/<file>.json
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const ROOT = path.join(__dirname, "..");
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const DRY = process.argv.includes("--dry-run");

if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env");
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function get(qs) {
  const r = await fetch(`${URL}/rest/v1/products?${qs}`, { headers });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// The variant columns only exist once supabase-migration-variants.sql has been
// run in the Supabase SQL editor. Detect rather than assume.
async function hasVariantColumns() {
  const r = await fetch(`${URL}/rest/v1/products?select=variant_group&limit=1`, { headers });
  return r.ok;
}

(async () => {
  const live = await get("select=*");
  const variants = await hasVariantColumns();

  // ── Backup first, always ──────────────────────────────────────────────────
  const dir = path.join(ROOT, "catalog-backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(dir, `products-backup-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify(live, null, 2));
  console.log(`Backup:  ${path.relative(ROOT, backup)}  (${live.length} rows)`);

  if (!variants) {
    console.log(
      "\n  ! variant_group / color_label columns do not exist yet.\n" +
      "    Names and categories will still be applied.\n" +
      "    To enable colour grouping, run supabase-migration-variants.sql in the\n" +
      "    Supabase SQL editor, then re-run this script.\n"
    );
  }

  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog-rename-plan.json"), "utf8"));
  const byId = new Map(live.map((p) => [p.id, p]));

  const fields = ["name", "category"].concat(variants ? ["variant_group", "color_label"] : []);
  let changed = 0, skipped = 0, missing = 0;

  for (const want of plan.products) {
    const cur = byId.get(want.id);
    if (!cur) {
      console.log(`  MISSING  ${want.id} — not in live catalog, skipped`);
      missing++;
      continue;
    }

    const patch = {};
    for (const f of fields) {
      if (want[f] === undefined) continue;
      if ((cur[f] ?? "") !== want[f]) patch[f] = want[f];
    }

    if (!Object.keys(patch).length) { skipped++; continue; }

    const what = Object.keys(patch).map((f) => `${f}: ${JSON.stringify(cur[f] ?? "")} -> ${JSON.stringify(patch[f])}`).join(", ");
    console.log(`  ${DRY ? "WOULD  " : "UPDATE "} ${want.id}  ${what}`);

    if (!DRY) {
      const r = await fetch(`${URL}/rest/v1/products?id=eq.${encodeURIComponent(want.id)}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`PATCH ${want.id} failed: ${r.status} ${await r.text()}`);
    }
    changed++;
  }

  console.log(
    `\n${DRY ? "Dry run" : "Applied"}: ${changed} changed, ${skipped} already correct` +
    (missing ? `, ${missing} missing` : "")
  );
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
