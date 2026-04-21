import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS, used only in the admin upload panel.
// This key is in .env.local (gitignored) and never shipped to production builds.
const supabaseAdmin = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_SERVICE_KEY,
)

export default supabaseAdmin
