export const ENERGY_TAGS = [
  { id: "5min", label: "5 min", group: "time" },
  { id: "15min", label: "15 min", group: "time" },
  { id: "30min", label: "30 min", group: "time" },
  { id: "60min", label: "60+ min", group: "time" },
  { id: "quick-call", label: "Quick call", group: "energy" },
  { id: "needs-focus", label: "Needs focus", group: "energy" },
  { id: "low-energy", label: "Low energy", group: "energy" },
  { id: "errand", label: "Errand", group: "energy" },
  { id: "deep-work", label: "Deep work", group: "energy" },
];

export const ENERGY_TAG_IDS = ENERGY_TAGS.map((t) => t.id);

const TAG_ALIASES = {
  "5 min": "5min",
  "15 min": "15min",
  "30 min": "30min",
  "60 min": "60min",
  "60+ min": "60min",
  "quick call": "quick-call",
  "needs focus": "needs-focus",
  "low energy": "low-energy",
  "deep work": "deep-work",
};

export const tagById = (id) => ENERGY_TAGS.find((t) => t.id === id);

export function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    const key = String(raw).toLowerCase().trim();
    const id = ENERGY_TAG_IDS.includes(raw)
      ? raw
      : TAG_ALIASES[key] || ENERGY_TAG_IDS.find((tid) => tid === key.replace(/\s+/g, ""));
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Guess time/energy tags from task text when the model omits them. */
export function inferTagsFromText(text) {
  const t = (text || "").toLowerCase();
  const tags = [];

  if (/\b(quick|email|reply|ping|text|slack|remind)\b/.test(t) || /\bcall\b/.test(t)) {
    tags.push("5min");
  } else if (/\b(buy|pick up|drop off|groceries|filter|errand|water|plants)\b/.test(t)) {
    tags.push("15min");
  } else if (/\b(prepare|write|build|plan|report|migration|rollout|review|schedule)\b/.test(t)) {
    tags.push("30min");
  } else if (/\b(deep|architect|strategy|redesign|refactor)\b/.test(t)) {
    tags.push("60min");
  } else {
    tags.push("15min");
  }

  if (/\b(call|ping|text|slack|email|reply|doctor|appointment|meet)\b/.test(t)) {
    tags.push("quick-call");
  } else if (/\b(buy|pick up|groceries|filter|errand|drop off)\b/.test(t)) {
    tags.push("errand");
  } else if (/\b(prepare|report|migration|kafka|focus|deadline)\b/.test(t)) {
    tags.push("needs-focus");
  } else if (/\b(build|learn|design|swift|app|code)\b/.test(t)) {
    tags.push("deep-work");
  } else if (/\b(check|review|read|water|organize)\b/.test(t)) {
    tags.push("low-energy");
  }

  return [...new Set(tags)].slice(0, 2);
}

/** Every sorted item gets at least one time tag (+ energy when we can infer it). */
export function ensureTags(tags, text) {
  const normalized = normalizeTags(tags);
  if (normalized.length > 0) return normalized;
  return inferTagsFromText(text);
}

export function itemMatchesTagFilters(item, filters) {
  if (!filters?.length) return true;
  const itemTags = item.tags || [];
  return filters.some((id) => itemTags.includes(id));
}
