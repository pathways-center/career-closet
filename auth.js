import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
console.log("[auth.js] loaded on", location.href);

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

async function refreshUi() {
  const { data, error } = await supabase.auth.getSession();
  if (error) console.warn("[getSession error]", error);

  const session = data?.session;

  const btnSendCode = $("btnSendCode");
  const btnVerify = $("btnVerify");
  const btnLogout = $("btnLogout");
  const elEmail = $("email");
  const elOtp = $("otp");

  if (!session) {
    setStatus("Signed out");
    if (btnSendCode) btnSendCode.disabled = false;
    if (btnVerify) btnVerify.disabled = false;
    if (btnLogout) btnLogout.disabled = true;
    if (elEmail) elEmail.disabled = false;
    if (elOtp) elOtp.disabled = false;
    return;
  }

  const email = session.user?.email || "(unknown)";
  setStatus(`Signed in as: ${email}`);

  if (btnSendCode) btnSendCode.disabled = true;
  if (btnVerify) btnVerify.disabled = true;
  if (btnLogout) btnLogout.disabled = false;
  if (elEmail) elEmail.disabled = true;
  if (elOtp) elOtp.disabled = true;
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
        const email = (elEmail.value || "").trim().toLowerCase();
        if (!email) {
          setStatus("Please enter an email.");
          return;
        }

        setStatus("Sending verification code...");

        // 发送 6 位验证码（Email OTP）
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            // 关键：不要用 magic link 回跳；我们用 code 手动验证
            shouldCreateUser: true,
          },
        });

        if (error) throw error;

        setStatus(`Code sent to: ${email}\nCheck your inbox (and spam).`);
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
        const email = (elEmail.value || "").trim().toLowerCase();
        const token = (elOtp.value || "").trim().replace(/\s+/g, "");

        if (!email) {
          setStatus("Please enter an email.");
          return;
        }
        if (!token) {
          setStatus("Please enter the 6-digit code from your email.");
          return;
        }

        setStatus("Verifying code...");

        // 验证码登录（落地 session）
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

  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      try {
        await supabase.auth.signOut();
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
