import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
console.log("[auth.js] loaded on", location.href);

const SUPABASE_URL = "https://qvyhnnvyyjjnzkmecoga.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3x48GzRMEQV1BYVmnrpJWQ_F7GJ5NFP";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
  },
});

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg) {
  const elStatus = $("status");
  if (elStatus) elStatus.textContent = msg;
  console.log("[status]", msg);
}

function getRedirectTo() {
  // GitHub Pages project site: keep /career-closet/ prefix
  return `${window.location.origin}/career-closet/auth/callback/`;
}

function cleanUrl() {
  // remove query/hash after we consumed it
  const url = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, url);
}

async function handleAuthRedirect() {
  console.log("[auth] search=", location.search, "hash=", location.hash);

  // A) PKCE code flow: /callback/?code=...
  const code = new URLSearchParams(location.search).get("code");
  if (code) {
    setStatus("Signing you in (code)...");
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    console.log("[auth] exchangeCodeForSession:", { hasSession: !!data?.session, error });
    cleanUrl();
    if (error) throw error;
    return;
  }

  // B) Implicit hash flow fallback: /callback/#access_token=...&refresh_token=...
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const access_token = hash.get("access_token");
  const refresh_token = hash.get("refresh_token");

  if (access_token && refresh_token) {
    setStatus("Signing you in (token)...");
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    console.log("[auth] setSession:", { error });
    cleanUrl();
    if (error) throw error;
  }
}

async function refreshUi() {
  const { data, error } = await supabase.auth.getSession();
  if (error) console.warn("[auth] getSession error:", error);

  const session = data?.session;

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
        setStatus("Sending magic link...");

        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo },
        });

        if (error) throw error;
        setStatus(`Magic link sent to: ${email}\nRedirect: ${redirectTo}`);
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

    await handleAuthRedirect();

    // Confirm session is present before redirecting away from callback page
    const { data } = await supabase.auth.getSession();
    await refreshUi();

    if (location.pathname.includes("/auth/callback") && data?.session) {
      // Always go back to app home after successful callback
      location.replace("/career-closet/");
    }
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e?.message || String(e)}`);
  }
});
