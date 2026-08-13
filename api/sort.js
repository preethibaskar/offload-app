import { buildSortPrompt } from "../shared/sortPrompt.js";
import { computeCapacitySnapshot, normalizePreferences } from "../shared/preferences.js";
import { getServerSupabaseConfigError, createServerClients } from "./supabaseClients.js";
import { sanitizeEnvValue } from "./env.js";

// This runs on the server (Vercel), never in the browser. The Anthropic API
// key below is read from an environment variable set in the Vercel project
// dashboard — it never appears in any file the browser downloads.

// Very small in-memory rate limit: resets whenever the function cold-starts,
// so it's not a hard guarantee, but it stops a single runaway client from
// hammering the API within one warm instance. Good enough to start; swap in
// a real store (e.g. a Supabase table or Upstash) if usage grows.
const callLog = new Map(); // userId -> [timestamps]
const MAX_CALLS_PER_HOUR = 30;

function isRateLimited(userId) {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const calls = (callLog.get(userId) || []).filter((t) => t > hourAgo);
  calls.push(now);
  callLog.set(userId, calls);
  return calls.length > MAX_CALLS_PER_HOUR;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { supabaseAdmin } = createServerClients();
  if (!supabaseAdmin || getServerSupabaseConfigError()) {
    return res.status(503).json({ error: "Server auth is not configured." });
  }

  // Require a valid Supabase session — this is what stops a stranger who
  // finds the URL from using your Anthropic quota. Only people who were
  // invited (see scripts/invite.js) can ever have a valid token here.
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "Not signed in" });
  }
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return res.status(401).json({ error: "Invalid session" });
  }

  if (isRateLimited(userData.user.id)) {
    return res.status(429).json({ error: "Rate limit exceeded, try again later" });
  }

  const { dump, existingItems, preferences, planDay, clarifications, sortProfile } = req.body || {};
  if (!dump || !dump.trim()) {
    return res.status(400).json({ error: "Empty dump" });
  }

  const prefs = normalizePreferences(preferences);
  const openItems = Array.isArray(existingItems)
    ? existingItems.filter((it) => it && it.text && !it.done)
    : [];
  const capacity = computeCapacitySnapshot(openItems, prefs);
  const clarificationsList = Array.isArray(clarifications)
    ? clarifications.filter((c) => c && c.raw && c.answer)
    : null;

  const prompt = buildSortPrompt(dump, {
    existingItems: openItems,
    preferences: prefs,
    planDay,
    capacity,
    clarifications: clarificationsList?.length ? clarificationsList : null,
    sortProfile: sortProfile?.rules?.length || sortProfile?.examples?.length ? sortProfile : null,
  });

  const anthropicKey = sanitizeEnvValue(process.env.ANTHROPIC_API_KEY);
  if (!anthropicKey) {
    console.error("[api/sort] missing ANTHROPIC_API_KEY");
    return res.status(503).json({
      error: "Sort is not configured — add ANTHROPIC_API_KEY on Vercel and redeploy.",
    });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || "Anthropic request failed";
      console.error("[api/sort] anthropic:", response.status, message);
      return res.status(502).json({ error: message });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error("[api/sort]", err);
    return res.status(500).json({ error: "Anthropic request failed" });
  }
}
