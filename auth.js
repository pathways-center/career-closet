
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://qvyhnnvyyjjnzkmecoga.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3x48GzRMEQV1BYVmnrpJWQ_F7GJ5NFP";

const REDIRECT_TO = "https://pathways-center.github.io/career-closet/";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function log(msg) {
  statusEl.textContent = String(msg);
}

async function refreshUI() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  $("btnLogout").style.display = session ? "inline-block" : "none";
  log(session ? `Logged in as: ${session.user.email}` : "Not logged in");
}

async function exchangeIfNeeded() {
  const url = new URL(window.location.href);

  // Newer flow: ?code=...
  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) log(`exchangeCodeForSession error: ${error.message}`);
    url.searchParams.delete("code");
    window.history.replaceState({}, document.title, url.toString());
    return;
  }

  // Older flow: #access_token=...
  const hash = window.location.hash;
  if (hash && hash.includes("access_token=")) {
    const { data, error } = await supabase.auth.getSession();
    if (error) log(`getSession error: ${error.message}`);
    if (data?.session) {
      window.history.replaceState({}, document.title, REDIRECT_TO);
    }
  }

  // If your page shows: #error=access_denied&error_code=otp_expired...
  if (hash && hash.includes("error=")) {
    log(`Auth callback error: ${hash.substring(1)}`);
  }
}

$("btnLogin").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!email) {
    alert("Enter your email first.");
    return;
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: REDIRECT_TO },
  });

  if (error) {
    log(`signInWithOtp error: ${error.message}`);
  } else {
    log("Magic link sent. Check your inbox.");
  }
});

$("btnSendLink").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!email) {
    alert("Enter your email first.");
    return;
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: REDIRECT_TO },
  });

  if (error) {
    log(`signInWithOtp error: ${error.message}`);
  } else {
    log("Magic link sent. Check your inbox.");
  }
});

$("btnLogout").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();
  if (error) log(`signOut error: ${error.message}`);
  await refreshUI();
});

await exchangeIfNeeded();
await refreshUI();

supabase.auth.onAuthStateChange(async () => {
  await refreshUI();
});
