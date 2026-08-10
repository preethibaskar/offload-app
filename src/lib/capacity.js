import {
  computeCapacitySnapshot,
  getEnergyBucket,
  getTimeMinutes,
  normalizePreferences,
} from "../../shared/preferences.js";
import { addDaysToKey, defaultDueForCategory, normalizeCategory } from "./dayRollover";

export function applyCapacityPlan(newItems, existingOpenItems, preferences, planDayKey) {
  const prefs = normalizePreferences(preferences);
  const deferred = [];
  const workingOpen = existingOpenItems.filter((it) => !it.done && it.category === "today");
  const result = [];

  for (const raw of newItems) {
    let item = { ...raw };
    let category = normalizeCategory(item.category);

    if (category === "today") {
      const snapshot = computeCapacitySnapshot(workingOpen, prefs);
      const bucket = getEnergyBucket(item.tags, item.text);
      const minutes = getTimeMinutes(item.tags);
      const bucketRemaining = snapshot.remaining[bucket] ?? prefs.dailyMinutes[bucket];
      const overBucket = minutes > bucketRemaining;
      const overSlots = snapshot.todaySlotsRemaining <= 0;

      if (overBucket || overSlots) {
        const newCategory =
          bucket === "deep-work" && minutes > 30 && overBucket ? "week" : "tomorrow";
        deferred.push({
          text: item.text,
          from: "today",
          to: newCategory,
          reason: overSlots ? "slots" : "minutes",
        });
        category = newCategory;
        item = {
          ...item,
          category,
          due:
            newCategory === "tomorrow"
              ? addDaysToKey(planDayKey, 1)
              : defaultDueForCategory("week", planDayKey),
        };
      }
    }

    result.push(item);
    if (category === "today") {
      workingOpen.push({ text: item.text, tags: item.tags, category: "today", done: false });
    }
  }

  return { items: result, deferred };
}
