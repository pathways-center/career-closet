import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://qvyhnnvyyjjnzkmecoga.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3x48GzRMEQV1BYVmnrpJWQ_F7GJ5NFP";
const BUCKET = "career-closet";

const BASE_URL = new URL(".", import.meta.url).href;
const IS_CALLBACK_PAGE = window.location.pathname.includes("/auth/callback/");
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

let CURRENT_USER_ID = null;
let CART = [];
let LAST_INVENTORY = []; // keep latest inventory in memory

function safePageId() {
  const hasToken = (window.location.hash || "").includes("access_token=");
  return `${window.location.origin}${window.location.pathname}${hasToken ? " (hash_has_token)" : ""}`;
}
console.log("[auth.js] loaded on", safePageId());

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

function $(id) { return document.getElementById(id); }

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg ?? "";
  console.log("[status]", msg ?? "");
}
function setSubStatus(msg) {
  const el = $("subStatus");
  if (el) el.textContent = msg ?? "";
  console.log("[subStatus]", msg ?? "");
}

function cleanUrlKeepPath() {
  const url = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, url);
}
function getRedirectTo() { return `${BASE_URL}auth/callback/`; }

function getStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.access_token) return null;
    return s;
  } catch { return null; }
}
function clearStoredSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

function storeSessionFromHash() {
  const hashParams = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  const access_token = hashParams.get("access_token");
  const refresh_token = hashParams.get("refresh_token");
  const token_type = hashParams.get("token_type") || "bearer";
  const expires_in = Number(hashParams.get("expires_in") || "3600");
  const expires_at_from_hash = Number(hashParams.get("expires_at") || "0");
  const expires_at =
    expires_at_from_hash > 0 ? expires_at_from_hash : Math.floor(Date.now() / 1000) + expires_in;

  const err = hashParams.get("error_description") || hashParams.get("error");
  if (err) return { ok: false, error: `Auth error: ${err}` };
  if (!access_token) return { ok: false, error: "No access_token found in URL hash." };

  const session = {
    access_token,
    refresh_token: refresh_token || "",
    token_type,
    expires_in,
    expires_at,
    provider_token: null,
    provider_refresh_token: null,
    user: null,
  };

  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); }
  catch (e) { return { ok: false, error: `Failed to write session to localStorage: ${e?.message || String(e)}` }; }

  return { ok: true };
}

function buildPublicImageUrl(image_path) {
  if (!image_path) return "";
  const encoded = encodeURIComponent(image_path).replaceAll("%2F", "/");
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encoded}`;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchJson(url, { headers = {}, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("fetch timeout")), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const detail = (json && (json.message || json.error_description || json.error)) || text || res.statusText;
      throw new Error(`HTTP ${res.status}: ${detail}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/* ===================== CART ===================== */

