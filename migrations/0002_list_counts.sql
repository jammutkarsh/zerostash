-- Kept in step with bookmark_lists inside the same batch as every add/remove, so the
-- sidebar can show counts without scanning bookmark_lists (Free plan: 5M reads/day).
ALTER TABLE lists ADD COLUMN item_count INTEGER NOT NULL DEFAULT 0;
