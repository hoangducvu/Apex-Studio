-- LUMLA GLASSES — shipping address on orders
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run
--
-- The checkout has always collected a delivery address and passed it to
-- Stripe, but the orders table never kept a copy — so packing an order meant
-- opening the Stripe dashboard. These columns store the address alongside the
-- order, and the admin panel shows it in the Recent Orders table.
--
-- Address lines are stored exactly as Stripe holds them, so anything already
-- paid for can be backfilled from the payment (the admin orders endpoint does
-- that on its own the first time it sees an order with no address).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_name    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_line1   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_line2   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_city    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_zip     TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_state   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_country TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_phone   TEXT;
-- Which postage the customer paid for, so tracked orders are easy to spot.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_method  TEXT;
