import { supabaseAdmin } from "./supabaseAdmin.js";

const callLog = new Map(); // ip-ish key -> [timestamps]
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

function isUserNotFound(error) {
  const msg = (error?.message || "").toLowerCase();
  return (
    msg.includes("user not found") ||
    msg.includes("not found") ||
    msg.includes("no user") ||
    error?.code === "user_not_found"
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
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
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    if (linkError) {
      if (isUserNotFound(linkError)) {
        return res.status(403).json({ error: "You haven't been invited yet. Ask the admin to add your email." });
      }
      console.error("[api/login] generateLink:", linkError.message);
      return res.status(500).json({ error: "Sign-in failed. Try again in a moment." });
    }

    const tokenHash = linkData?.properties?.hashed_token;
    if (!tokenHash) {
      console.error("[api/login] missing hashed_token from generateLink");
      return res.status(500).json({ error: "Sign-in failed. Try again in a moment." });
    }

    const { data: sessionData, error: verifyError } = await supabaseAdmin.auth.verifyOtp({
      token_hash: tokenHash,
      type: "email",
    });

    if (verifyError || !sessionData?.session) {
      console.error("[api/login] verifyOtp:", verifyError?.message);
      return res.status(500).json({ error: "Sign-in failed. Try again in a moment." });
    }

    const { access_token, refresh_token } = sessionData.session;
    return res.status(200).json({ access_token, refresh_token });
  } catch (err) {
    console.error("[api/login]", err);
    return res.status(500).json({ error: "Sign-in failed. Try again in a moment." });
  }
}
