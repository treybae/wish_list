-- Wish list schema for Cloudflare D1 (SQLite).
-- Owner signs in with a passphrase (Worker secret). Shoppers need no account.

CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  url         TEXT CHECK (url IS NULL OR ((url LIKE 'https://%' OR url LIKE 'http://%') AND length(url) <= 2000)),
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  notes       TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  priority    INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3), -- 1 high, 2 medium, 3 low
  kind        TEXT NOT NULL DEFAULT 'want' CHECK (kind IN ('want', 'need')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One claim per item. token_hash is the SHA-256 of a random token that only
-- the claiming browser keeps, so that browser (and nobody else) can undo it.
CREATE TABLE IF NOT EXISTS claims (
  item_id      TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  claimer_name TEXT CHECK (claimer_name IS NULL OR length(claimer_name) <= 80),
  token_hash   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Failed owner sign-ins, for rate limiting.
CREATE TABLE IF NOT EXISTS login_failures (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_failures_ip_at ON login_failures (ip, at);
