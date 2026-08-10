import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL?.trim();
const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

const serverAuthOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

export function getServerSupabaseConfigError() {
  if (!url || !anonKey || !serviceRoleKey) {
    return (
      "Missing VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY. " +
      "On Vercel, set all three for Production and redeploy."
    );
  }
  try {
    new URL(url);
  } catch {
    return `Invalid VITE_SUPABASE_URL: "${url}"`;
  }
  return null;
}

export const supabaseAdmin =
  url && serviceRoleKey ? createClient(url, serviceRoleKey, serverAuthOptions) : null;

// verifyOtp must use the anon/publishable key — service role returns 500 on /verify.
export const supabaseAnonServer =
  url && anonKey ? createClient(url, anonKey, serverAuthOptions) : null;
