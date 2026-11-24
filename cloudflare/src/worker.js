// Wish list Worker: serves the page from ./public and a small JSON API under /api.
//
// Shoppers (no account):
//   POST /api/shared   {tokens}            unclaimed items, plus ones this browser claimed
//   POST /api/claim    {item, token, name}  -> {result: claimed|taken|missing}
//   POST /api/unclaim  {item, token}        -> {ok}
// Owner (passphrase sign-in, session cookie):
//   GET  /api/me                            -> {owner: bool}
//   POST /api/login    {password}
//   POST /api/logout
//   GET  /api/items[?claims=1]              every item, claims only when asked for
//   POST /api/items                         add
//   PUT  /api/items/:id                     edit
//   DELETE /api/items/:id                   remove (its claim goes with it)
//   DELETE /api/claims/:id                  put an item back on the shared list
//
// Secret: OWNER_PASSWORD (set with `npx wrangler secret put OWNER_PASSWORD`), 16+ characters.

const SESSION_COOKIE = "wl_owner";
const SESSION_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;
const enc = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Something went wrong." }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

async function api(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  // Every write must be same-origin JSON. With the SameSite=Strict cookie this
  // shuts out cross-site form posts.
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) throw new HttpError(403, "Cross-site request refused.");
    if (!(request.headers.get("content-type") || "").includes("application/json")) {
      throw new HttpError(415, "Send JSON.");
    }
  }

  // ---- shoppers
  if (path === "/api/shared" && method === "POST") {
    const { tokens } = await body(request);
    const hashes = [];
    if (Array.isArray(tokens)) {
      for (const t of tokens.slice(0, 200)) if (validToken(t)) hashes.push(await sha256hex(t));
    }
    const placeholders = hashes.map(() => "?").join(",");
    const mineExpr = hashes.length ? `c.token_hash IN (${placeholders})` : "0";
    const { results } = await env.DB.prepare(
      `SELECT i.id, i.name, i.url, i.price_cents, i.notes, i.priority, i.kind, i.created_at,
              (c.item_id IS NOT NULL) AS mine
         FROM items i LEFT JOIN claims c ON c.item_id = i.id
        WHERE c.item_id IS NULL OR ${mineExpr}
        ORDER BY i.kind, i.priority, i.created_at`
    ).bind(...hashes).all();
    return json({ items: results.map(outItem) });
  }

  if (path === "/api/claim" && method === "POST") {
    const { item, token, name } = await body(request);
    if (typeof item !== "string" || !validToken(token)) throw new HttpError(400, "Bad request.");
    const exists = await env.DB.prepare("SELECT 1 FROM items WHERE id = ?").bind(item).first();
    if (!exists) return json({ result: "missing" });
    const cleanName = typeof name === "string" ? name.trim().slice(0, 80) || null : null;
    const r = await env.DB.prepare(
      "INSERT INTO claims (item_id, claimer_name, token_hash) VALUES (?, ?, ?) ON CONFLICT (item_id) DO NOTHING"
    ).bind(item, cleanName, await sha256hex(token)).run();
    return json({ result: r.meta.changes > 0 ? "claimed" : "taken" });
  }

  if (path === "/api/unclaim" && method === "POST") {
    const { item, token } = await body(request);
    if (typeof item !== "string" || !validToken(token)) throw new HttpError(400, "Bad request.");
    const r = await env.DB.prepare("DELETE FROM claims WHERE item_id = ? AND token_hash = ?")
      .bind(item, await sha256hex(token)).run();
    return json({ ok: r.meta.changes > 0 });
  }

  // ---- owner session
  if (path === "/api/me" && method === "GET") {
    return json({ owner: await isOwner(request, env) });
  }

  if (path === "/api/login" && method === "POST") {
    const secret = ownerSecret(env);
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const since = Date.now() - LOGIN_WINDOW_MS;
    const fails = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?")
      .bind(ip, since).first("n");
    if (fails >= LOGIN_MAX_FAILS) throw new HttpError(429, "Too many tries. Wait 15 minutes and try again.");
    const { password } = await body(request);
    const ok = typeof password === "string" && (await safeEqual(password, secret));
    if (!ok) {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, Date.now()),
        env.DB.prepare("DELETE FROM login_failures WHERE at < ?").bind(Date.now() - 24 * 3600 * 1000),
      ]);
      throw new HttpError(401, "That passphrase didn't match.");
    }
    await env.DB.prepare("DELETE FROM login_failures WHERE ip = ?").bind(ip).run();
    const exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
    const value = `${exp}.${await sign(String(exp), secret)}`;
    return json({ owner: true }, 200, { "set-cookie": cookie(value, SESSION_DAYS * 24 * 3600) });
  }

  if (path === "/api/logout" && method === "POST") {
    return json({ owner: false }, 200, { "set-cookie": cookie("", 0) });
  }

  // ---- owner only from here on
  if (path === "/api/items" || path.startsWith("/api/items/") || path.startsWith("/api/claims/")) {
    if (!(await isOwner(request, env))) throw new HttpError(401, "Sign in first.");
  }

  if (path === "/api/items" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM items ORDER BY kind, priority, created_at"
    ).all();
    const out = { items: results.map(outItem) };
    // Claims stay hidden unless the owner asks for them ("Show what's been claimed").
    if (url.searchParams.get("claims") === "1") {
      const c = await env.DB.prepare("SELECT item_id, claimer_name, created_at FROM claims").all();
      out.claims = c.results;
    }
    return json(out);
  }

  if (path === "/api/items" && method === "POST") {
    const row = cleanItem(await body(request));
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO items (id, name, url, price_cents, notes, priority, kind) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, row.name, row.url, row.price_cents, row.notes, row.priority, row.kind).run();
    return json({ id }, 201);
  }

  const itemMatch = path.match(/^\/api\/items\/([A-Za-z0-9-]{1,64})$/);
  if (itemMatch && method === "PUT") {
    const row = cleanItem(await body(request));
    const r = await env.DB.prepare(
      `UPDATE items SET name = ?, url = ?, price_cents = ?, notes = ?, priority = ?, kind = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
    ).bind(row.name, row.url, row.price_cents, row.notes, row.priority, row.kind, itemMatch[1]).run();
    if (!r.meta.changes) throw new HttpError(404, "That item is gone.");
    return json({ ok: true });
  }
  if (itemMatch && method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM claims WHERE item_id = ?").bind(itemMatch[1]),
      env.DB.prepare("DELETE FROM items WHERE id = ?").bind(itemMatch[1]),
    ]);
    return json({ ok: true });
  }

  const claimMatch = path.match(/^\/api\/claims\/([A-Za-z0-9-]{1,64})$/);
  if (claimMatch && method === "DELETE") {
    await env.DB.prepare("DELETE FROM claims WHERE item_id = ?").bind(claimMatch[1]).run();
    return json({ ok: true });
  }

  throw new HttpError(404, "Not found.");
}

// ---------------------------------------------------------------- helpers

async function body(request) {
  const text = await request.text();
  if (text.length > 20000) throw new HttpError(413, "Too big.");
  try {
    const v = JSON.parse(text || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {}
  throw new HttpError(400, "Bad JSON.");
}

function validToken(t) {
  return typeof t === "string" && t.length >= 20 && t.length <= 100;
}

function outItem(r) {
  const o = {
    id: r.id, name: r.name, url: r.url, notes: r.notes,
    priority: r.priority, kind: r.kind, created_at: r.created_at,
    price: r.price_cents == null ? null : r.price_cents / 100,
  };
  if ("mine" in r) o.mine = !!r.mine;
  return o;
}

function cleanItem(b) {
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 1 || name.length > 200) throw new HttpError(400, "Give it a name (up to 200 characters).");
  let url = typeof b.url === "string" ? b.url.trim() : "";
  if (url) {
    if (!/^https?:\/\//i.test(url) || url.length > 2000) throw new HttpError(400, "Links need to start with https:// or http://");
  } else url = null;
  let price_cents = null;
  if (b.price !== null && b.price !== undefined && b.price !== "") {
    const p = Number(b.price);
    if (!Number.isFinite(p) || p < 0 || p > 1e7) throw new HttpError(400, "That price doesn't look right.");
    price_cents = Math.round(p * 100);
  }
  const notes = typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : null;
  if (notes && notes.length > 1000) throw new HttpError(400, "Notes can be up to 1000 characters.");
  const priority = [1, 2, 3].includes(Number(b.priority)) ? Number(b.priority) : 2;
  const kind = b.kind === "need" ? "need" : "want";
  return { name, url, price_cents, notes, priority, kind };
}

function ownerSecret(env) {
  const s = env.OWNER_PASSWORD;
  if (typeof s !== "string" || s.length < 16) {
    throw new HttpError(503, "Owner sign-in isn't set up yet (OWNER_PASSWORD secret missing or under 16 characters).");
  }
  return s;
}

async function isOwner(request, env) {
  const s = env.OWNER_PASSWORD;
  if (typeof s !== "string" || s.length < 16) return false;
  const raw = (request.headers.get("cookie") || "")
    .split(/;\s*/).find((c) => c.startsWith(SESSION_COOKIE + "="));
  if (!raw) return false;
  const [exp, sig] = raw.slice(SESSION_COOKIE.length + 1).split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await sign(exp, s));
}

function cookie(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/api; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

// Session signatures use a key derived from the passphrase, so changing the
// passphrase signs every existing session out.
async function sign(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode("wishlist-session:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time compare: hash both sides so lengths match, then compare bytes.
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(x, y);
}

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