function cartStorageKey() {
  return CURRENT_USER_ID ? `cc-cart-${CURRENT_USER_ID}` : "cc-cart-guest";
}
function loadCart() {
  try {
    const raw = localStorage.getItem(cartStorageKey());
    CART = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(CART)) CART = [];
  } catch { CART = []; }
  CART = Array.from(new Set(CART.map(x => String(x).trim()).filter(Boolean)));
  if (CART.length > 5) CART = CART.slice(0, 5);
}
function saveCart() {
  try { localStorage.setItem(cartStorageKey(), JSON.stringify(CART)); } catch {}
}
function updateCartBadge() {
  const el = $("cartCount");
  if (el) el.textContent = String(CART.length);
}
function addToCart(id) {
  id = String(id || "").trim();
  if (!id) return;

  const out = $("reqStatus");
  if (CART.includes(id)) {
    if (out) out.textContent = `Already in cart: ${id}`;
    return;
  }
  if (CART.length >= 5) {
    if (out) out.textContent = "Cart limit: max 5 items.";
    return;
  }

  CART.push(id);
  saveCart();
  renderCart();
  updateCartBadge();

  if (out) out.textContent = `Added to cart: ${id}`;
}
function removeFromCart(id) {
  CART = CART.filter(x => x !== id);
  saveCart();
  renderCart();
  updateCartBadge();
}
function clearCart() {
  CART = [];
  saveCart();
  renderCart();
  updateCartBadge();
}
function renderCart() {
  const list = $("cartList");
  if (!list) return;

  if (!CART.length) {
    list.innerHTML = `<div class="muted">Cart is empty.</div>`;
    return;
  }

  // Optional: show some item details if we have LAST_INVENTORY
  const byId = new Map(LAST_INVENTORY.map(x => [x.inventory_id, x]));

  list.innerHTML = CART.map((id) => {
    const row = byId.get(id);
    const sub = row ? `${esc(row.brand || "-")} · ${esc(row.size || "-")} · ${esc(row.color || "-")}` : "";
    return `
      <div class="cartline">
        <div>
          <div style="font-weight:800;">${esc(id)}</div>
          ${sub ? `<div class="muted" style="font-size:12px; margin-top:2px;">${sub}</div>` : ""}
        </div>
        <div class="right"></div>
        <button type="button" class="btn-sm" data-remove="${esc(id)}">Remove</button>
      </div>
    `;
  }).join("");

  list.querySelectorAll("button[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => removeFromCart(btn.getAttribute("data-remove")));
  });
}

/* ===================== INVENTORY ===================== */

async function loadInventoryViaRest(accessToken) {
  setSubStatus("Loading inventory...");

  const select = "inventory_id,brand,color,size,fit,category,status,image_path,created_at";
  const url =
    `${SUPABASE_URL}/rest/v1/items` +
    `?select=${encodeURIComponent(select)}` +
    `&order=${encodeURIComponent("created_at.desc")}`;

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Accept: "application/json",
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const data = await fetchJson(url, { headers, timeoutMs: 12000 });
  LAST_INVENTORY = Array.isArray(data) ? data : [];

  renderInventory(LAST_INVENTORY);
  renderCart();          // keep cart view in sync with latest item info
  updateCartBadge();

  setSubStatus("");
}

function renderInventory(items) {
  const el = $("inventory");
  if (!el) return;

  if (!items || items.length === 0) {
    el.innerHTML = `<div class="muted">No items found.</div>`;
    return;
  }

  el.innerHTML = items.map((row) => {
    const imgUrl = row.image_path ? buildPublicImageUrl(row.image_path) : "";
    const id = String(row.inventory_id || "");
    const title = esc(id);
    const status = String(row.status || "").toLowerCase();
    const canAdd = status === "available"; // MVP: only available can be added

    const addBtn = `
      <button type="button" class="btn-sm"
        data-add="${title}"
        ${(!canAdd || CART.includes(id)) ? "disabled" : ""}>
        ${CART.includes(id) ? "In cart" : (canAdd ? "Add to cart" : "Not available")}
      </button>
    `;

    return `
      <div class="item-card">
        <div class="imgbox">
          ${
            imgUrl
              ? `<img class="item-img" src="${imgUrl}" alt="${title}" loading="lazy">
                 <div class="muted img-fallback" style="display:none;">Image not found</div>`
              : `<div class="muted">No image</div>`
          }
        </div>

        <div style="margin-top:10px; font-weight:800;">${title}</div>

        <div class="muted" style="margin-top:6px; line-height:1.4;">
          <div><b>Brand:</b> ${esc(row.brand) || "-"}</div>
          <div><b>Color:</b> ${esc(row.color) || "-"}</div>
          <div><b>Size:</b> ${esc(row.size) || "-"}</div>
          <div><b>Fit:</b> ${esc(row.fit) || "-"}</div>
          <div><b>Category:</b> ${esc(row.category) || "-"}</div>
          <div><b>Status:</b> ${esc(row.status) || "-"}</div>
        </div>

        <div class="row" style="margin-top:10px;">
          ${addBtn}
        </div>
      </div>
    `;
  }).join("");

  el.querySelectorAll(".item-img").forEach((img) => {
    img.addEventListener("error", () => {
      img.style.display = "none";
      const fallback = img.parentElement?.querySelector(".img-fallback");
      if (fallback) fallback.style.display = "block";
    }, { once: true });
  });

  el.querySelectorAll("button[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => addToCart(btn.getAttribute("data-add")));
  });
}

