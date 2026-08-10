import { createServerClients, getLoginSecret, getServerSupabaseConfigError } from "./supabaseClients.js";
import { deriveLoginPassword } from "./loginPassword.js";

const callLog = new Map();
const MAX_ATTEMPTS_PER_HOUR = 20;

function clientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

function isRateLimited(key) {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const calls = (callLog.get(key) || []).filter((t) => t > hourAgo);
  calls.push(now);
  callLog.set(key, calls);
  return calls.length > MAX_ATTEMPTS_PER_HOUR;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function findUserIdByEmail(url, serviceRoleKey, email) {
  let page = 1;
  const perPage = 200;

  while (page <= 10) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`admin listUsers failed (${res.status}): ${body}`);
    }

    const payload = await res.json();
    const users = payload.users || [];
    const match = users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match.id;
    if (users.length < perPage) return null;
    page += 1;
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const configError = getServerSupabaseConfigError();
  const { supabaseAdmin, supabaseAnonServer, url, serviceRoleKey } = createServerClients();
  if (configError || !supabaseAdmin || !supabaseAnonServer || !url || !serviceRoleKey) {
    console.error("[api/login] config:", configError);
    return res.status(503).json({ error: "Server auth is not configured. Contact the admin." });
  }

  const key = clientKey(req);
  if (isRateLimited(key)) {
    return res.status(429).json({ error: "Too many sign-in attempts. Try again later." });
  }

  const email = normalizeEmail(req.body?.email);
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  try {
    const password = deriveLoginPassword(email, getLoginSecret());

    let { data: sessionData, error: signInError } = await supabaseAnonServer.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !sessionData?.session) {
      const userId = await findUserIdByEmail(url, serviceRoleKey, email);
      if (!userId) {
        return res.status(403).json({ error: "You haven't been invited yet. Ask the admin to add your email." });
      }

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
      });
      if (updateError) {
        console.error("[api/login] updateUserById:", updateError.message);
        return res.status(500).json({ error: "Sign-in failed. Try again in a moment." });
      }

      ({ data: sessionData, error: signInError } = await supabaseAnonServer.auth.signInWithPassword({
        email,
        password,
      }));
    }

    if (signInError || !sessionData?.session) {
      console.error("[api/login] signInWithPassword:", signInError?.message, signInError?.code);
      return res.status(500).json({ error: "Sign-in failed. Try again in a moment." });
    }

    const { access_token, refresh_token } = sessionData.session;
    return res.status(200).json({ access_token, refresh_token });
  } catch (err) {
    console.error("[api/login]", err);
    return res.status(500).json({ error: "Sign-in failed. Try again in a moment." });
  }
}
