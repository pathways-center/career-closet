import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

console.log("[auth.js] loaded on", location.href);
console.log("[auth.js] MODE = OTP_CODE_LOGIN", "VERSION=2026-01-07-otp-1");

const SUPABASE_URL = "https://qvyhnnvyyjjnzkmecoga.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3x48GzRMEQV1BYVmnrpJWQ_F7GJ5NFP";

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
  if (el) el.textContent = msg;
  console.log("[status]", msg);
}

function normalizeEmail(v) {
  return (v || "").trim().toLowerCase();
}

function normalizeOtp(v) {
  return (v || "").trim().replace(/\s+/g, "");
}

async function refreshUi() {
  const { data, error } = await supabase.auth.getSession();
  if (error) console.warn("[getSession error]", error);

  const session = data?.session;

  const elEmail = $("email");
  const elOtp = $("otp");

  const btnSendCode = $("btnSendCode");
  const btnVerify = $("btnVerify");
  const btnLogout = $("btnLogout");

  if (!session) {
    setStatus("Signed out");
    if (elEmail) elEmail.disabled = false;
    if (elOtp) elOtp.disabled = false;
    if (btnSendCode) btnSendCode.disabled = false;
    if (btnVerify) btnVerify.disabled = false;
    if (btnLogout) btnLogout.disabled = true;
    return;
  }

  const email = session.user?.email || "(unknown)";
  setStatus(`Signed in as: ${email}`);

  if (elEmail) elEmail.disabled = true;
  if (elOtp) elOtp.disabled = true;
  if (btnSendCode) btnSendCode.disabled = true;
  if (btnVerify) btnVerify.disabled = true;
  if (btnLogout) btnLogout.disabled = false;
}

function wireUiEvents() {
  const elEmail = $("email");
  const elOtp = $("otp");
  const btnSendCode = $("btnSendCode");
  const btnVerify = $("btnVerify");
  const btnLogout = $("btnLogout");

  if (btnSendCode && elEmail) {
    btnSendCode.addEventListener("click", async () => {
      try {
        const email = normalizeEmail(elEmail.value);
        if (!email) {
          setStatus("Please enter an email.");
          return;
        }

        setStatus("Sending 6-digit code to your email...");

        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: true, 
          },
        });

        if (error) throw error;

        setStatus(`Code sent to: ${email}\nCheck inbox/spam, then enter the 6-digit code below.`);
        if (elOtp) elOtp.focus();
      } catch (e) {
        console.error(e);
        setStatus(`Error: ${e?.message || String(e)}`);
      }
    });
  }

  if (btnVerify && elEmail && elOtp) {
    btnVerify.addEventListener("click", async () => {
      try {
        const email = normalizeEmail(elEmail.value);
        const token = normalizeOtp(elOtp.value);

        if (!email) {
          setStatus("Please enter an email.");
          return;
        }
        if (!token) {
          setStatus("Please enter the 6-digit code from your email.");
          return;
        }

        setStatus("Verifying code...");

        const { data, error } = await supabase.auth.verifyOtp({
          email,
          token,
          type: "email",
        });

        if (error) throw error;

        setStatus(`Signed in as: ${data?.user?.email || email}`);
        await refreshUi();
      } catch (e) {
        console.error(e);
        setStatus(`Error: ${e?.message || String(e)}`);
      }
    });
  }

  if (elOtp && btnVerify) {
    elOtp.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") btnVerify.click();
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      try {
        await supabase.auth.signOut();
        if ($("otp")) $("otp").value = "";
        await refreshUi();
      } catch (e) {
        console.error(e);
        setStatus(`Error: ${e?.message || String(e)}`);
      }
    });
  }
}

supabase.auth.onAuthStateChange(async (event) => {
  console.log("[auth] onAuthStateChange:", event);
  await refreshUi();
});

document.addEventListener("DOMContentLoaded", async () => {
  try {
    wireUiEvents();
    await refreshUi();
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e?.message || String(e)}`);
  }
});
