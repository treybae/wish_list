# Wish list on Cloudflare (Worker + D1)

The Cloudflare-only version of the wish list: no Supabase, free plan.

- `public/` is the page (`index.html`, `app.js`, `_headers`), served as static assets.
- `src/worker.js` handles `/api/*` and talks to the `wishlist` D1 database.
- `migrations/` is the D1 schema, the three items copied from Supabase, and a picture link per item (`0003`).

## Pictures

Each item can have a picture link (https only), pasted in the edit form. Items without one show a lettered placeholder. The Lord of the Rings and The Silmarillion covers come from the Open Library Covers API (by ISBN); Open Library has no cover for the illustrated Hobbit, so it starts on the placeholder.

## Who can do what

- **Family and friends:** no account. They see unclaimed items, tap "I'll get this", and can undo their own claim from the same browser (a random token kept in the browser; only its SHA-256 is stored).
- **Owner:** signs in with a passphrase stored as the Worker secret `OWNER_PASSWORD` (16+ characters). Sign-in sets a 30-day `HttpOnly; Secure; SameSite=Strict` cookie signed with a key derived from the passphrase, so changing the passphrase signs every session out. Failed sign-ins are rate limited per IP (8 per 15 minutes).
- **Claims stay hidden** from the owner unless "Show what's been claimed" is ticked; the API only returns claims when asked with `?claims=1`.

## Deploy

The D1 database already exists and all three migrations are applied.

```sh
cd cloudflare
npx wrangler login
npx wrangler deploy
openssl rand -base64 24   # a passphrase; save it in your password manager
npx wrangler secret put OWNER_PASSWORD
```

`wrangler deploy` attaches `wishlist.treybae.net` as a Workers Custom Domain, which needs `treybae.net` to be a zone in the same Cloudflare account and no existing DNS record on `wishlist`. To try it before the domain is ready, remove the `routes` line and use the `workers.dev` address.

Future schema changes: add a file to `migrations/` and run `npx wrangler d1 migrations apply wishlist --remote`.

## Local development

```sh
cd cloudflare
echo 'OWNER_PASSWORD="local-dev-passphrase-123"' > .dev.vars
npx wrangler d1 migrations apply wishlist --local
npx wrangler dev
```
