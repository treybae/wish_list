// Wish list page. Talks to the Worker's /api routes on the same domain.
const OWNER_NAME = "Trey";

const $ = (id) => document.getElementById(id);
const PRIORITY = { 1: "Really want", 2: "Would like", 3: "Nice to have" };
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const state = { mode: "shop", items: [], claims: new Map(), filter: "all", editing: null, openClaim: null };

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n;
}
function msg(node, text, kind) { node.textContent = text || ""; node.className = "msg" + (kind ? " " + kind : ""); }
const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);

async function api(path, { method = "GET", body } = {}) {
  const opts = { method, credentials: "same-origin", headers: {} };
  if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opts); } catch { return { error: "Couldn't reach the site. Check your connection." }; }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) return { error: data.error || `Something went wrong (${res.status}).`, status: res.status };
  return { data };
}

// ---- per-browser claim tokens (lets a shopper undo their own claim)
function loadTokens() { try { return JSON.parse(localStorage.getItem("wl_tokens") || "{}"); } catch { return {}; } }
function saveTokens(t) { try { localStorage.setItem("wl_tokens", JSON.stringify(t)); } catch {} }
function newToken() {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

document.querySelectorAll(".chips button").forEach((b) => b.addEventListener("click", () => {
  state.filter = b.dataset.f;
  document.querySelectorAll(".chips button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  render();
}));

async function loadShop() {
  const { data, error } = await api("/api/shared", { method: "POST", body: { tokens: Object.values(loadTokens()) } });
  if (error) { msg($("listMsg"), "The list didn't load. Refresh to try again.", "err"); return; }
  state.items = data.items || [];
  msg($("listMsg"), "");
  render();
}

async function loadOwner() {
  const { data, error, status } = await api("/api/items" + ($("reveal").checked ? "?claims=1" : ""));
  if (status === 401) return setMode(false);
  if (error) { msg($("listMsg"), "Couldn't load your items: " + error, "err"); return; }
  state.items = data.items || [];
  state.claims = new Map((data.claims || []).map((r) => [r.item_id, r]));
  msg($("listMsg"), "");
  render();
}

const refresh = () => (state.mode === "owner" ? loadOwner() : loadShop());

function setMode(owner) {
  if (owner) {
    state.mode = "owner";
    $("owner").hidden = false; $("signin").hidden = true; $("ownerLink").hidden = true;
    $("eyebrow").textContent = "Your list";
    $("lede").textContent = "Add, edit or remove things here. Family and friends see the same list, minus anything someone has already claimed.";
    return loadOwner();
  }
  state.mode = "shop";
  state.claims = new Map();
  $("reveal").checked = false;
  $("owner").hidden = true; $("ownerLink").hidden = false;
  $("eyebrow").textContent = "Wish list";
  $("lede").replaceChildren("Pick something, tap ", el("strong", {}, "I'll get this"), ", and it comes off the list so nobody else buys it too.");
  return loadShop();
}

// ---- shopper actions
async function claim(item, name, btn) {
  btn.disabled = true;
  const tokens = loadTokens();
  const token = tokens[item.id] || newToken();
  const { data, error } = await api("/api/claim", { method: "POST", body: { item: item.id, token, name: name || null } });
  if (error) { btn.disabled = false; msg($("listMsg"), "That didn't go through. Try again.", "err"); return; }
  if (data.result === "claimed") { tokens[item.id] = token; saveTokens(tokens); msg($("listMsg"), `Got it. "${item.name}" is off the list for everyone else.`, "ok"); }
  else if (data.result === "taken") msg($("listMsg"), `Someone already claimed "${item.name}". Pick something else?`, "err");
  else msg($("listMsg"), `"${item.name}" was just removed from the list.`, "err");
  state.openClaim = null;
  await loadShop();
}
async function unclaim(item, btn) {
  btn.disabled = true;
  const tokens = loadTokens();
  const { error } = await api("/api/unclaim", { method: "POST", body: { item: item.id, token: tokens[item.id] || "" } });
  if (error) { btn.disabled = false; msg($("listMsg"), "That didn't go through. Try again.", "err"); return; }
  delete tokens[item.id]; saveTokens(tokens);
  msg($("listMsg"), `"${item.name}" is back on the list.`, "ok");
  await loadShop();
}

// ---- owner actions
function fillForm(item) {
  state.editing = item ? item.id : null;
  $("f_name").value = item?.name || ""; $("f_url").value = item?.url || "";
  $("f_price").value = item?.price ?? ""; $("f_kind").value = item?.kind || "want";
  $("f_priority").value = String(item?.priority || 2); $("f_notes").value = item?.notes || "";
  $("formTitle").textContent = item ? "Edit item" : "Add something";
  $("saveBtn").textContent = item ? "Save changes" : "Add to list";
  $("cancelEdit").hidden = !item;
  msg($("formMsg"), "");
  if (item) { $("owner").scrollIntoView({ behavior: "smooth", block: "start" }); $("f_name").focus(); }
}
$("cancelEdit").addEventListener("click", () => fillForm(null));
$("itemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("f_url").value.trim();
  if (url && !safeUrl(url)) { msg($("formMsg"), "Links need to start with https:// or http://", "err"); return; }
  const row = {
    name: $("f_name").value.trim(), url: url || null,
    price: $("f_price").value === "" ? null : Number($("f_price").value),
    kind: $("f_kind").value, priority: Number($("f_priority").value),
    notes: $("f_notes").value.trim() || null,
  };
  if (!row.name) { msg($("formMsg"), "Give it a name first.", "err"); return; }
  $("saveBtn").disabled = true;
  const { error, status } = state.editing
    ? await api("/api/items/" + encodeURIComponent(state.editing), { method: "PUT", body: row })
    : await api("/api/items", { method: "POST", body: row });
  $("saveBtn").disabled = false;
  if (status === 401) return setMode(false);
  if (error) { msg($("formMsg"), "Didn't save: " + error, "err"); return; }
  const was = state.editing;
  fillForm(null);
  msg($("formMsg"), was ? "Saved." : "Added.", "ok");
  loadOwner();
});
async function removeItem(item, btn) {
  if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = "Tap again to delete"; setTimeout(() => { btn.dataset.confirm = ""; btn.textContent = "Delete"; }, 4000); return; }
  btn.disabled = true;
  const { error } = await api("/api/items/" + encodeURIComponent(item.id), { method: "DELETE", body: {} });
  if (error) { btn.disabled = false; msg($("listMsg"), "Didn't delete: " + error, "err"); return; }
  if (state.editing === item.id) fillForm(null);
  msg($("listMsg"), `Removed "${item.name}".`, "ok");
  loadOwner();
}
async function releaseClaim(item, btn) {
  btn.disabled = true;
  const { error } = await api("/api/claims/" + encodeURIComponent(item.id), { method: "DELETE", body: {} });
  if (error) { btn.disabled = false; return; }
  msg($("listMsg"), `"${item.name}" is back on the shared list.`, "ok");
  loadOwner();
}
$("reveal").addEventListener("change", () => loadOwner());

