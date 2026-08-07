import { createClient } from "@supabase/supabase-js";
import { ENERGY_TAG_IDS } from "../src/lib/energyTags.js";

// This runs on the server (Vercel), never in the browser. The Anthropic API
// key below is read from an environment variable set in the Vercel project
// dashboard — it never appears in any file the browser downloads.
const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

  const { dump } = req.body || {};
  if (!dump || !dump.trim()) {
    return res.status(400).json({ error: "Empty dump" });
  }

  const prompt = `You organize a person's raw stream-of-consciousness thought dump into an actionable plan.
Categories: "today" (must happen today), "tomorrow" (must happen tomorrow), "week" (later this week, not today or tomorrow), "someday" (no urgency, low priority).
Rules: split into short, concrete, actionable items. Merge near-duplicates. Drop pure filler ("um", "also"). Keep each item under 12 words, written as a task, not a sentence.
Use "tomorrow" when the dump clearly says tomorrow, next day, or a specific task for the next calendar day. Use "today" for same-day urgency.
If blocked on someone else, put it in "week" (not a separate category).
Optionally include "due" as YYYY-MM-DD when the dump mentions a specific date.
For each item, you MUST include a "tags" array with 1-2 values from this list only: ${ENERGY_TAG_IDS.join(", ")}.
- Time tags (always pick exactly one): 5min, 15min, 30min, 60min — estimate duration.
- Energy tags (pick one when it fits): quick-call, needs-focus, low-energy, errand, deep-work.
Every item needs tags. Never return an item without a tags array.
Return ONLY a raw JSON array, no markdown fences, no commentary. Format: [{"text":"...","category":"today","tags":["5min","quick-call"]}]

Dump:
"""${dump}"""`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || "Anthropic request failed";
      return res.status(502).json({ error: message });
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Anthropic request failed" });
  }
}
