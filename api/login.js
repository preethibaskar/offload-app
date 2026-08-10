import {
  getLoginSecret,
  getServerSupabaseConfigError,
  supabaseAdmin,
  supabaseAnonServer,
} from "./supabaseClients.js";
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

async function findUserByEmail(email) {
  let page = 1;
  const perPage = 200;

  while (page <= 10) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) return user;

    if (data.users.length < perPage) return null;
    page += 1;
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const configError = getServerSupabaseConfigError();
  if (configError || !supabaseAdmin || !supabaseAnonServer) {
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
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(403).json({ error: "You haven't been invited yet. Ask the admin to add your email." });
    }

    const password = deriveLoginPassword(email, getLoginSecret());

    let { data: sessionData, error: signInError } = await supabaseAnonServer.auth.signInWithPassword({
      email,
      password,
    });

    // Users added before passwords were set (createUser without password) — set it once and retry.
    if (signInError) {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
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
