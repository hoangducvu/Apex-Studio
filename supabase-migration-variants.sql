-- LUMLA GLASSES — colour-variant grouping
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Adds two columns the admin panel writes to:
--   variant_group — frames sharing this label are the SAME style in different
--                   colours. They collapse into one card on the storefront,
--                   with a thumbnail per colour. Leave blank = stands alone.
--   color_label   — what the swatch is called (e.g. "Matte Black").
--                   Leave blank and the name is used.

ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_group TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS color_label   TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS products_variant_group_idx
  ON products (variant_group)
  WHERE variant_group <> '';
