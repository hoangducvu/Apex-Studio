const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Ensure data/ directory exists
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "apex.db"));

// WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

// ── Schema ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id         TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL,
    category   TEXT    DEFAULT '',
    price      REAL    NOT NULL,
    image      TEXT    NOT NULL,
    badge      TEXT    DEFAULT '',
    quantity   INTEGER DEFAULT 0,
    active     INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    stripe_id  TEXT    UNIQUE,
    email      TEXT,
    items_json TEXT,
    total      REAL,
    status     TEXT    DEFAULT 'paid',
    created_at TEXT    DEFAULT (datetime('now'))
  );
`);

// ── Seed products if table is empty ───────────────────────────────────────
const count = db.prepare("SELECT COUNT(*) as n FROM products").get().n;

if (count === 0) {
  const insert = db.prepare(
    "INSERT INTO products (id, name, category, price, image, badge, quantity, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const seeds = [
    ["blade",   "APEX BLADE",      "Shield Wrap",     245, "assets/products/blade.svg",   "NEW",        50, 0],
    ["nox",     "NOX RECTANGLE",   "Slim Rect",        210, "assets/products/rect.svg",    "",           50, 1],
    ["aviator", "CHROME AVIATOR",  "Teardrop",         265, "assets/products/aviator.svg", "BESTSELLER", 50, 2],
    ["halo",    "HALO ROUND",      "Round",            195, "assets/products/round.svg",   "",           50, 3],
    ["feline",  "FELINE",          "Cat-Eye",          220, "assets/products/cateye.svg",  "LIMITED",    50, 4],
    ["brick",   "BRICK",           "Oversize Square",  230, "assets/products/square.svg",  "",           50, 5],
  ];

  const seedAll = db.transaction(() => {
    seeds.forEach((row) => insert.run(...row));
  });
  seedAll();

  console.log("✅  Database seeded with 6 products");
}

module.exports = db;
