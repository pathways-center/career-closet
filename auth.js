import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { DateTime } from "https://cdn.jsdelivr.net/npm/luxon@3/build/es6/luxon.js";

console.log("[auth.js] loaded on", location.href);

// ====== Supabase config ======
const SUPABASE_URL = "https://qvyhnnvyyjjnzkmecoga.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3x48GzRMEQV1BYVmnrpJWQ_F7GJ5NFP";
const BUCKET = "career-closet"; // your public bucket
const TZ = "America/New_York";  // Atlanta time

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// ====== DOM helpers ======
function $(id) { return document.getElementById(id); }

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg || "";
}

function setSubStatus(msg) {
  const el = $("subStatus");
  if (el) el.textContent = msg || "";
}

function setReqStatus(msg) {
  const el = $("reqStatus");
  if (el) el.textContent = msg || "";
}

function show(el, yes) {
  if (!el) return;
  el.style.display = yes ? "block" : "none";
}

function cleanUrl() {
  const url = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, url);
}

function getRedirectTo() {
  // must be in Supabase Auth -> URL Configuration -> Redirect URLs
  return `${window.location.origin}/career-closet/auth/callback/`;
}

// ====== Auth redirect handler (PKCE code) ======
async function handleAuthRedirect() {
  const code = new URLSearchParams(location.search).get("code");
  if (!code) return;

  setStatus("Signing you in...");
  console.log("[auth] exchanging code for session...");

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  console.log("[auth] exchange result:", { hasSession: !!data?.session, error });

  cleanUrl();
  if (error) throw error;
}

