import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS, used only in the admin upload panel.
// Requires VITE_SUPABASE_SERVICE_KEY in .env.local (local) or
// Vercel → Settings → Environment Variables (deployed).
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_SERVICE_KEY

if (!key) {
  console.warn(
    '[supabaseAdmin] VITE_SUPABASE_SERVICE_KEY is not set. ' +
    'Data import will not work until this variable is added to your environment.'
  )
}

const supabaseAdmin = (url && key)
  ? createClient(url, key)
  : null   // AdminPage checks for null and shows a friendly message

export default supabaseAdmin
