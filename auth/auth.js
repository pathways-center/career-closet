import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

console.log("[auth.js] loaded:", location.href);
console.log("[auth.js] MODE=MAGIC_LINK_IMPLICIT", "VERSION=20260107_implicit_final_1");

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

function cleanUrlRemoveQueryAndHash() {
  const url = location.origin + location.pathname;
  history.replaceState({}, document.title, url);
}

/**
 * Handle Supabase Email Magic Link implicit flow:
 * callback URL looks like:
 *   /auth/callback/#access_token=...&refresh_token=...&expires_in=...&token_type=bearer&type=magiclink
 *
 * We must parse hash, call supabase.auth.setSession(), then remove hash.
 */
async function handleMagicLinkHash() {
  const hashStr = location.hash || "";
  console.log("[auth] search=", location.search, "hash=", hashStr ? "(present)" : "(none)");

  if (!hashStr || !hashStr.includes("access_token=")) return false;

  const hash = new URLSearchParams(hashStr.replace(/^#/, ""));
  const access_token = hash.get("access_token");
  const refresh_token = hash.get("refresh_token");

  if (!access_token || !refresh_token) {
    throw new Error("Magic link missing access_token or refresh_token in URL hash.");
  }

  setStatus("Signing you in...");

  const { data, error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });

  console.log("[auth] setSession:", { hasSession: !!data?.session, error });
  cleanUrlRemoveQueryAndHash();

  if (error) throw error;
  return true;
}

async function refreshUi() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");
  const elEmail = $("email");
  if (!session) {
    setStatus("Signed out");
    setGate(false); 
    if (btnLogin) btnLogin.disabled = false;
    if (btnLogout) btnLogout.disabled = true;
    if (elEmail) elEmail.disabled = false;
    return;
  }
  const email = session.user?.email || "(unknown)";
  setStatus(`Signed in as: ${email}`);
  setGate(true); 
  if (btnLogin) btnLogin.disabled = true;
  if (btnLogout) btnLogout.disabled = false;
  if (elEmail) elEmail.disabled = true;
}


function setGate(isAuthed) {
  const publicView = document.getElementById("publicView");
  const appView = document.getElementById("appView");

  if (publicView) publicView.style.display = isAuthed ? "none" : "block";
  if (appView) appView.style.display = isAuthed ? "block" : "none";
}


function getEmailRedirectTo() {
  // Always send email back to callback page
  return `${location.origin}/career-closet/auth/callback/`;
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

        const emailRedirectTo = getEmailRedirectTo();
        setStatus("Sending magic link...");

        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo,
            shouldCreateUser: true,
          },
        });

        if (error) throw error;

        setStatus(`Magic link sent to: ${email}\nOpen the email and click "Log In".`);
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

supabase.auth.onAuthStateChange((event) => {
  console.log("[auth] onAuthStateChange:", event);
  // 不 await，避免循环刷新卡 UI
  refreshUi();
});

document.addEventListener("DOMContentLoaded", async () => {
  try {
    wireUiEvents();

    // 1) If on callback with hash tokens, set session
    const handled = await handleMagicLinkHash();

    // 2) Update UI
    await refreshUi();

    // 3) If we are on callback page and login succeeded -> redirect home
    if (handled && location.pathname.endsWith("/career-closet/auth/callback/")) {
      setStatus("Signed in. Redirecting...");
      location.replace("/career-closet/");
    }
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e?.message || String(e)}`);
  }
});
