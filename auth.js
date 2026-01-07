// ===== Supabase config =====
const SUPABASE_URL = "https://qvyhnnvyyjjnzkmecoga.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_xxxxxxxxxxxxx";

// Create client ONCE
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// ===== Login logic =====
document.getElementById("loginBtn").addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signInWithOtp({
    email: prompt("Enter your Emory email"),
  });

  if (error) {
    alert(error.message);
  } else {
    alert("Check your email for the login link.");
  }
});
