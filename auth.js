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

// ===== Idle auto-logout (15 minutes) =====
const IDLE_MS = 15 * 60 * 1000;
let __lastActiveAt = Date.now();
let __idleTimer = null;

function startIdleLogout() {
  const bump = () => { __lastActiveAt = Date.now(); };
  ["pointerdown","mousedown","mousemove","keydown","scroll","touchstart"].forEach((evt) => {
    window.addEventListener(evt, bump, { capture: true, passive: true });
  });

  if (__idleTimer) clearInterval(__idleTimer);
  __idleTimer = setInterval(async () => {
    const session = getStoredSession();
    if (!session) return;

    if (Date.now() - __lastActiveAt < IDLE_MS) return;

    __lastActiveAt = Date.now() + 10 * IDLE_MS;

    // toast("Signed out due to inactivity.", "info");
    setStatus("Signed out");
    setSubStatus("You were signed out due to inactivity.");

    clearStoredSession();
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (e) {
      console.warn("[idle signOut]", e?.message || e);
    }

    await refreshUi();
  }, 15 * 1000);
}


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

function toast(message, kind = "info", ms = 2500) {
  const el = document.getElementById("toast");
  if (!el) return;

  el.className = `toast show ${kind}`;
  el.textContent = String(message || "");

  // use a single global timer to avoid "already declared" errors
  if (globalThis.__ccToastTimer) clearTimeout(globalThis.__ccToastTimer);

  globalThis.__ccToastTimer = setTimeout(() => {
    el.className = "toast";
    el.textContent = "";
    globalThis.__ccToastTimer = null;
  }, ms);

  el.onclick = () => {
    el.className = "toast";
    el.textContent = "";
    if (globalThis.__ccToastTimer) clearTimeout(globalThis.__ccToastTimer);
    globalThis.__ccToastTimer = null;
  };
}



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
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.access_token) return null;
    return s;
  } catch {
    return null;
  }
}

