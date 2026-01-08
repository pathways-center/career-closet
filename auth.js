import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://qvyhnnvyyjjnzkmecoga.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3x48GzRMEQV1BYVmnrpJWQ_F7GJ5NFP";
const BUCKET = "career-closet";

const BASE_URL = new URL(".", import.meta.url).href;
const IS_CALLBACK_PAGE = window.location.pathname.includes("/auth/callback/");
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

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

function $(id) {
  return document.getElementById(id);
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

function getRedirectTo() {
  return `${BASE_URL}auth/callback/`;
}

function getStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
    localStorage.removeItem(STORAGE_KEY);
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
  if (err) {
    return { ok: false, error: `Auth error: ${err}` };
  }

  if (!access_token) {
    return { ok: false, error: "No access_token found in URL hash." };
  }

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (e) {
    return { ok: false, error: `Failed to write session to localStorage: ${e?.message || String(e)}` };
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
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const detail =
        (json && (json.message || json.error_description || json.error)) || text || res.statusText;
      throw new Error(`HTTP ${res.status}: ${detail}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function loadInventoryViaRest(accessToken) {
  setSubStatus("Loading inventory...");

  const select =
    "inventory_id,brand,color,size,fit,category,status,image_path,created_at";
  const url =
    `${SUPABASE_URL}/rest/v1/items` +
    `?select=${encodeURIComponent(select)}` +
    `&order=${encodeURIComponent("created_at.desc")}`;

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Accept: "application/json",
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const data = await fetchJson(url, { headers, timeoutMs: 12000 });
  renderInventory(Array.isArray(data) ? data : []);
  setSubStatus("");
}

function renderInventory(items) {
  const el = $("inventory");
  if (!el) return;

  if (!items || items.length === 0) {
    el.innerHTML = `<div class="muted">No items found.</div>`;
    return;
  }

  el.innerHTML = items
    .map((row) => {
      const imgUrl = row.image_path ? buildPublicImageUrl(row.image_path) : "";
      const title = esc(row.inventory_id);

      return `
      <div class="item-card" data-inventory-id="${title}">
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
      </div>
    `;
    })
    .join("");

  el.querySelectorAll(".item-img").forEach((img) => {
    img.addEventListener(
      "error",
      () => {
        img.style.display = "none";
        const fallback = img.parentElement?.querySelector(".img-fallback");
        if (fallback) fallback.style.display = "block";
      },
      { once: true }
    );
  });

  el.querySelectorAll(".item-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.getAttribute("data-inventory-id") || "";
      const reqItemId = $("reqItemId");
      const reqStatus = $("reqStatus");
      if (reqItemId) reqItemId.value = id;
      if (reqStatus) reqStatus.textContent = `Selected item: ${id}`;
      const sec = $("requestSection");
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

function wireRequestEvents() {
  const btn = $("btnSubmitRequest");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const itemId = ($("reqItemId")?.value || "").trim();
    const date = ($("reqDate")?.value || "").trim();
    const start = ($("reqStart")?.value || "").trim();
    const end = ($("reqEnd")?.value || "").trim();
    const out = $("reqStatus");
    if (!out) return;

    if (!itemId) {
      out.textContent = "Please select an item.";
      return;
    }
    if (!date || !start || !end) {
      out.textContent = "Please pick Date + Start + End.";
      return;
    }

    const startIso = `${date}T${start}:00`;
    const endIso = `${date}T${end}:00`;
    const d1 = new Date(startIso);
    const d2 = new Date(endIso);
    if (!(d2 > d1)) {
      out.textContent = "End time must be after Start time.";
      return;
    }

    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    out.textContent =
      `Request preview (Atlanta time)\n` +
      `Item: ${itemId}\n` +
      `Start: ${fmt.format(d1)}\n` +
      `End:   ${fmt.format(d2)}\n`;
  });
}

function wireAuthEvents() {
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
      clearStoredSession();
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
    setStatus("Signed out");
    setSubStatus("");

    if (signedOutHint) signedOutHint.style.display = "block";
    if (signedInArea) signedInArea.style.display = "none";
    return;
  }

  setStatus("Signed in");
  setSubStatus("");

  if (whoamiHint) whoamiHint.textContent = "Authenticated";
  if (signedOutHint) signedOutHint.style.display = "none";
  if (signedInArea) signedInArea.style.display = "block";

  await loadInventoryViaRest(session.access_token);
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

document.addEventListener("DOMContentLoaded", async () => {
  try {
    if (IS_CALLBACK_PAGE) {
      await handleCallbackPage();
      return;
    }

    wireAuthEvents();
    wireRequestEvents();
    wireInventorySearch();

    await refreshUi();
  } catch (e) {
    setStatus(`Error: ${e?.message || String(e)}`);
    setSubStatus("");
    console.error(e);
  }
});
