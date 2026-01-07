// DO NOT redeclare this anywhere else
const supabaseClient = supabase.createClient(
  'https://qvyhnnvyyjjnzkmecoga.supabase.co',
  'sb_publishable_3x48GzRMEQV1BYVmnrpJWQ_F7GJ5NFP'
)

const loginBtn = document.getElementById('login-btn')

loginBtn.addEventListener('click', async () => {
  const email = prompt('Enter your Emory email')

  if (!email) return

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: 'https://pathways-center.github.io/career-closet/'
    }
  })

  if (error) {
    alert(error.message)
  } else {
    alert('Check your email for the login link')
  }
})