// ---- sign in
$("ownerLink").addEventListener("click", () => { $("signin").hidden = false; $("s_pass").focus(); });
$("closeSignin").addEventListener("click", () => { $("signin").hidden = true; });
$("signinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("signinBtn").disabled = true; msg($("signinMsg"), "");
  const { error } = await api("/api/login", { method: "POST", body: { password: $("s_pass").value } });
  $("signinBtn").disabled = false;
  $("s_pass").value = "";
  if (error) { msg($("signinMsg"), error, "err"); return; }
  setMode(true);
});
$("signOut").addEventListener("click", async () => { await api("/api/logout", { method: "POST", body: {} }); setMode(false); });

// ---- render
function render() {
  const listEl = $("list"), mineEl = $("mineList");
  const show = (i) => state.filter === "all" || i.kind === state.filter;
  const owner = state.mode === "owner";
  const card = (item) => {
    const link = safeUrl(item.url);
    const claimRec = owner ? state.claims.get(item.id) : null;
    const pills = [
      el("span", { class: "pill" + (item.kind === "need" ? " need" : "") }, item.kind === "need" ? "Need" : "Want"),
      el("span", { class: "pill" + (item.priority === 1 ? " p1" : "") }, PRIORITY[item.priority] || "Would like"),
      claimRec ? el("span", { class: "pill claimed" }, "Claimed" + (claimRec.claimer_name ? " by " + claimRec.claimer_name : "")) : null,
    ];
    const actions = el("div", { class: "actions" });
    if (owner) {
      actions.append(
        el("button", { type: "button", onclick: () => fillForm(item) }, "Edit"),
        el("button", { type: "button", class: "danger", onclick: (e) => removeItem(item, e.currentTarget) }, "Delete"),
      );
      if (claimRec) actions.append(el("button", { type: "button", class: "ghost", onclick: (e) => releaseClaim(item, e.currentTarget) }, "Put back on list"));
    } else if (item.mine) {
      actions.append(el("button", { type: "button", onclick: (e) => unclaim(item, e.currentTarget) }, "Undo, I'm not getting it"));
    } else if (state.openClaim === item.id) {
      const nameId = "n_" + item.id;
      const nameIn = el("input", { id: nameId, maxlength: "80", placeholder: "e.g. Aunt Jo", autocomplete: "name" });
      actions.append(el("div", { class: "claimbox", style: "width:100%" },
        el("label", { for: nameId }, `Your name (optional). ${OWNER_NAME} won't see it unless he peeks.`),
        nameIn,
        el("div", { class: "actions" },
          el("button", { type: "button", class: "primary", onclick: (e) => claim(item, nameIn.value.trim(), e.currentTarget) }, "Yes, I'm getting it"),
          el("button", { type: "button", class: "ghost", onclick: () => { state.openClaim = null; render(); } }, "Cancel"))));
    } else {
      actions.append(el("button", { type: "button", class: "primary", onclick: () => { state.openClaim = item.id; render(); } }, "I'll get this"));
    }
    return el("article", { class: "tag" + (item.priority === 1 ? " p1" : "") + (item.mine ? " mine" : "") },
      el("div", { class: "row" },
        el("div", { class: "name" }, link ? el("a", { href: link, target: "_blank", rel: "noopener noreferrer" }, item.name) : item.name),
        item.price != null ? el("span", { class: "price" }, money.format(item.price)) : null),
      el("div", { class: "meta" }, pills),
      item.notes ? el("p", { class: "notes" }, item.notes) : null,
      actions);
  };
  const mine = owner ? [] : state.items.filter((i) => i.mine);
  const rest = state.items.filter((i) => !i.mine && show(i));
  $("mineSec").hidden = mine.length === 0;
  mineEl.replaceChildren(...mine.map(card));
  if (rest.length) listEl.replaceChildren(...rest.map(card));
  else listEl.replaceChildren(el("div", { class: "empty" },
    owner ? "Your list is empty. Add the first thing above."
      : state.items.length ? "Nothing here under this filter." : `Everything's been claimed, or ${OWNER_NAME} hasn't added anything yet.`));
}

api("/api/me").then(({ data }) => setMode(!!data?.owner));
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
