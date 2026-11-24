-- The three items that were in the Supabase "vibe" project (wishlist_items)
-- on 2026-11-24, copied over with their original ids. There were no claims.
INSERT OR IGNORE INTO items (id, name, url, price_cents, notes, priority, kind, created_at, updated_at) VALUES
  ('ee3067f8-0735-4326-8ddb-745fe2f7449b', 'The Hobbit: Illustrated by the Author (Tolkien Illustrated Editions)', 'https://www.amazon.com/dp/0063347539', NULL, NULL, 2, 'want', '2026-11-24T17:06:42.735Z', '2026-11-24T17:06:42.735Z'),
  ('5558c400-449a-442b-920f-9d53d0090105', 'The Lord of the Rings: Illustrated by the Author', 'https://www.amazon.com/dp/0358653037', NULL, NULL, 2, 'want', '2026-11-24T17:06:42.736Z', '2026-11-24T17:06:42.736Z'),
  ('f1a93d54-20e5-4bd2-b056-616021fc4419', 'The Silmarillion: Illustrated by the Author', 'https://www.amazon.com/dp/0063280779', NULL, NULL, 2, 'want', '2026-11-24T17:06:42.737Z', '2026-11-24T17:06:42.737Z');
