import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://qvyhnnvyyjjnzkmecoga.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3x48GzRMEQV1BYVmnrpJWQ_F7GJ5NFP";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const elEmail = document.getElementById("email");
const btnLogin = document.getElementById("btnLogin");
const btnLogout = document.getElementById("btnLogout");
const elStatus = document.getElementById("status");

function setStatus(msg) {
  elStatus.textContent = msg;
}

function getRedirectTo() {
  // Keeps "/career-closet/" path on GitHub Pages
  return window.location.origin + window.location.pathname;
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

  // Implicit flow fallback: redirects back with #access_token=...
  if (window.location.hash && window.location.hash.includes("access_token=")) {
    const { error } = await supabase.auth.getSessionFromUrl({ storeSession: true });
    cleanUrl();
    if (error) throw error;
  }
}

async function refreshUi() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  if (!session) {
    setStatus("Signed out");
    return;
  }

  const email = session.user?.email || "(unknown)";
  setStatus(`Signed in as: ${email}`);
}

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

btnLogout.addEventListener("click", async () => {
  await supabase.auth.signOut();
  await refreshUi();
});

supabase.auth.onAuthStateChange(async () => {
  await refreshUi();
});

(async () => {
  try {
    await handleAuthRedirect();
    await refreshUi();
  } catch (e) {
    setStatus(`Error: ${e?.message || String(e)}`);
  }
})();
