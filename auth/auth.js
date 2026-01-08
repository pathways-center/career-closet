import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

console.log("[auth.js] loaded on", location.href);

// ====== Supabase config ======
const SUPABASE_URL = "https://qvyhnnvyyjjnzkmecoga.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3x48GzRMEQV1BYVmnrpJWQ_F7GJ5NFP";
const BUCKET = "career-closet"; // your public bucket

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
  if (el) el.textContent = msg;
}

function setSubStatus(msg) {
  const el = $("subStatus");
  if (el) el.textContent = msg || "";
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

    return `
      <div class="card">
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

  if (!session) {
    setStatus("Signed out");
    if (signedOutHint) signedOutHint.style.display = "block";
    if (signedInArea) signedInArea.style.display = "none";

    if (btnLogin) btnLogin.disabled = false;
    if (btnLogout) btnLogout.disabled = true;
    if (elEmail) elEmail.disabled = false;

    return;
  }

  const email = session.user?.email || "(unknown)";
  setStatus(`Signed in as: ${email}`);
  if (signedOutHint) signedOutHint.style.display = "none";
  if (signedInArea) signedInArea.style.display = "block";

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
