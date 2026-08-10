import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

function getConfigError() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return (
      "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "On Vercel: Project → Settings → Environment Variables → add both, then Redeploy."
    );
  }
  try {
    new URL(supabaseUrl);
  } catch {
    return `Invalid VITE_SUPABASE_URL: "${supabaseUrl}". It should look like https://xxxx.supabase.co`;
  }
  return null;
}

export const supabaseConfigError = getConfigError();

// The anon key is safe to expose in the browser — it's designed for that.
// Row Level Security policies (see supabase/schema.sql) are what actually
// keep one user's data away from another, not this key.
export const supabase = supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabaseAnonKey);
