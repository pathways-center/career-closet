import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";


const SUPABASE_URL = "https://qvyhnnvyyjjnzkmecoga.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3x48GzRMEQV1BYVmnrpJWQ_F7GJ5NFP";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const PAGE_SIZE = 12;

function $(id) { return document.getElementById(id); }

function setGate(isAuthed) {
  const authPanel = $("authPanel");
  const appShell = $("appShell");
  if (authPanel) authPanel.style.display = isAuthed ? "none" : "block";
  if (appShell) appShell.style.display = isAuthed ? "block" : "none";
}

function fmt(v) { return (v ?? "").toString().trim(); }

let state = {
  page: 0,
  total: null,
  items: [],
  selectedItem: null,
};

function getFilters() {
  return {
    q: fmt($("q")?.value).toLowerCase(),
    gender: fmt($("fGender")?.value),
    status: fmt($("fStatus")?.value),
  };
}

function storagePublicUrl(path) {
  const BUCKET = "career-closet";
  if (!path) return "";
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl || "";
}

function renderItems(items) {
  const el = $("inventoryList");
  if (!el) return;
  if (!items?.length) {
    el.innerHTML = `<div class="muted">No items found.</div>`;
    return;
  }

  el.innerHTML = items.map((it) => {
    const imgUrl = storagePublicUrl(it.image_path);
    const title = fmt(it.inventory_id) || "(no inventory id)";
    const brand = fmt(it.brand);
    const color = fmt(it.color);
    const size = fmt(it.size);
    const gender = fmt(it.gender);
    const status = fmt(it.status);

    return `
      <div class="card" data-item-id="${it.id}">
        <img src="${imgUrl}" alt="" onerror="this.style.display='none'" />
        <div style="margin-top:8px; font-weight:600;">${title}</div>
        <div style="margin-top:6px;">
          ${gender ? `<span class="pill">${gender}</span>` : ""}
          ${size ? `<span class="pill">Size ${size}</span>` : ""}
          ${status ? `<span class="pill">${status}</span>` : ""}
        </div>
        <div class="muted" style="margin-top:6px;">
          ${[brand, color].filter(Boolean).join(" • ") || ""}
        </div>
        <button style="margin-top:10px;" type="button" ${status !== "available" ? "disabled" : ""}>
          Request
        </button>
      </div>
    `;
  }).join("");

  // click handler
  el.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", async (e) => {
      const id = card.getAttribute("data-item-id");
      const item = items.find(x => x.id === id);
      if (!item) return;

      // 只允许 available 才能申请
      if (fmt(item.status) !== "available") return;

      openRequestDialog(item);
    });
  });
}

function setPageInfo() {
  const el = $("pageInfo");
  if (!el) return;

  const page = state.page;
  const total = state.total;
  const start = page * PAGE_SIZE + 1;
  const end = page * PAGE_SIZE + (state.items?.length || 0);

  if (total == null) {
    el.textContent = `Showing ${start}-${end}`;
  } else {
    el.textContent = `Showing ${start}-${end} of ${total}`;
  }

  const btnPrev = $("btnPrev");
  const btnNext = $("btnNext");
  if (btnPrev) btnPrev.disabled = page <= 0;
  if (btnNext) btnNext.disabled = total != null ? (end >= total) : false;
}

async function loadInventory() {
  const { q, gender, status } = getFilters();
  $("subStatus").textContent = "Loading inventory...";

  // count + data
  let query = supabase.from("items").select("*", { count: "exact" });

  if (status) query = query.eq("status", status);
  if (gender) query = query.eq("gender", gender);

  if (q) {
    // 搜索：inventory_id / brand / color / size
    const esc = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
    query = query.or(
      [
        `inventory_id.ilike.%${esc}%`,
        `brand.ilike.%${esc}%`,
        `color.ilike.%${esc}%`,
        `size.ilike.%${esc}%`,
      ].join(",")
    );
  }

  const from = state.page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, count, error } = await query.order("inventory_id", { ascending: true }).range(from, to);

  if (error) {
    $("subStatus").textContent = `Error loading inventory: ${error.message}`;
    renderItems([]);
    return;
  }

  state.items = data || [];
  state.total = count ?? null;

  $("subStatus").textContent = "";
  renderItems(state.items);
  setPageInfo();
}

