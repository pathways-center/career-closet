import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

console.log("[auth.js] loaded on", location.href);

const SUPABASE_URL = "https://qvyhnnvyyjjnzkmecoga.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3x48GzRMEQV1BYVmnrpJWQ_F7GJ5NFP";
const BUCKET = "career-closet";

const BASE_URL = new URL(".", import.meta.url).href;
const IS_CALLBACK_PAGE = window.location.pathname.includes("/auth/callback/");

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
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

function cleanUrl() {
  const url = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, url);
}

function getRedirectTo() {
  return `${BASE_URL}auth/callback/`;
}

async function handleAuthRedirect() {
  const hash = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  const access_token = hash.get("access_token");
  const refresh_token = hash.get("refresh_token");
  const err = hash.get("error_description") || hash.get("error");

  if (err) {
    setStatus(`Auth error: ${err}`);
    cleanUrl();
    return false;
  }

  if (access_token && refresh_token) {
    setStatus("Signing you in...");
    setSubStatus("Setting session from hash tokens...");

    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    console.log("[auth] setSession from hash:", { ok: !error, error });

    cleanUrl();
    if (error) throw error;
    return true;
  }

  const code = new URLSearchParams(location.search).get("code");
  if (code) {
    setStatus("Signing you in...");
    setSubStatus("Exchanging code for session...");

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    console.log("[auth] exchangeCodeForSession:", { hasSession: !!data?.session, error });

    cleanUrl();
    if (error) throw error;
    return true;
  }

  return false;
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
  const whoamiHint = $("whoamiHint");

  if (!session) {
    setStatus("Signed out");
    setSubStatus("");

    if (signedOutHint) signedOutHint.style.display = "block";
    if (signedInArea) signedInArea.style.display = "none";
    return;
  }

  const email = session.user?.email || "(unknown)";
  setStatus(`Signed in as: ${email}`);
  setSubStatus("");
  if (whoamiHint) whoamiHint.textContent = email;

  if (signedOutHint) signedOutHint.style.display = "none";
  if (signedInArea) signedInArea.style.display = "block";

  if (!IS_CALLBACK_PAGE) {
    await loadInventory();
  }
}

supabase.auth.onAuthStateChange(async () => {
  await refreshUi();
});

document.addEventListener("DOMContentLoaded", async () => {
  try {
    wireAuthEvents();
    wireRequestEvents();
    wireInventorySearch();

    const established = await handleAuthRedirect();

    if (IS_CALLBACK_PAGE && established) {
      window.location.replace(BASE_URL);
      return;
    }

    await refreshUi();
  } catch (e) {
    setStatus(`Error: ${e?.message || String(e)}`);
    console.error(e);
  }
});
