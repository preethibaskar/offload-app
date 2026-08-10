import { createClient } from "@supabase/supabase-js";

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)?.trim();
const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)?.trim();
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
      "Missing Supabase URL, anon key, or service role key. " +
      "On Vercel set SUPABASE_SERVICE_ROLE_KEY plus either " +
      "VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (for the frontend build) or " +
      "SUPABASE_URL + SUPABASE_ANON_KEY for API routes, then redeploy."
    );
  }
  try {
    new URL(url);
  } catch {
    return `Invalid Supabase URL: "${url}"`;
  }
  return null;
}

export function getLoginSecret() {
  return process.env.LOGIN_SECRET?.trim() || serviceRoleKey;
}

export const supabaseAdmin =
  url && serviceRoleKey ? createClient(url, serviceRoleKey, serverAuthOptions) : null;

export const supabaseAnonServer =
  url && anonKey ? createClient(url, anonKey, serverAuthOptions) : null;
