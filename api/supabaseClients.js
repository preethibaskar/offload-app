import { createClient } from "@supabase/supabase-js";

const serverAuthOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

function readEnv() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)?.trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return { url, anonKey, serviceRoleKey };
}

export function getServerSupabaseConfigError() {
  const { url, anonKey, serviceRoleKey } = readEnv();
  if (!url || !anonKey || !serviceRoleKey) {
    return (
      "Missing Supabase URL, anon key, or service role key. " +
      "On Vercel set SUPABASE_SERVICE_ROLE_KEY and either VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY " +
      "or SUPABASE_URL + SUPABASE_ANON_KEY, then redeploy."
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
  const { serviceRoleKey } = readEnv();
  return process.env.LOGIN_SECRET?.trim() || serviceRoleKey;
}

export function createServerClients() {
  const { url, anonKey, serviceRoleKey } = readEnv();
  if (!url || !anonKey || !serviceRoleKey) {
    return { supabaseAdmin: null, supabaseAnonServer: null };
  }
  return {
    supabaseAdmin: createClient(url, serviceRoleKey, serverAuthOptions),
    supabaseAnonServer: createClient(url, anonKey, serverAuthOptions),
    url,
    serviceRoleKey,
  };
}
