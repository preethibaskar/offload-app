// Single source of truth for the sorting prompt. Both api/sort.js (what
// users actually hit) and eval/run-eval.js (what tests accuracy) import
// this, so a prompt tweak is automatically what gets evaluated.

import { ENERGY_TAG_IDS } from "../src/lib/energyTags.js";
import { BUCKET_LABELS, ENERGY_BUCKETS } from "./preferences.js";

export const CATEGORIES = ["today", "tomorrow", "week", "someday"];

function formatContextBlock({ existingItems, preferences, planDay, capacity }) {
  const parts = [];

  if (existingItems?.length) {
    parts.push(
      "Open items already on the user's list (do NOT return duplicates or near-duplicates of these — skip or merge urgency only):"
    );
    for (const it of existingItems) {
      const tags = it.tags?.length ? ` (${it.tags.join(", ")})` : "";
      parts.push(`- [${it.category}] ${it.text}${tags}`);
    }
  }

  if (preferences && capacity) {
    parts.push(`Daily capacity for plan day ${planDay || "today"} (respect when assigning "today"):`);
    for (const bucket of ENERGY_BUCKETS) {
      const limit = preferences.dailyMinutes[bucket];
      const used = capacity.used[bucket] || 0;
      const remaining = capacity.remaining[bucket] ?? Math.max(0, limit - used);
      parts.push(`- ${BUCKET_LABELS[bucket]}: ${remaining} min remaining (${used}/${limit} min used)`);
    }
    parts.push(
      `- Today tray: ${capacity.todaySlotsRemaining} slots remaining (${capacity.todayCount}/${preferences.maxTodayItems} items)`
    );
    parts.push(
      "When today is full for a work type or item count, assign new items to \"tomorrow\" or \"week\" instead of \"today\". Urgent same-day items that cannot fit may go to tomorrow."
    );
  }

  if (!parts.length) return "";
  return "\n" + parts.join("\n") + "\n";
}

export function buildSortPrompt(dump, options = {}) {
  const {
    existingItems = [],
    preferences = null,
    planDay = null,
    capacity = null,
  } = options;

  const contextBlock = formatContextBlock({
    existingItems,
    preferences,
    planDay,
    capacity,
  });

  const dedupRule = existingItems?.length
    ? "If the dump mentions something already on the list, do NOT add it again — skip it entirely."
    : "Merge near-duplicates within the dump.";

  return `You organize a person's raw stream-of-consciousness thought dump into an actionable plan.
Categories: "today" (must happen today), "tomorrow" (must happen tomorrow), "week" (later this week, not today or tomorrow), "someday" (no urgency, low priority).
Rules: split into short, concrete, actionable items. ${dedupRule} Drop pure filler ("um", "also"). Keep each item under 12 words, written as a task, not a sentence.
Use "tomorrow" when the dump clearly says tomorrow, next day, or a specific task for the next calendar day. Use "today" for same-day urgency.
If blocked on someone else, put it in "week" (not a separate category).
Optionally include "due" as YYYY-MM-DD when the dump mentions a specific date.
For each item, you MUST include a "tags" array with 1-2 values from this list only: ${ENERGY_TAG_IDS.join(", ")}.
- Time tags (always pick exactly one): 5min, 15min, 30min, 60min — estimate duration.
- Energy tags (pick one when it fits): quick-call, needs-focus, low-energy, errand, deep-work.
Every item needs tags. Never return an item without a tags array.
Return ONLY a raw JSON array, no markdown fences, no commentary. Format: [{"text":"...","category":"today","tags":["5min","quick-call"]}]
${contextBlock}
Dump:
"""${dump}"""`;
}

export function parseSortResponse(anthropicData) {
  const text = (anthropicData.content || []).map((b) => b.text || "").join("").trim();
  const clean = text.replace(/^```json\s*|^```\s*|```$/g, "").trim();
  return JSON.parse(clean);
}
