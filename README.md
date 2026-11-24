# Wish list

A wish list friends and family can browse and claim gifts from, with no account needed.

There are two versions while the move to Cloudflare finishes:

- **`cloudflare/`**: the new version, a Cloudflare Worker with a D1 database, meant for `wishlist.treybae.net`. See `cloudflare/README.md`.
- **`index.html` + `supabase/`**: the original version, served by GitHub Pages with data in the shared `vibe` Supabase project (tables prefixed `wishlist_`). It stays as is until the Cloudflare version is live.
