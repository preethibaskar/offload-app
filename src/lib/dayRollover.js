export function addDaysToKey(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const PLAN_CATEGORIES = ["today", "tomorrow", "week", "someday"];

export function normalizeCategory(category) {
  if (category === "waiting") return "week";
  return PLAN_CATEGORIES.includes(category) ? category : "week";
}

export function endOfWeekKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  return addDaysToKey(key, daysUntilSunday);
}

/** Default due date when a task is created, based on its tray. */
export function defaultDueForCategory(category, planDayKey) {
  const cat = normalizeCategory(category);
  switch (cat) {
    case "today":
      return planDayKey;
    case "tomorrow":
      return addDaysToKey(planDayKey, 1);
    case "week":
      return endOfWeekKey(planDayKey);
    case "someday":
      return addDaysToKey(planDayKey, 30);
    default:
      return endOfWeekKey(planDayKey);
  }
}

export function ensureDue(category, planDayKey, due) {
  if (due && /^\d{4}-\d{2}-\d{2}$/.test(String(due))) return String(due);
  return defaultDueForCategory(category, planDayKey);
}

export function daysBetween(fromKey, toKey) {
  const parse = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  };
  return Math.round((parse(toKey) - parse(fromKey)) / 86400000);
}

const LOW_EFFORT_TAGS = new Set(["5min", "15min", "low-energy", "errand", "quick-call"]);
const MIN_SOMEDAY_AGE_DAYS = 7;
const URGENT_SOMEDAY_AGE_DAYS = 21;
const RESURFACE_COOLDOWN_DAYS = 7;
const MAX_RESURFACE_PER_DAY = 2;

function somedayResurfaceScore(item, dayKey) {
  const since = item.somedaySince || item.due;
  const age = daysBetween(since, dayKey);
  let score = age;
  for (const tag of item.tags || []) {
    if (LOW_EFFORT_TAGS.has(tag)) score += 6;
  }
  return score;
}

/**
 * Gently promote stale someday items into week/tomorrow so they don't rot.
 * Prefers low-effort tasks that fit a packed day. Runs once per calendar day.
 */
export function resurfaceSomedayItems(items, dayKey) {
  const eligible = items.filter((it) => {
    if (it.done || it.category !== "someday") return false;
    const since = it.somedaySince || it.due;
    if (daysBetween(since, dayKey) < MIN_SOMEDAY_AGE_DAYS) return false;
    if (it.lastResurfaced && daysBetween(it.lastResurfaced, dayKey) < RESURFACE_COOLDOWN_DAYS) {
      return false;
    }
    return true;
  });

  const picks = eligible
    .map((item) => ({ item, score: somedayResurfaceScore(item, dayKey) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESURFACE_PER_DAY);

  if (picks.length === 0) {
    return { items, resurfaced: [] };
  }

  const pickIds = new Set(picks.map((p) => p.item.id));
  const resurfaced = [];

  const next = items.map((it) => {
    if (!pickIds.has(it.id)) return it;
    const since = it.somedaySince || it.due;
    const age = daysBetween(since, dayKey);
    const toCategory = age >= URGENT_SOMEDAY_AGE_DAYS ? "tomorrow" : "week";
    const due = toCategory === "tomorrow" ? addDaysToKey(dayKey, 1) : endOfWeekKey(dayKey);
    resurfaced.push({ id: it.id, text: it.text, toCategory });
    return {
      ...it,
      category: toCategory,
      due,
      resurfacedFrom: "someday",
      lastResurfaced: dayKey,
      somedaySince: undefined,
    };
  });

  return { items: next, resurfaced };
}

export function backfillItem(item, planDayKey) {
  const category = normalizeCategory(item.category);
  const due = ensureDue(category, planDayKey, item.due);
  let somedaySince = item.somedaySince;
  if (category === "someday" && !somedaySince) {
    somedaySince = planDayKey;
  }
  if (category !== "someday") {
    somedaySince = undefined;
  }
  const changed = category !== item.category || due !== item.due || somedaySince !== item.somedaySince;
  return { item: { ...item, category, due, somedaySince }, changed };
}

const ROLLOVER_CATEGORIES = new Set(["today", "tomorrow"]);

/** Promote week/someday items into today or tomorrow based on due date. */
export function promoteByDueDate(items, dayKey) {
  const tomorrowKey = addDaysToKey(dayKey, 1);
  return items.map((it) => {
    if (it.done || (it.category !== "week" && it.category !== "someday") || !it.due) return it;
    if (it.due < dayKey) return { ...it, category: "today" };
    if (it.due === dayKey) return { ...it, category: "today" };
    if (it.due === tomorrowKey) return { ...it, category: "tomorrow" };
    return it;
  });
}

/** Move incomplete today/tomorrow items from yesterday into today's plan. */
export function rolloverFromYesterday(yesterdayItems, todayItems, yesterdayKey) {
  const rolledIds = new Set();
  const toCarry = [];

  for (const it of yesterdayItems) {
    if (it.done || !ROLLOVER_CATEGORIES.has(it.category)) continue;
    toCarry.push({
      ...it,
      category: "today",
      carriedFrom: yesterdayKey,
    });
    rolledIds.add(it.id);
  }

  const existingIds = new Set(todayItems.map((i) => i.id));
  const merged = [...todayItems];
  let carriedCount = 0;

  for (const item of toCarry) {
    if (!existingIds.has(item.id)) {
      merged.push(item);
      existingIds.add(item.id);
      carriedCount += 1;
    }
  }

  const yesterdayRemaining = yesterdayItems.filter((it) => !rolledIds.has(it.id));

  return { todayItems: merged, yesterdayItems: yesterdayRemaining, carriedCount };
}

export function itemsChanged(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}
