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
      "\n  i variant_group / color_label columns do not exist, so grouping goes to\n" +
      "    the Supabase Storage fallback (site-meta/variant-groups.json) that\n" +
      "    netlify/functions/variant-groups.js reads. Run\n" +
      "    supabase-migration-variants.sql if you would rather it live in columns —\n" +
      "    the columns take precedence automatically once they exist.\n"
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

  // ── Grouping fallback ─────────────────────────────────────────────────────
  // With no columns to write to, the grouping lives in a JSON document in
  // Supabase Storage. Same shape variant-groups.js reads: { id: {group, color} }.
  if (!variants) {
    const BUCKET = "site-meta", FILE = "variant-groups.json";
    const dl = await fetch(`${URL}/storage/v1/object/${BUCKET}/${FILE}`, { headers });
    const map = dl.ok ? JSON.parse(await dl.text()) : {};
    const before = JSON.stringify(map);

    for (const want of plan.products) {
      if (!byId.has(want.id)) continue;
      const group = (want.variant_group || "").trim();
      const color = (want.color_label || "").trim();
      if (!group && !color) delete map[want.id];
      else map[want.id] = { group, color };
    }

    if (JSON.stringify(map) === before) {
      console.log(`\nGrouping: already up to date (${Object.keys(map).length} entries)`);
    } else if (DRY) {
      console.log(`\nGrouping: WOULD write ${Object.keys(map).length} entries to ${BUCKET}/${FILE}`);
    } else {
      const up = await fetch(`${URL}/storage/v1/object/${BUCKET}/${FILE}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", "x-upsert": "true" },
        body: JSON.stringify(map, null, 1),
      });
      if (!up.ok) throw new Error(`Storage upload failed: ${up.status} ${await up.text()}`);
      console.log(`\nGrouping: wrote ${Object.keys(map).length} entries to ${BUCKET}/${FILE}`);
    }
  }

  console.log(
    `\n${DRY ? "Dry run" : "Applied"}: ${changed} changed, ${skipped} already correct` +
    (missing ? `, ${missing} missing` : "")
  );
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
