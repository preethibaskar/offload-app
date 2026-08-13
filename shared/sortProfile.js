export const SORT_PROFILE_KEY = "sort_profile";

const MAX_EXAMPLES = 8;
const MAX_RULES = 5;
const PATTERN_THRESHOLD = 2;

const CATEGORY_LABELS = {
  today: "today",
  tomorrow: "tomorrow",
  week: "this week",
  someday: "someday",
};

/** Map clarification chip answers (or free text) to a tray category. */
export function inferCategoryFromAnswer(answer) {
  const a = (answer || "").toLowerCase().trim();
  if (!a) return null;
  if (/\btoday\b/.test(a)) return "today";
  if (/\btomorrow\b/.test(a)) return "tomorrow";
  if (/\bsomeday\b/.test(a)) return "someday";
  if (/\b(this week|week)\b/.test(a)) return "week";
  return null;
}

export function buildSortProfileFromCorrections(corrections) {
  if (!Array.isArray(corrections) || corrections.length === 0) {
    return { rules: [], examples: [] };
  }

  const patterns = {};
  const examples = [];
  const seen = new Set();

  for (const row of corrections) {
    const from = row.ai_category;
    const to = row.corrected_category;
    if (!to || !row.item_text) continue;

    if (from !== to) {
      const key = `${from}→${to}`;
      patterns[key] = (patterns[key] || 0) + 1;
    }

    if (examples.length >= MAX_EXAMPLES || seen.has(row.item_text)) continue;
    seen.add(row.item_text);
    examples.push({ text: row.item_text, category: to });
  }

  const rules = [];
  for (const [key, count] of Object.entries(patterns)) {
    if (count < PATTERN_THRESHOLD) continue;
    const [from, to] = key.split("→");
    const fromLabel = CATEGORY_LABELS[from] || from;
    const toLabel = CATEGORY_LABELS[to] || to;
    if (from === "pending") {
      rules.push(`When the dump is vague, this user usually wants similar items in ${toLabel} (${count} clarifications).`);
    } else {
      rules.push(`Often moves items from ${fromLabel} to ${toLabel} (${count} corrections).`);
    }
  }

  return {
    rules: rules.slice(0, MAX_RULES),
    examples: examples.slice(0, MAX_EXAMPLES),
  };
}

export function formatSortProfileBlock(sortProfile) {
  if (!sortProfile) return "";
  const rules = sortProfile.rules || [];
  const examples = sortProfile.examples || [];
  if (!rules.length && !examples.length) return "";

  const parts = [
    "\nThis user's sorting preferences (learned from their past corrections — follow these over generic urgency):",
  ];
  for (const rule of rules) {
    parts.push(`- ${rule}`);
  }
  if (examples.length) {
    parts.push("\nExamples of how this user sorts:");
    for (const ex of examples) {
      parts.push(`- "${ex.text}" → ${ex.category}`);
    }
  }
  return parts.join("\n") + "\n";
}
