# Wish list

A wish list friends and family can browse and claim gifts from, with no account needed.

- `index.html` is the whole site, served by GitHub Pages.
- Data lives in the shared `vibe` Supabase project, in tables prefixed `wishlist_` (`supabase/schema.sql`).
- The Supabase key in the page is the publishable key. Row-level security does the guarding: only the owner's confirmed account can add, edit or remove items, and visitors can only read unclaimed items and claim or unclaim through the `wishlist_` functions.
- Claims are hidden in the owner view unless "Show what's been claimed" is ticked.
