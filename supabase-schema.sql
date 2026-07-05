-- LUMLA GLASSES — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New query

-- ── Tables ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id         TEXT        PRIMARY KEY,
  name       TEXT        NOT NULL,
  category   TEXT        DEFAULT '',
  price      FLOAT       NOT NULL,
  image      TEXT        DEFAULT '',
  badge      TEXT        DEFAULT '',
  quantity   INTEGER     DEFAULT 0,
  active     BOOLEAN     DEFAULT TRUE,
  sort_order INTEGER     DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id         SERIAL      PRIMARY KEY,
  stripe_id  TEXT        UNIQUE,
  email      TEXT,
  items_json TEXT,
  total      FLOAT,
  status     TEXT        DEFAULT 'paid',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders   ENABLE ROW LEVEL SECURITY;

-- Public can read active products (storefront API uses service key, but good practice)
DROP POLICY IF EXISTS "public read active products" ON products;
CREATE POLICY "public read active products" ON products
  FOR SELECT USING (active = TRUE);

-- All writes use the service key server-side (bypasses RLS automatically)

-- ── Seed: LUMLA GLASSES starter catalog (first-time setup only) ─────────────
-- Runs ONLY when the products table is empty, so it never overwrites products
-- you've added or edited through the admin panel. Day-to-day product
-- management happens in the admin panel — this file is just initial setup.
INSERT INTO products (id, name, category, price, image, badge, quantity, sort_order)
SELECT *
FROM (VALUES
  ('silver-light-20', 'Silver Light Metallic 20', 'Light Metallic', 39.00, 'assets/products/azure.png',   'BEST SELLER', 50, 1),
  ('black-light-20',  'Black Light Metallic 20',  'Light Metallic', 39.00, 'assets/products/nox.png',     '',            50, 2),
  ('gold-light-20',   'Gold Light Metallic 20',   'Light Metallic', 42.00, 'assets/products/ember.png',   'NEW',         50, 3),
  ('blue-light-20',   'Blue Light Metallic 20',   'Light Metallic', 42.00, 'assets/products/riptide.png', '',            12, 4),
  ('heavy-chrome-01', 'Chrome Heavy Metallic 01', 'Heavy Metallic', 49.00, 'assets/products/flare.png',   'WORLD CUP',   50, 5)
) AS v(id, name, category, price, image, badge, quantity, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM products LIMIT 1);

-- ── Storage bucket setup (do this in Supabase Dashboard, not SQL) ────────────
-- 1. Go to Storage → New bucket
-- 2. Name: product-images
-- 3. Check "Public bucket" ✓
-- 4. Save
-- That's it — the admin panel will upload images there automatically.