function clearStoredSession() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
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

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (e) {
    return { ok: false, error: `Failed to write session to sessionStorage: ${e?.message || String(e)}` };
  }

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

  if (CART.includes(id)) {
    toast(`Already in cart: ${id}`, "info", 2000);
    return;
  }

  if (CART.length >= 5) {
    toast("Cart limit reached: you can select up to 5 items.", "error", 3000);
    return;
  }

  CART.push(id);
  saveCart();
  renderCart();
  updateCartBadge();

  toast(`Added to cart: ${id} (${CART.length}/5)`, "success", 2000);

  const out = $("reqStatus"); if (out) out.textContent = `Added to cart: ${id}`;
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
  const el = $("cartList");
  if (!el) return;

  if (!Array.isArray(CART) || CART.length === 0) {
    el.innerHTML = `<div class="muted">Cart is empty.</div>`;
    return;
  }

  const map = new Map((LAST_INVENTORY || []).map(r => [String(r.inventory_id || ""), r]));

  el.innerHTML = CART.map((id) => {
    const row = map.get(String(id)) || null;

    const imgUrl = row?.image_path ? buildPublicImageUrl(row.image_path) : "";
    const title = esc(id);

    const sub = row
      ? `${esc(row.brand || "Unknown")} · ${esc(row.size || "Unknown")} · ${esc(row.color || "Unknown")}`
      : `Unknown item`;

    const thumb = imgUrl
      ? `<img class="cart-thumb" src="${imgUrl}" alt="${title}" loading="lazy">`
      : `<div class="cart-thumbbox">No<br>image</div>`;

    return `
      <div class="cartline">
        ${thumb}
        <div style="flex:1; min-width:0;">
          <div style="font-weight:800;">${title}</div>
          <div class="muted" style="margin-top:2px;">${sub}</div>
        </div>
        <button type="button" class="btn-sm" data-remove="${title}">Remove</button>
      </div>
    `;
  }).join("");

  el.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-remove");
      removeFromCart(id);
    });
  });

  // image fallback
  el.querySelectorAll("img.cart-thumb").forEach((img) => {
    img.addEventListener("error", () => {
      img.replaceWith(Object.assign(document.createElement("div"), {
        className: "cart-thumbbox",
        innerHTML: "No<br>image"
      }));
    }, { once: true });
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
  const items = Array.isArray(data) ? data : [];
  
  LAST_INVENTORY = items;
  
  rebuildCategoryOptions(items);
  applyInventoryFilters();
  
  renderCart();
  updateCartBadge();
  
  setSubStatus("");
  return items;

}

function rebuildCategoryOptions(items) {
  const sel = $("filterCategory");
  if (!sel) return;

  const prev = sel.value || "";
  const cats = Array.from(
    new Set(
      (items || [])
        .map(r => String(r.category || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  sel.innerHTML = `<option value="">All categories</option>` + cats
    .map(c => `<option value="${esc(c)}">${esc(c)}</option>`)
    .join("");

  // restore selection if possible
  sel.value = cats.includes(prev) ? prev : "";
}

function applyInventoryFilters() {
  const q = (($("invSearch")?.value || "").trim().toLowerCase());
  const cat = (($("filterCategory")?.value || "").trim());
  const availableOnly = !!$("filterAvailableOnly")?.checked;

  const filtered = (LAST_INVENTORY || []).filter((row) => {
    const id = String(row.inventory_id || "");
    const brand = String(row.brand || "");
    const color = String(row.color || "");
    const size = String(row.size || "");
    const fit = String(row.fit || "");
    const category = String(row.category || "");
    const status = String(row.status || "").toLowerCase();

    if (availableOnly && status !== "available") return false;
    if (cat && category !== cat) return false;

    if (q) {
      const hay = `${id} ${brand} ${color} ${size} ${fit} ${category} ${status}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  renderInventory(filtered);
}

function wireInventoryFilters() {
  $("invSearch")?.addEventListener("input", () => applyInventoryFilters());
  $("filterCategory")?.addEventListener("change", () => applyInventoryFilters());
  $("filterAvailableOnly")?.addEventListener("change", () => applyInventoryFilters());
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


function setReqStatus(msg, kind = "info", autoClearMs = 0) {
  const el = $("reqStatus");
  if (!el) return;

  el.textContent = msg || "";

  el.style.border = "1px solid #eee";
  el.style.background = "#f6f6f6";
  if (kind === "success") { el.style.background = "#f3fff3"; el.style.border = "1px solid #cfeccf"; }
  if (kind === "error")   { el.style.background = "#fff3f3"; el.style.border = "1px solid #f0caca"; }

  // store timer on the element to avoid global re-declaration issues
  if (el.__ccTimer) clearTimeout(el.__ccTimer);
  el.__ccTimer = null;

  if (autoClearMs > 0) {
    el.__ccTimer = setTimeout(() => {
      el.textContent = "";
      el.style.border = "1px solid #eee";
      el.style.background = "#f6f6f6";
      el.__ccTimer = null;
    }, autoClearMs);
  }
}


function humanizeReserveError(raw) {
  const s = String(raw || "");

  const m = s.match(/limit exceeded:\s*in_use=(\d+)\s+new=(\d+)\s+max=(\d+)/i);
  if (m) {
    const inUse = Number(m[1]);
    const newly = Number(m[2]);
    const max = Number(m[3]);
    const remaining = Math.max(0, max - inUse);

    if (remaining === 0) {
      return `You already have ${inUse} active item(s) (not returned / not completed), which is the maximum (${max}). Please return or cancel items before reserving more.`;
    }
    return `You already have ${inUse} active item(s). You're trying to reserve ${newly} more, which would exceed the limit (${max}). You can reserve up to ${remaining} more right now.`;
  }

  if (/missing bearer token/i.test(s)) return "You are not signed in. Please sign in and try again.";
  if (/invalid token|invalid jwt/i.test(s)) return "Your session expired. Please sign in again.";

  return s;
}

async function withButtonLoading(btn, busyText, fn) {
  if (!btn) return await fn();
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
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
      setReqStatus("Cart cleared.", "info", 2500);
      renderInventory(LAST_INVENTORY);
    });
  }
  
  if (btnReserveCart) {
  btnReserveCart.addEventListener("click", async () => {
    const old = btnReserveCart.textContent;
    btnReserveCart.disabled = true;
    btnReserveCart.textContent = "Reserving...";
    try {
      await submitReservationCart();
    } catch (e) {
      toast(`Error: ${e?.message || String(e)}`, "error", 5000);
      console.error(e);
    } finally {
      btnReserveCart.disabled = false;
      btnReserveCart.textContent = old;
    }
  });
}

  
}

async function submitReservationCart() {
  // Basic cart checks
  if (!CART.length) {
    toast("Your cart is empty. Select up to 5 items first.", "error", 3000);
    return;
  }

  // De-dup + max 5
  const unique = Array.from(new Set(CART.map((x) => String(x).trim()).filter(Boolean)));
  if (unique.length !== CART.length) {
    toast("Your cart contains duplicate items. Please remove duplicates and try again.", "error", 4000);
    return;
  }
  if (unique.length > 5) {
    toast("Cart limit reached: you can select up to 5 items.", "error", 3500);
    return;
  }

  // Form fields
  const pickupDate = ($("reqDate")?.value || "").trim();       // YYYY-MM-DD
  const pickupTime = ($("reqStart")?.value || "").trim();      // HH:MM (optional)
  const fullName = ($("reqFullName")?.value || "").trim();
  const emoryId = ($("reqEmoryId")?.value || "").trim();
  const phone = ($("reqPhone")?.value || "").trim();

  if (!pickupDate) { toast("Pickup date is required.", "error", 3000); return; }
  if (!fullName) { toast("Full name is required.", "error", 3000); return; }
  if (!emoryId) { toast("Emory ID is required.", "error", 3000); return; }

  // Session
  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !sessData?.session?.access_token) {
    toast("You are not signed in. Please sign in and try again.", "error", 4000);
    return;
  }
  const accessToken = sessData.session.access_token;

  toast("Submitting your reservation...", "info", 1500);

  // Call Edge Function
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-reservation`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${accessToken}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      cart_items: unique,
      full_name: fullName,
      emory_id: emoryId,
      phone: phone,
      pickup_date: pickupDate,
      pickup_time: pickupTime || null,
    }),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const raw = json?.error || json?.message || res.statusText;
    toast(`Reserve failed: ${humanizeReserveError(raw)}`, "error", 6500);
    return;
  }

  const rid = json?.result?.reservation_id ?? "?";
  toast(
    `Reserved successfully.\nReservation ID: ${rid}\nYour items are now held for 48 hours (pending staff review).`,
    "success",
    6000
  );

  // Clear cart +  UI
  clearCart();
  renderInventory(LAST_INVENTORY);
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
      await Ui();
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
    wireInventoryFilters();

    await refreshUi();     // 先把 UI 刷到正确状态
    startIdleLogout();     // 再启动 15 分钟无操作自动登出
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
