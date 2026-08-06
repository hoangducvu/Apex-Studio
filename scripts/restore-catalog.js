#!/usr/bin/env node
/**
 * Undo. Restores products from a backup written by apply-catalog.js.
 *
 *   node scripts/restore-catalog.js catalog-backups/products-backup-<stamp>.json
 *   node scripts/restore-catalog.js <file> --dry-run
 *
 * Only restores the text fields the rename touched (name, category, and the
 * variant columns if they exist). Prices, stock, images, badges and sort order
 * are never written, so a restore cannot clobber edits you made in the admin
 * panel after the rename.
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const DRY = process.argv.includes("--dry-run");
const file = process.argv[2];

if (!file || file.startsWith("--")) {
  console.error("Usage: node scripts/restore-catalog.js <backup.json> [--dry-run]");
  process.exit(1);
}
if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env");
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

(async () => {
  const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
  const probe = await fetch(`${URL}/rest/v1/products?select=variant_group&limit=1`, { headers });
  const fields = ["name", "category"].concat(probe.ok ? ["variant_group", "color_label"] : []);

  const r = await fetch(`${URL}/rest/v1/products?select=*`, { headers });
  const live = new Map((await r.json()).map((p) => [p.id, p]));

  let changed = 0;
  for (const old of snapshot) {
    const cur = live.get(old.id);
    if (!cur) { console.log(`  MISSING  ${old.id} — no longer in catalog`); continue; }

    const patch = {};
    for (const f of fields) {
      if (old[f] === undefined) continue;
      if ((cur[f] ?? "") !== (old[f] ?? "")) patch[f] = old[f] ?? "";
    }
    if (!Object.keys(patch).length) continue;

    console.log(`  ${DRY ? "WOULD  " : "RESTORE"} ${old.id}  ${JSON.stringify(patch)}`);
    if (!DRY) {
      const res = await fetch(`${URL}/rest/v1/products?id=eq.${encodeURIComponent(old.id)}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`PATCH ${old.id}: ${res.status} ${await res.text()}`);
    }
    changed++;
  }
  console.log(`\n${DRY ? "Dry run" : "Restored"}: ${changed} rows`);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
