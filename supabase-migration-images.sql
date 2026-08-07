-- LUMLA GLASSES — multi-image product galleries
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Adds the column the admin panel writes the image order to:
--   images — ordered list of image URLs for one product.
--            [0] is the main shot (kept mirrored into products.image)
--            [1] is what the storefront reveals on hover
--            [2…] show as extra thumbnails on the product page
--
-- Until this runs, the admin panel keeps the gallery in a JSON document in
-- Storage instead, so the feature works either way — this just makes it a
-- first-class column.

ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;

-- Backfill: every existing product starts as a one-image gallery.
UPDATE products
   SET images = jsonb_build_array(image)
 WHERE (images IS NULL OR jsonb_array_length(images) = 0)
   AND COALESCE(image, '') <> '';

-- ── Reminder ────────────────────────────────────────────────────────────────
-- If colour grouping is still failing to save ("Could not find the
-- 'color_label' column of 'products' in the schema cache"), run
-- supabase-migration-variants.sql too.
