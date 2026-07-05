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
    ["azure",   "AZURE",   "Square",            220, "assets/products/azure.png",   "NEW",        50, 0],
    ["flare",   "FLARE",   "Iridescent Sport",  195, "assets/products/flare.png",   "",           50, 1],
    ["ember",   "EMBER",   "Square",            210, "assets/products/ember.png",   "BESTSELLER", 50, 2],
    ["riptide", "RIPTIDE", "Sport Wrap",        185, "assets/products/riptide.png", "",           12, 3],
    ["nox",     "NOX",     "Rectangle",         230, "assets/products/nox.png",     "LIMITED",    50, 4],
    ["crystal", "CRYSTAL", "Square",            205, "assets/products/crystal.png", "",           50, 5],
  ];

  const seedAll = db.transaction(() => {
    seeds.forEach((row) => insert.run(...row));
  });
  seedAll();

  console.log("✅  Database seeded with 6 products");
}

module.exports = db;
