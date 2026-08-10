export const PREFERENCE_KEY = "preferences";

export const ENERGY_BUCKETS = ["errand", "deep-work", "quick-call", "needs-focus"];

export const BUCKET_LABELS = {
  errand: "Errands",
  "deep-work": "Deep work",
  "quick-call": "Calls",
  "needs-focus": "Focus blocks",
};

export const DEFAULT_PREFERENCES = {
  dailyMinutes: {
    errand: 60,
    "deep-work": 120,
    "quick-call": 30,
    "needs-focus": 90,
  },
  maxTodayItems: 10,
};

export const TIME_TAG_MINUTES = {
  "5min": 5,
  "15min": 15,
  "30min": 30,
  "60min": 60,
};

export function normalizePreferences(raw) {
  const dailyMinutes = { ...DEFAULT_PREFERENCES.dailyMinutes };
  if (raw?.dailyMinutes && typeof raw.dailyMinutes === "object") {
    for (const bucket of ENERGY_BUCKETS) {
      const v = raw.dailyMinutes[bucket];
      if (typeof v === "number" && v >= 0) dailyMinutes[bucket] = v;
    }
  }
  const maxTodayItems =
    typeof raw?.maxTodayItems === "number" && raw.maxTodayItems > 0
      ? raw.maxTodayItems
      : DEFAULT_PREFERENCES.maxTodayItems;
  return { dailyMinutes, maxTodayItems };
}

export function getTimeMinutes(tags) {
  const match = (tags || []).find((tag) => TIME_TAG_MINUTES[tag]);
  return match ? TIME_TAG_MINUTES[match] : 15;
}

export function getEnergyBucket(tags, text) {
  for (const bucket of ENERGY_BUCKETS) {
    if ((tags || []).includes(bucket)) return bucket;
  }
  const t = (text || "").toLowerCase();
  if (/\b(call|ping|text|slack|email|reply|doctor|appointment|meet)\b/.test(t)) return "quick-call";
  if (/\b(buy|pick up|groceries|filter|errand|drop off)\b/.test(t)) return "errand";
  if (/\b(deep|architect|strategy|redesign|refactor)\b/.test(t)) return "deep-work";
  if (/\b(prepare|report|migration|focus|deadline)\b/.test(t)) return "needs-focus";
  return "needs-focus";
}

export function computeCapacitySnapshot(openItems, preferences) {
  const prefs = normalizePreferences(preferences);
  const todayOpen = openItems.filter((it) => !it.done && it.category === "today");
  const used = Object.fromEntries(ENERGY_BUCKETS.map((b) => [b, 0]));

  for (const item of todayOpen) {
    const bucket = getEnergyBucket(item.tags, item.text);
    used[bucket] += getTimeMinutes(item.tags);
  }

  const remaining = {};
  for (const bucket of ENERGY_BUCKETS) {
    remaining[bucket] = Math.max(0, prefs.dailyMinutes[bucket] - used[bucket]);
  }

  const todayCount = todayOpen.length;
  const todaySlotsRemaining = Math.max(0, prefs.maxTodayItems - todayCount);

  return { used, remaining, todayCount, todaySlotsRemaining };
}