function openRequestDialog(item) {
  state.selectedItem = item;

  const dlg = $("dlgRequest");
  const meta = $("reqItemMeta");
  const reqStatus = $("reqStatus");
  if (reqStatus) reqStatus.textContent = "";

  if (meta) {
    meta.textContent = `Item: ${item.inventory_id} • ${[item.gender, item.size, item.brand, item.color].filter(Boolean).join(" • ")}`;
  }

  // 给默认日期/时间
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth()+1).padStart(2,"0");
  const dd = String(today.getDate()).padStart(2,"0");

  if ($("reqDate")) $("reqDate").value = `${yyyy}-${mm}-${dd}`;
  if ($("reqStart")) $("reqStart").value = "10:00";
  if ($("reqEnd")) $("reqEnd").value = "10:30";

  dlg?.showModal();
}

function closeRequestDialog() {
  $("dlgRequest")?.close();
}

function parseDateTime(dateStr, timeStr) {
  // 以本地时间组合，再转成 ISO
  const [y,m,d] = dateStr.split("-").map(Number);
  const [hh,mi] = timeStr.split(":").map(Number);
  const dt = new Date(y, m-1, d, hh, mi, 0, 0);
  return dt.toISOString();
}

async function submitRequest() {
  const item = state.selectedItem;
  if (!item) throw new Error("No item selected.");

  const dateStr = fmt($("reqDate")?.value);
  const startStr = fmt($("reqStart")?.value);
  const endStr = fmt($("reqEnd")?.value);

  if (!dateStr || !startStr || !endStr) throw new Error("Please select date and time.");

  const startISO = parseDateTime(dateStr, startStr);
  const endISO = parseDateTime(dateStr, endStr);

  // 基本校验：end > start
  if (new Date(endISO).getTime() <= new Date(startISO).getTime()) {
    throw new Error("End time must be after start time.");
  }

  const { data: sessData } = await supabase.auth.getSession();
  const session = sessData?.session;
  if (!session) throw new Error("Not signed in.");

  const payload = {
    user_id: session.user.id,
    user_email: session.user.email,
    item_id: item.id,
    requested_start: startISO,
    requested_end: endISO,
    status: "pending",
  };

  const { error } = await supabase.from("requests").insert(payload);
  if (error) throw error;

  return payload;
}

async function boot() {
  // gate by session
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  setGate(!!session);

  if (!session) return;

  $("hello").textContent = `Signed in as: ${session.user.email}`;

  // wire events
  $("btnLogout")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    setGate(false);
    location.reload();
  });

  $("btnSearch")?.addEventListener("click", async () => {
    state.page = 0;
    await loadInventory();
  });

  $("btnReset")?.addEventListener("click", async () => {
    if ($("q")) $("q").value = "";
    if ($("fGender")) $("fGender").value = "";
    if ($("fStatus")) $("fStatus").value = "available";
    state.page = 0;
    await loadInventory();
  });

  $("btnPrev")?.addEventListener("click", async () => {
    state.page = Math.max(0, state.page - 1);
    await loadInventory();
  });

  $("btnNext")?.addEventListener("click", async () => {
    state.page += 1;
    await loadInventory();
  });

  $("btnCancelDlg")?.addEventListener("click", () => closeRequestDialog());

  $("requestForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const reqStatus = $("reqStatus");
    const btn = $("btnSubmitReq");
    try {
      if (btn) btn.disabled = true;
      if (reqStatus) reqStatus.textContent = "Submitting request...";
      await submitRequest();
      if (reqStatus) reqStatus.textContent = "✅ Request submitted (pending). Staff will review it.";
      // 提交后关弹窗也行：closeRequestDialog();
    } catch (err) {
      if (reqStatus) reqStatus.textContent = `Error: ${err?.message || String(err)}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // initial load
  await loadInventory();
}

document.addEventListener("DOMContentLoaded", boot);
