console.log("[auth.js] loaded on", location.href);
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://qvyhnnvyyjjnzkmecoga.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3x48GzRMEQV1BYVmnrpJWQ_F7GJ5NFP";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg) {
  const elStatus = $("status");
  if (elStatus) elStatus.textContent = msg;
}

function getRedirectTo() {
  return `${window.location.origin}/career-closet/auth/callback/`;
}

function cleanUrl() {
  const url = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, url);
}

async function handleAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");

  // PKCE flow: magic link redirects back with ?code=...
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    cleanUrl();
    if (error) throw error;
    return;
  }

  // Implicit flow fallback
  if (window.location.hash && window.location.hash.includes("access_token=")) {
    const { error } = await supabase.auth.getSessionFromUrl({ storeSession: true });
    cleanUrl();
    if (error) throw error;
  }
}

async function refreshUi() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");
  const elEmail = $("email");

  if (!session) {
    setStatus("Signed out");
    if (btnLogin) btnLogin.disabled = false;
    if (btnLogout) btnLogout.disabled = true;
    if (elEmail) elEmail.disabled = false;
    return;
  }

  const email = session.user?.email || "(unknown)";
  setStatus(`Signed in as: ${email}`);

  if (btnLogin) btnLogin.disabled = true;
  if (btnLogout) btnLogout.disabled = false;
  if (elEmail) elEmail.disabled = true;
}

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
          options: { emailRedirectTo: redirectTo }
        });

        if (error) throw error;

        setStatus(`Magic link sent to: ${email}\nRedirect: ${redirectTo}`);
      } catch (e) {
        setStatus(`Error: ${e?.message || String(e)}`);
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

supabase.auth.onAuthStateChange(async () => {
  await refreshUi();
});

document.addEventListener("DOMContentLoaded", async () => {
  try {
    wireUiEvents();
    await handleAuthRedirect();
    await refreshUi();

    if (window.location.pathname.endsWith("/auth/callback/")) {
      window.location.replace("/career-closet/");
    }
  } catch (e) {
    setStatus(`Error: ${e?.message || String(e)}`);
  }
});