function wireInventorySearch() {
  const input = $("invSearch");
  if (!input) return;

  input.addEventListener("input", () => {
    const q = (input.value || "").trim().toLowerCase();
    const cards = document.querySelectorAll("#inventory .item-card");
    cards.forEach((c) => {
      const text = (c.textContent || "").toLowerCase();
      c.style.display = q === "" || text.includes(q) ? "" : "none";
    });
  });
}

/* ===================== RESERVE CART ===================== */

function wireCartUiEvents() {
  const btnOpenCart = $("btnOpenCart");
  const btnClearCart = $("btnClearCart");
  const btnReserveCart = $("btnReserveCart");

  if (btnOpenCart) {
    btnOpenCart.addEventListener("click", () => {
      const sec = $("requestSection");
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (btnClearCart) {
    btnClearCart.addEventListener("click", () => {
      clearCart();
      const out = $("reqStatus");
      if (out) out.textContent = "Cart cleared.";
      // also refresh buttons state
      renderInventory(LAST_INVENTORY);
    });
  }

  if (btnReserveCart) {
    btnReserveCart.addEventListener("click", async () => {
      try {
        await submitReservationCart();
      } catch (e) {
        const out = $("reqStatus");
        if (out) out.textContent = `Error: ${e?.message || String(e)}`;
        console.error(e);
      }
    });
  }
}

async function submitReservationCart() {
  const out = $("reqStatus");

  if (!CART.length) { if (out) out.textContent = "Cart is empty."; return; }
  if (CART.length > 5) { if (out) out.textContent = "Cart limit: max 5 items."; return; }

  const pickupDate = ($("reqDate")?.value || "").trim();       // YYYY-MM-DD
  const pickupTime = ($("reqStart")?.value || "").trim();      // HH:MM (optional)
  const fullName = ($("reqFullName")?.value || "").trim();
  const emoryId = ($("reqEmoryId")?.value || "").trim();
  const phone = ($("reqPhone")?.value || "").trim();

  if (!pickupDate) { if (out) out.textContent = "Please select a pickup date."; return; }
  if (!fullName) { if (out) out.textContent = "Full name is required."; return; }
  if (!emoryId) { if (out) out.textContent = "Emory ID is required."; return; }

  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !sessData?.session?.access_token) {
    if (out) out.textContent = "Not signed in.";
    return;
  }
  const accessToken = sessData.session.access_token;

  if (out) out.textContent = "Submitting reservation...";

  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-reservation`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${accessToken}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      cart_items: CART,               // ✅ 一次提交多个
      full_name: fullName,
      emory_id: emoryId,
      phone: phone,
      pickup_date: pickupDate,
      pickup_time: pickupTime || null,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (out) out.textContent = `Reserve failed: ${json?.error || res.statusText}`;
    return;
  }

  if (out) out.textContent = `Reserved OK. Reservation ID: ${json?.result?.reservation_id ?? "?"}`;

  clearCart();
  renderInventory(LAST_INVENTORY); // refresh "In cart" buttons
  await loadInventoryViaRest(accessToken);
}

/* ===================== AUTH ===================== */

function wireAuthEvents() {
  const elEmail = $("email");
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");

  if (btnLogin && elEmail) {
    btnLogin.addEventListener("click", async () => {
      try {
        const email = (elEmail.value || "").trim().toLowerCase();
        if (!email) { setStatus("Please enter an email."); return; }

        setStatus("Sending magic link...");
        setSubStatus("");

        const redirectTo = getRedirectTo();
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) throw error;

        setStatus(`Magic link sent to: ${email}`);
      } catch (e) {
        setStatus(`Error: ${e?.message || String(e)}`);
        console.error(e);
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      // clear our local stored session & cart
      clearStoredSession();
      CURRENT_USER_ID = null;
      CART = [];
      try { localStorage.removeItem("cc-cart-guest"); } catch {}

      try {
        await Promise.race([
          supabase.auth.signOut(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("signOut timeout")), 6000)),
        ]);
      } catch (e) {
        console.log("[logout]", e?.message || String(e));
      }
      await refreshUi();
    });
  }
}

async function refreshUi() {
  const session = getStoredSession();

  const signedOutHint = $("signedOutHint");
  const signedInArea = $("signedInArea");
  const whoamiHint = $("whoamiHint");

  if (!session) {
    CURRENT_USER_ID = null;
    CART = [];
    updateCartBadge();
    renderCart();

    setStatus("Signed out");
    setSubStatus("");

    if (signedOutHint) signedOutHint.style.display = "block";
    if (signedInArea) signedInArea.style.display = "none";
    return;
  }

  setStatus("Signed in");
  setSubStatus("");

  // get user email + id from JWT by calling auth.getUser with anon key
  const { data: userData, error: userErr } = await supabase.auth.getUser(session.access_token);
  if (userErr || !userData?.user) {
    // token invalid => force logout locally
    clearStoredSession();
    CURRENT_USER_ID = null;
    CART = [];
    updateCartBadge();
    renderCart();

    setStatus("Signed out");
    setSubStatus("Session invalid. Please sign in again.");
    if (signedOutHint) signedOutHint.style.display = "block";
    if (signedInArea) signedInArea.style.display = "none";
    return;
  }

  const user = userData.user;
  const email = (user.email || "").toLowerCase();
  CURRENT_USER_ID = user.id;

  // load cart for this user
  loadCart();
  updateCartBadge();

  // fill readonly email in form
  const reqEmail = $("reqEmail");
  if (reqEmail) reqEmail.value = email || "";

  if (whoamiHint) whoamiHint.textContent = email ? `Welcome: ${email}` : "Authenticated";
  if (signedOutHint) signedOutHint.style.display = "none";
  if (signedInArea) signedInArea.style.display = "block";

  await loadInventoryViaRest(session.access_token);
  renderCart();
}

async function handleCallbackPage() {
  setStatus("Signing you in...");
  setSubStatus("Saving session locally...");

  const res = storeSessionFromHash();
  cleanUrlKeepPath();

  if (!res.ok) {
    setStatus(`Error: ${res.error}`);
    setSubStatus("");
    return;
  }

  setSubStatus("Redirecting...");
  window.location.replace(BASE_URL);
}

/* ===================== BOOT ===================== */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    if (IS_CALLBACK_PAGE) {
      await handleCallbackPage();
      return;
    }

    wireAuthEvents();
    wireCartUiEvents();
    wireInventorySearch();

    await refreshUi();
  } catch (e) {
    setStatus(`Error: ${e?.message || String(e)}`);
    setSubStatus("");
    console.error(e);
  }
});
// ===== Force-bind cart buttons (fallback) =====
function wireReserveCartFallback() {
  const btn = document.getElementById("btnReserveCart");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      console.log("[btnReserveCart] clicked");
      try {
        if (typeof submitReservationCart === "function") {
          await submitReservationCart();
        } else if (typeof submitReservationSingle === "function") {
          await submitReservationSingle();
        } else {
          alert("submitReservationCart() not found in auth.js");
        }
      } catch (e) {
        console.error(e);
        const out = document.getElementById("reqStatus");
        if (out) out.textContent = `Error: ${e?.message || String(e)}`;
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  wireReserveCartFallback();
});