// ====== Inventory rendering ======
function buildPublicImageUrl(image_path) {
  // image_path like: "items/MBzBe1.jpg"
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${image_path}`;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    const title = esc(row.inventory_id);
    const brand = esc(row.brand);
    const color = esc(row.color);
    const size = esc(row.size);
    const fit = esc(row.fit);
    const category = esc(row.category);
    const status = esc(row.status);

    // data-inventory-id 用于点击卡片自动填 request 的 item id
    return `
      <div class="card" data-inventory-id="${title}" style="cursor:pointer;">
        <div class="imgbox">
          ${
            imgUrl
              ? `<img src="${imgUrl}" alt="${title}" loading="lazy"
                   onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=muted>Image not found</div>';">`
              : `<div class="muted">No image</div>`
          }
        </div>

        <div style="margin-top:10px; font-weight:700;">${title}</div>
        <div class="muted" style="margin-top:6px; line-height:1.4;">
          <div><b>Brand:</b> ${brand || "-"}</div>
          <div><b>Color:</b> ${color || "-"}</div>
          <div><b>Size:</b> ${size || "-"}</div>
          <div><b>Fit:</b> ${fit || "-"}</div>
          <div><b>Category:</b> ${category || "-"}</div>
          <div><b>Status:</b> ${status || "-"}</div>
        </div>
      </div>
    `;
  }).join("");

  // 点击卡片 => 自动填 item id
  el.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.getAttribute("data-inventory-id");
      const input = $("reqItemId");
      if (input && id) {
        input.value = id;
        setReqStatus(`Selected item: ${id}`);
        // 滚动到 request 区域（可选）
        const req = $("requestSection");
        if (req) req.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

async function loadInventory() {
  setSubStatus("Loading inventory...");

  const { data, error } = await supabase
    .from("items")
    .select("inventory_id, brand, color, size, fit, category, status, image_path, created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;

  renderInventory(data);
  setSubStatus("");
}

// ====== Request time helpers (Atlanta => UTC) ======
function validateRequestInputs({ itemId, dateStr, startStr, endStr }) {
  if (!itemId) throw new Error("Please enter Item ID (or click a card).");
  if (!dateStr) throw new Error("Please choose a date.");
  if (!startStr) throw new Error("Please choose a start time.");
  if (!endStr) throw new Error("Please choose an end time.");

  const startLocal = DateTime.fromISO(`${dateStr}T${startStr}`, { zone: TZ });
  const endLocal   = DateTime.fromISO(`${dateStr}T${endStr}`,   { zone: TZ });

  if (!startLocal.isValid || !endLocal.isValid) throw new Error("Invalid date/time.");
  if (endLocal <= startLocal) throw new Error("End time must be after start time.");

  const nowLocal = DateTime.now().setZone(TZ);
  if (startLocal < nowLocal.minus({ minutes: 1 })) throw new Error("Start time cannot be in the past.");

  return { startLocal, endLocal };
}

async function submitRequest() {
  const { data: sessData } = await supabase.auth.getSession();
  const session = sessData.session;
  if (!session) throw new Error("Not signed in.");

  const itemId = ($("reqItemId")?.value || "").trim();
  const dateStr = $("reqDate")?.value || "";
  const startStr = $("reqStart")?.value || "";
  const endStr = $("reqEnd")?.value || "";

  const { startLocal, endLocal } = validateRequestInputs({ itemId, dateStr, startStr, endStr });

  const payload = {
    item_inventory_id: itemId,
    requester_email: session.user.email,
    start_at: startLocal.toUTC().toISO(),
    end_at: endLocal.toUTC().toISO(),
    timezone: TZ,
    status: "pending",
  };

  const { error } = await supabase.from("requests").insert(payload);
  if (error) throw error;

  setReqStatus(
    `Request submitted ✅\n` +
    `Item: ${itemId}\n` +
    `Time (Atlanta): ${startLocal.toFormat("yyyy-LL-dd HH:mm")} - ${endLocal.toFormat("HH:mm")}\n` +
    `Stored (UTC): ${payload.start_at} - ${payload.end_at}`
  );
}

function wireRequestEvents() {
  const btn = $("btnSubmitRequest");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    try {
      btn.disabled = true;
      setReqStatus("Submitting...");
      await submitRequest();
    } catch (e) {
      setReqStatus(`Error: ${e?.message || String(e)}`);
      console.error(e);
    } finally {
      btn.disabled = false;
    }
  });

  // 初始化默认日期：今天（Atlanta）
  const dateInput = $("reqDate");
  if (dateInput && !dateInput.value) {
    const today = DateTime.now().setZone(TZ).toFormat("yyyy-LL-dd");
    dateInput.value = today;
  }
}

// ====== UI wiring ======
function wireUiEvents() {
  const elEmail = $("email");
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");

  if (btnLogin && elEmail) {
    btnLogin.addEventListener("click", async () => {
      try {
        const email = (elEmail.value || "").trim().toLowerCase();
        if (!email) {
          setStatus("Please enter an email.");
          return;
        }

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
      await supabase.auth.signOut();
      await refreshUi();
    });
  }
}

async function refreshUi() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  const signedOutHint = $("signedOutHint");
  const signedInArea = $("signedInArea");
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");
  const elEmail = $("email");

  const requestSection = $("requestSection");

  if (!session) {
    setStatus("Signed out");
    show(signedOutHint, true);
    show(signedInArea, false);
    show(requestSection, false);

    if (btnLogin) btnLogin.disabled = false;
    if (btnLogout) btnLogout.disabled = true;
    if (elEmail) elEmail.disabled = false;

    // 未登录不显示库存（你也可以显示一个提示）
    const inv = $("inventory");
    if (inv) inv.innerHTML = `<div class="muted">Please sign in to view inventory.</div>`;
    setSubStatus("");

    return;
  }

  const email = session.user?.email || "(unknown)";
  setStatus(`Signed in as: ${email}`);

  show(signedOutHint, false);
  show(signedInArea, true);
  show(requestSection, true);

  if (btnLogin) btnLogin.disabled = true;
  if (btnLogout) btnLogout.disabled = false;
  if (elEmail) elEmail.disabled = true;

  await loadInventory();
}

// ====== keep UI synced ======
supabase.auth.onAuthStateChange(async () => {
  await refreshUi();
});

document.addEventListener("DOMContentLoaded", async () => {
  try {
    wireUiEvents();
    wireRequestEvents();
    await handleAuthRedirect();
    await refreshUi();

    // If user is on callback page, send back to home after session established
    if (window.location.pathname.endsWith("/auth/callback/")) {
      window.location.replace("/career-closet/");
    }
  } catch (e) {
    setStatus(`Error: ${e?.message || String(e)}`);
    console.error(e);
  }
});
