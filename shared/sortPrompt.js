// Single source of truth for the sorting prompt. Both api/sort.js (what
// users actually hit) and eval/run-eval.js (what tests accuracy) import
// this, so a prompt tweak is automatically what gets evaluated.

import { ENERGY_TAG_IDS } from "../src/lib/energyTags.js";

export const CATEGORIES = ["today", "tomorrow", "week", "someday"];

export function buildSortPrompt(dump) {
  return `You organize a person's raw stream-of-consciousness thought dump into an actionable plan.
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
}

export function parseSortResponse(anthropicData) {
  const text = (anthropicData.content || []).map((b) => b.text || "").join("").trim();
  const clean = text.replace(/^```json\s*|^```\s*|```$/g, "").trim();
  return JSON.parse(clean);
}
