import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Check your .env file."
  );
}

// The anon key is safe to expose in the browser — it's designed for that.
// Row Level Security policies (see supabase/schema.sql) are what actually
// keep one user's data away from another, not this key.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
