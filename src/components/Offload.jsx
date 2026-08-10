import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import {
  Sparkles, Plus, X, Check, Clock, CalendarDays, History, Loader2,
  ChevronUp, ChevronDown, Calendar, Repeat, Bell, BarChart3, Trash2, Filter, Sunrise, Settings
} from "lucide-react";
import { storage } from "../lib/storage";
import { supabase } from "../supabaseClient";
import { ENERGY_TAGS, ensureTags, itemMatchesTagFilters, tagById } from "../lib/energyTags";
import {
  addDaysToKey, promoteByDueDate, rolloverFromYesterday, itemsChanged,
  normalizeCategory, ensureDue, backfillItem, resurfaceSomedayItems, defaultDueForCategory,
} from "../lib/dayRollover";
import { filterDuplicates, isDuplicateOfExisting } from "../lib/dedup";
import { applyCapacityPlan } from "../lib/capacity";
import { PREFERENCE_KEY, DEFAULT_PREFERENCES, normalizePreferences } from "../../shared/preferences.js";
import { parseSortResponse } from "../../shared/sortPrompt.js";
import PreferencesPanel from "./PreferencesPanel";

const CATS = [
  { id: "today", label: "Today", icon: Check },
  { id: "tomorrow", label: "Tomorrow", icon: Sunrise },
  { id: "week", label: "This Week", icon: CalendarDays },
  { id: "someday", label: "Someday", icon: Clock },
];

const REPEATS = [
  { id: "daily", label: "Daily" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Weekly" },
];

const keyFromDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const todayKey = () => keyFromDate(new Date());

const dateFromKey = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const fmtDate = (key) =>
  dateFromKey(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

const fmtShort = (key) =>
  dateFromKey(key).toLocaleDateString(undefined, { weekday: "short" });

const addDays = (key, n) => addDaysToKey(key, n);

const mondayOf = (key) => {
  const d = dateFromKey(key);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
};

const dueLabel = (due) => {
  if (!due) return null;
  const t = todayKey();
  if (due < t) return "Overdue";
  if (due === t) return "Due today";
  if (due === addDays(t, 1)) return "Due tomorrow";
  return `Due ${dateFromKey(due).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const newTask = (fields, planDayKey) => {
  const category = normalizeCategory(fields.category);
  return {
    ...fields,
    id: fields.id || uid(),
    text: fields.text,
    category,
    tags: fields.tags ? ensureTags(fields.tags, fields.text) : [],
    due: ensureDue(category, planDayKey, fields.due),
    done: fields.done ?? false,
    somedaySince: category === "someday" ? (fields.somedaySince || planDayKey) : undefined,
    aiSorted: fields.aiSorted ?? false,
    aiOriginalCategory: fields.aiOriginalCategory,
  };
};

const resizeItemText = (el) => {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

export default function Offload() {
  const [dateKey, setDateKey] = useState(todayKey());
  const [dump, setDump] = useState("");
  const [items, setItems] = useState([]);
  const [sorting, setSorting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyKeys, setHistoryKeys] = useState([]);
  const [addingTo, setAddingTo] = useState(null);
  const [addText, setAddText] = useState("");
  const [error, setError] = useState("");
  const [justLanded, setJustLanded] = useState({});
  const [dueEditingId, setDueEditingId] = useState(null);
  const [recurring, setRecurring] = useState([]);
  const [recurringLoaded, setRecurringLoaded] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [recText, setRecText] = useState("");
  const [recCategory, setRecCategory] = useState("today");
  const [recRepeat, setRecRepeat] = useState("daily");
  const [view, setView] = useState("day");
  const [weekData, setWeekData] = useState(null);
  const [weekLoading, setWeekLoading] = useState(false);
  const [tagFilters, setTagFilters] = useState([]);
  const [carryOverNudge, setCarryOverNudge] = useState(null);
  const [resurfaceNudge, setResurfaceNudge] = useState(null);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [sortNudge, setSortNudge] = useState(null);
  const loadIdRef = useRef(0);
  const dumpRef = useRef("");
  const itemsRef = useRef([]);
  const preferencesRef = useRef(DEFAULT_PREFERENCES);

  // Fire-and-forget: writes to the `corrections` table (see supabase/schema.sql).
  const logCorrection = useCallback(({ text, aiCategory, correctedCategory }) => {
    supabase
      .from("corrections")
      .insert({ item_text: text, ai_category: aiCategory, corrected_category: correctedCategory })
      .then(({ error }) => {
        if (error) console.error("Failed to log correction:", error.message);
      });
  }, []);

  useEffect(() => {
    dumpRef.current = dump;
  }, [dump]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  const loadPreferences = useCallback(async () => {
    try {
      const res = await storage.get(PREFERENCE_KEY);
      if (res?.value) {
        setPreferences(normalizePreferences(JSON.parse(res.value)));
      }
    } catch {
      /* use defaults */
    }
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => { loadPreferences(); }, [loadPreferences]);

  const savePreferences = useCallback(async (nextPrefs) => {
    const normalized = normalizePreferences(nextPrefs);
    setPreferences(normalized);
    try {
      await storage.set(PREFERENCE_KEY, JSON.stringify(normalized));
    } catch {
      setError("Couldn't save preferences.");
    }
  }, []);

  const sortDump = useCallback(async (textOverride) => {
    const dumpText = (textOverride ?? dumpRef.current).trim();
    if (!dumpText) return;
    setSorting(true);
    setError("");
    setSortNudge(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const openItems = itemsRef.current.filter((it) => !it.done);
      const prefs = preferencesRef.current;

      const response = await fetch("/api/sort", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dump: dumpText,
          existingItems: openItems.map((it) => ({
            text: it.text,
            category: it.category,
            tags: it.tags,
            done: it.done,
          })),
          preferences: prefs,
          planDay: dateKey,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Sort request failed");
      }
      const data = await response.json();
      const parsed = parseSortResponse(data)
        .filter((p) => p && p.text)
        .map((p) => ({
          text: p.text,
          category: p.category,
          tags: p.tags,
          due: p.due,
          aiSorted: true,
          aiOriginalCategory: CATS.some((c) => c.id === normalizeCategory(p.category))
            ? normalizeCategory(p.category)
            : "week",
        }));

      const { unique, skipped } = filterDuplicates(parsed, openItems);
      const { items: capacityPlanned, deferred } = applyCapacityPlan(
        unique,
        openItems,
        prefs,
        dateKey
      );

      const newItems = capacityPlanned.map((p) => newTask(p, dateKey));

      if (newItems.length === 0) {
        if (skipped.length > 0) {
          setSortNudge({ skipped: skipped.length, deferred: [] });
          setDump("");
          return;
        }
        console.warn("[sort] API returned no items. Raw response:", data);
        throw new Error("Sort returned no items — try again.");
      }

      setItems((prev) => [...prev, ...newItems]);
      const landing = {};
      newItems.forEach((it) => (landing[it.id] = true));
      setJustLanded(landing);
      setTimeout(() => setJustLanded({}), 900);
      if (skipped.length > 0 || deferred.length > 0) {
        setSortNudge({ skipped: skipped.length, deferred });
      }
      setDump("");
    } catch (err) {
      setError(err.message || "Couldn't sort that dump — try again in a moment.");
    }
    setSorting(false);
  }, [dateKey]);

  const persistPlan = useCallback(async (key, nextItems, nextDump) => {
    try {
      await storage.set(`plan:${key}`, JSON.stringify({ items: nextItems, dump: nextDump }));
    } catch {
      setError("Couldn't save — your changes may not persist.");
    }
  }, []);

  const loadRecurring = useCallback(async () => {
    try {
      const res = await storage.get("recurring");
      setRecurring(res && res.value ? JSON.parse(res.value) : []);
    } catch {
      setRecurring([]);
    }
    setRecurringLoaded(true);
  }, []);

  useEffect(() => { loadRecurring(); }, [loadRecurring]);

  const isScheduled = (tmpl, key) => {
    if (key < tmpl.createdKey) return false;
    const day = dateFromKey(key).getDay();
    if (tmpl.repeat === "daily") return true;
    if (tmpl.repeat === "weekdays") return day >= 1 && day <= 5;
    if (tmpl.repeat === "weekly") return day === tmpl.weekday;
    return false;
  };

  const loadDay = useCallback(async (key, recurringList) => {
    const loadId = ++loadIdRef.current;
    setLoaded(false);
    setCarryOverNudge(null);
    setResurfaceNudge(null);
    let baseItems = [];
    let baseDump = "";
    try {
      const res = await storage.get(`plan:${key}`);
      if (res && res.value) {
        const parsed = JSON.parse(res.value);
        baseItems = parsed.items || [];
        baseDump = parsed.dump || "";
      }
    } catch { /* no saved plan yet */ }

    if (loadId !== loadIdRef.current) return;

    let backfillChanged = false;
    baseItems = baseItems.map((it) => {
      const { item, changed } = backfillItem(it, key);
      if (changed) backfillChanged = true;
      return item;
    });

    if (key === todayKey()) {
      let changed = backfillChanged;
      const landing = {};

      try {
        const rolloverMarker = `rollover:${key}`;
        const markerRes = await storage.get(rolloverMarker);
        if (!markerRes) {
          const yesterdayKey = addDays(key, -1);
          const yRes = await storage.get(`plan:${yesterdayKey}`);
          if (yRes?.value) {
            const yPlan = JSON.parse(yRes.value);
            const yItems = yPlan.items || [];
            const { todayItems, yesterdayItems, carriedCount } = rolloverFromYesterday(yItems, baseItems, yesterdayKey);
            if (carriedCount > 0) {
              baseItems = todayItems;
              changed = true;
              todayItems.filter((it) => it.carriedFrom).forEach((it) => { landing[it.id] = true; });
              setCarryOverNudge({ count: carriedCount, from: yesterdayKey });
            }
            if (itemsChanged(yItems, yesterdayItems)) {
              await storage.set(`plan:${yesterdayKey}`, JSON.stringify({ items: yesterdayItems, dump: yPlan.dump || "" }));
            }
          }
          await storage.set(rolloverMarker, "1");
        }
      } catch { /* rollover is best-effort */ }

      (recurringList || []).forEach((tmpl) => {
        if (isScheduled(tmpl, key) && !baseItems.some((it) => it.recurringId === tmpl.id)) {
          const newIt = newTask({
            text: tmpl.text,
            category: tmpl.category,
            recurringId: tmpl.id,
          }, key);
          baseItems = [...baseItems, newIt];
          landing[newIt.id] = true;
          changed = true;
        }
      });

      const promoted = promoteByDueDate(baseItems, key);
      if (itemsChanged(baseItems, promoted)) {
        promoted.forEach((it) => {
          const prev = baseItems.find((p) => p.id === it.id);
          if (prev && prev.category !== it.category) landing[it.id] = true;
        });
        baseItems = promoted;
        changed = true;
      }

      try {
        const resurfaceMarker = `someday-resurface:${key}`;
        const resurfaceDone = await storage.get(resurfaceMarker);
        if (!resurfaceDone) {
          const { items: resurfacedItems, resurfaced } = resurfaceSomedayItems(baseItems, key);
          if (resurfaced.length > 0) {
            baseItems = resurfacedItems;
            changed = true;
            resurfaced.forEach((r) => { landing[r.id] = true; });
            setResurfaceNudge({ count: resurfaced.length, items: resurfaced });
          }
          await storage.set(resurfaceMarker, "1");
        }
      } catch { /* resurface is best-effort */ }

      if (changed) {
        persistPlan(key, baseItems, baseDump);
        setJustLanded(landing);
        setTimeout(() => setJustLanded({}), 900);
      }
    } else if (backfillChanged) {
      persistPlan(key, baseItems, baseDump);
    }

    if (loadId !== loadIdRef.current) return;

    setItems(baseItems);
    setDump(baseDump);
    setLoaded(true);
  }, [persistPlan]);

  useEffect(() => {
    if (recurringLoaded) loadDay(dateKey, recurring);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, recurringLoaded]);

  useEffect(() => {
    if (!loaded) return;
    persistPlan(dateKey, items, dump);
  }, [items, dump, loaded, dateKey, persistPlan]);

  useLayoutEffect(() => {
    if (!loaded) return;
    document.querySelectorAll(".offload-app .item-text").forEach(resizeItemText);
  }, [items, loaded]);

  const openHistory = async () => {
    try {
      const res = await storage.list("plan:");
      const keys = (res?.keys || []).map((k) => k.replace("plan:", "")).sort().reverse();
      setHistoryKeys(keys);
    } catch {
      setHistoryKeys([]);
    }
    setHistoryOpen(true);
  };

  const loadWeek = useCallback(async () => {
    setWeekLoading(true);
    const monday = mondayOf(dateKey);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = keyFromDate(d);
      let total = 0, done = 0;
      try {
        const res = await storage.get(`plan:${key}`);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          total = (parsed.items || []).length;
          done = (parsed.items || []).filter((it) => it.done).length;
        }
      } catch { /* nothing saved for this day */ }
      days.push({ key, total, done });
    }
    setWeekData(days);
    setWeekLoading(false);
  }, [dateKey]);

  useEffect(() => { if (view === "week") loadWeek(); }, [view, loadWeek]);

  const toggleDone = (id) => setItems((prev) => prev.map((it) => (
    it.id === id ? { ...it, done: !it.done, carriedFrom: !it.done ? undefined : it.carriedFrom } : it
  )));
  const removeItem = (id) => setItems((prev) => prev.filter((it) => it.id !== id));
  const setCategory = (id, category) => setItems((prev) => {
    const target = prev.find((it) => it.id === id);
    const cat = normalizeCategory(category);
    if (target?.aiSorted && target.aiOriginalCategory && target.aiOriginalCategory !== cat) {
      logCorrection({
        text: target.text,
        aiCategory: target.aiOriginalCategory,
        correctedCategory: cat,
      });
    }
    return prev.map((it) => {
      if (it.id !== id) return it;
      return {
        ...it,
        category: cat,
        due: ensureDue(cat, dateKey),
        carriedFrom: undefined,
        resurfacedFrom: undefined,
        somedaySince: cat === "someday" ? dateKey : undefined,
        aiSorted: false,
      };
    });
  });
  const editItem = (id, text) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, text } : it)));
  const setDue = (id, due) => setItems((prev) => prev.map((it) => (
    it.id === id ? { ...it, due: due || undefined, carriedFrom: undefined } : it
  )));
  const snoozeToTomorrow = (id) => {
    const tomorrow = addDays(todayKey(), 1);
    setItems((prev) => prev.map((it) => (
      it.id === id ? { ...it, category: "tomorrow", due: tomorrow, carriedFrom: undefined, resurfacedFrom: undefined } : it
    )));
  };
  const returnToSomeday = (id) => {
    setItems((prev) => prev.map((it) => (
      it.id === id ? {
        ...it,
        category: "someday",
        due: defaultDueForCategory("someday", dateKey),
        somedaySince: dateKey,
        resurfacedFrom: undefined,
        lastResurfaced: dateKey,
      } : it
    )));
  };
  const toggleItemTag = (id, tagId) => setItems((prev) => prev.map((it) => {
    if (it.id !== id) return it;
    const tags = it.tags || [];
    const next = tags.includes(tagId) ? tags.filter((t) => t !== tagId) : [...tags, tagId];
    return { ...it, tags: next };
  }));

  const toggleTagFilter = (tagId) => {
    setTagFilters((prev) => (prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]));
  };

  const reorder = (id, direction) => {
    setItems((prev) => {
      const cat = prev.find((it) => it.id === id)?.category;
      const catIdx = prev.map((it, i) => ({ it, i })).filter((x) => x.it.category === cat).map((x) => x.i);
      const pos = catIdx.findIndex((i) => prev[i].id === id);
      const swapPos = direction === "up" ? pos - 1 : pos + 1;
      if (swapPos < 0 || swapPos >= catIdx.length) return prev;
      const arr = [...prev];
      const i1 = catIdx[pos], i2 = catIdx[swapPos];
      [arr[i1], arr[i2]] = [arr[i2], arr[i1]];
      return arr;
    });
  };

  const submitAdd = (category) => {
    if (!addText.trim()) { setAddingTo(null); return; }
    const text = addText.trim();
    const openItems = items.filter((it) => !it.done);
    if (isDuplicateOfExisting(text, openItems)) {
      setError("That item is already on your list.");
      setAddText("");
      setAddingTo(null);
      return;
    }
    setItems((prev) => [...prev, newTask({ text, category }, dateKey)]);
    setAddText("");
    setAddingTo(null);
  };

  const addRecurring = () => {
    if (!recText.trim()) return;
    const now = new Date();
    const tmpl = {
      id: uid(),
      text: recText.trim(),
      category: recCategory,
      repeat: recRepeat,
      weekday: now.getDay(),
      createdKey: todayKey(),
    };
    const next = [...recurring, tmpl];
    setRecurring(next);
    storage.set("recurring", JSON.stringify(next)).catch(() => setError("Couldn't save recurring item."));
    setRecText("");
    if (dateKey === todayKey() && isScheduled(tmpl, dateKey) && !items.some((it) => it.recurringId === tmpl.id)) {
      setItems((prev) => [...prev, newTask({
        text: tmpl.text,
        category: tmpl.category,
        recurringId: tmpl.id,
      }, dateKey)]);
    }
  };

  const removeRecurring = (id) => {
    const next = recurring.filter((r) => r.id !== id);
    setRecurring(next);
    storage.set("recurring", JSON.stringify(next)).catch(() => setError("Couldn't save recurring item."));
  };

  const isToday = dateKey === todayKey();
  const dueSoon = isToday ? items.filter((it) => !it.done && it.due && it.due <= addDays(todayKey(), 1) && it.due !== undefined) : [];

  return (
    <div className="offload-app">
      <style>{`
        .offload-app {
          --paper: #f5f3ee; --paper-raised: #fbfaf7; --ink: #21262b; --ink-soft: #565f66; --line: #dedad0;
          --today: #2f6f62; --today-bg: #e4efec; --tomorrow: #6b5b95; --tomorrow-bg: #ece8f3;
          --week: #4a5899; --week-bg: #e8e9f3;
          --someday: #a9822a; --someday-bg: #f3ecd8; --waiting: #b0503f; --waiting-bg: #f4e6e1;
          font-family: 'IBM Plex Sans', system-ui, sans-serif; background: var(--paper); color: var(--ink);
          min-height: 100%; padding: 32px 20px 60px; box-sizing: border-box;
        }
        .offload-app * { box-sizing: border-box; }
        .offload-inner { max-width: 980px; margin: 0 auto; }
        .offload-header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; flex-wrap: wrap; gap: 10px; }
        .offload-title { font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: 34px; letter-spacing: -0.01em; margin: 0; }
        .offload-sub { color: var(--ink-soft); font-size: 14px; margin: 4px 0 22px; }
        .offload-daterow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .offload-datebtn, .offload-histbtn { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--ink-soft);
          background: var(--paper-raised); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; cursor: pointer;
          display: flex; align-items: center; gap: 6px; }
        .offload-histbtn:hover, .offload-datebtn:hover { border-color: var(--ink-soft); color: var(--ink); }
        .offload-histbtn.active { background: var(--today-bg); color: var(--today); border-color: var(--today); }

        .reminder-banner { display: flex; align-items: center; gap: 8px; background: var(--waiting-bg); color: var(--waiting);
          border-radius: 10px; padding: 10px 14px; font-size: 13px; margin-bottom: 18px; flex-wrap: wrap; }
        .reminder-banner b { font-weight: 700; }
        .carryover-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px;
          background: var(--tomorrow-bg); color: var(--tomorrow); border-radius: 10px; padding: 10px 14px;
          font-size: 13px; margin-bottom: 18px; flex-wrap: wrap; }
        .carryover-banner b { font-weight: 700; }
        .carryover-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .carryover-btn { border: 1px solid var(--tomorrow); background: var(--paper-raised); color: var(--tomorrow);
          border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; font-family: inherit; }
        .carryover-btn:hover { background: var(--paper); }
        .carry-badge { font-family: 'IBM Plex Mono', monospace; font-size: 10px; padding: 2px 6px; border-radius: 4px;
          background: var(--tomorrow-bg); color: var(--tomorrow); cursor: pointer; }
        .carry-badge:hover { opacity: 0.85; }
        .resurface-badge { font-family: 'IBM Plex Mono', monospace; font-size: 10px; padding: 2px 6px; border-radius: 4px;
          background: var(--someday-bg); color: var(--someday); cursor: pointer; }
        .resurface-badge:hover { opacity: 0.85; }
        .resurface-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px;
          background: var(--someday-bg); color: var(--someday); border-radius: 10px; padding: 10px 14px;
          font-size: 13px; margin-bottom: 18px; flex-wrap: wrap; }
        .resurface-banner b { font-weight: 700; }

        .dumpzone { background: var(--paper-raised); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin-bottom: 24px; }
        .dumpzone textarea { width: 100%; min-height: 110px; border: none; outline: none; resize: vertical;
          font-family: 'IBM Plex Sans', sans-serif; font-size: 15px; line-height: 1.55; color: var(--ink); background: transparent; }
        .dumpzone textarea::placeholder { color: #a7a196; }
        .dumpzone-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; gap: 10px; flex-wrap: wrap; }
        .dumpzone-hint { font-size: 12px; color: var(--ink-soft); flex: 1; min-width: 140px; }
        .dumpzone-hint em { font-style: normal; color: var(--ink); opacity: 0.7; }
        .dumpzone-actions { display: flex; align-items: center; gap: 8px; }
        .sort-btn { background: var(--ink); color: var(--paper); border: none; border-radius: 8px; padding: 9px 16px;
          font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 7px; }
        .sort-btn:hover:not(:disabled) { transform: translateY(-1px); }
        .sort-btn:disabled { opacity: 0.55; cursor: default; }
        .spin { animation: offload-spin 0.9s linear infinite; }
        @keyframes offload-spin { to { transform: rotate(360deg); } }

        .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
        .recur-btn { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-soft);
          background: var(--paper-raised); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; cursor: pointer; }
        .recur-btn:hover { color: var(--ink); border-color: var(--ink-soft); }
        .recur-btn.active { background: var(--today-bg); color: var(--today); border-color: var(--today); }

        .gap-filters { background: var(--paper-raised); border: 1px solid var(--line); border-radius: 12px;
          padding: 12px 14px; margin-bottom: 18px; }
        .gap-filters-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
        .gap-filters-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-soft); }
        .gap-filters-clear { border: none; background: none; font-size: 12px; color: var(--ink-soft); cursor: pointer; padding: 0; }
        .gap-filters-clear:hover { color: var(--ink); }
        .gap-filter-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .filter-chip { font-size: 12px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line);
          background: var(--paper); color: var(--ink-soft); cursor: pointer; font-family: inherit; }
        .filter-chip:hover { border-color: var(--ink-soft); color: var(--ink); }
        .filter-chip.active { background: var(--week-bg); color: var(--week); border-color: var(--week); font-weight: 600; }
        .filter-chip.time.active { background: var(--today-bg); color: var(--today); border-color: var(--today); }
        .gap-filters-hint { font-size: 11px; color: #a7a196; margin-top: 8px; }

        .energy-tag { font-family: 'IBM Plex Mono', monospace; font-size: 10px; padding: 2px 6px; border-radius: 4px;
          background: var(--paper); color: var(--ink-soft); border: 1px solid var(--line); cursor: pointer; }
        .energy-tag:hover { border-color: var(--ink-soft); color: var(--ink); }
        .energy-tag.time { background: var(--today-bg); color: var(--today); border-color: transparent; }
        .energy-tag.energy { background: var(--week-bg); color: var(--week); border-color: transparent; }
        .tag-add-select { font-size: 10px; border: 1px dashed var(--line); border-radius: 4px; background: transparent;
          color: var(--ink-soft); padding: 1px 4px; font-family: inherit; max-width: 72px; }

        .error-banner { color: var(--waiting); font-size: 13px; margin: -12px 0 18px; }

        .trays { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
        .tray { background: var(--paper-raised); border: 1px solid var(--line); border-radius: 12px; padding: 14px; min-height: 140px; }
        .tray-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .tray-title { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
        .tray-count { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft); }
        .tray-add { border: none; background: none; cursor: pointer; color: var(--ink-soft); padding: 2px; border-radius: 4px; display: flex; align-items: center; gap: 4px; font-size: 12px; }
        .tray-add:hover { color: var(--ink); background: var(--paper); }

        .item-card { padding: 8px 6px; border-radius: 8px; margin-bottom: 4px; transition: background 0.15s ease; }
        .item-card:hover { background: var(--paper); }
        .item-card.landed { animation: offload-land 0.6s ease; }
        @keyframes offload-land { 0% { transform: translateY(-10px) scale(0.9); opacity: 0; } 60% { transform: translateY(2px) scale(1.02); opacity: 1; } 100% { transform: translateY(0) scale(1); } }
        .item-row { display: flex; align-items: flex-start; gap: 8px; }
        .item-body { flex: 1; min-width: 0; }
        .item-check { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid var(--ink-soft); flex-shrink: 0;
          margin-top: 2px; cursor: pointer; display: flex; align-items: center; justify-content: center; background: var(--paper-raised); }
        .item-check.done { background: var(--ink); border-color: var(--ink); }
        .item-text { display: block; width: 100%; font-size: 14px; line-height: 1.4; border: none; background: none; outline: none;
          font-family: inherit; color: var(--ink); padding: 0; resize: none; overflow: hidden;
          white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; field-sizing: content; }
        .item-text.done { text-decoration: line-through; color: var(--ink-soft); }
        .item-actions { display: flex; align-items: center; gap: 1px; margin-top: 4px; opacity: 0; transition: opacity 0.12s ease; flex-wrap: wrap; }
        .item-card:hover .item-actions { opacity: 1; }
        .item-actions select { font-size: 11px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper-raised);
          color: var(--ink-soft); padding: 2px 3px; font-family: 'IBM Plex Mono', monospace; }
        .icon-btn { border: none; background: none; cursor: pointer; color: var(--ink-soft); padding: 3px; border-radius: 4px; display: flex; }
        .icon-btn:hover { color: var(--ink); background: var(--paper-raised); }
        .icon-btn:disabled { opacity: 0.3; cursor: default; }
        .icon-btn.danger:hover { color: var(--waiting); }
        .item-meta { display: flex; align-items: center; gap: 6px; margin: 4px 0 0 24px; flex-wrap: wrap; }
        .due-badge { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; padding: 2px 6px; border-radius: 4px;
          background: var(--week-bg); color: var(--week); cursor: pointer; }
        .due-badge.overdue { background: var(--waiting-bg); color: var(--waiting); }
        .due-input { font-size: 11px; border: 1px solid var(--line); border-radius: 5px; padding: 1px 4px; font-family: inherit; }
        .recur-badge { font-size: 10px; color: var(--ink-soft); display: flex; align-items: center; gap: 3px; }

        .add-row { display: flex; gap: 6px; margin-top: 6px; }
        .add-row input { flex: 1; font-size: 13px; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px;
          font-family: inherit; outline: none; background: var(--paper-raised); }
        .add-row button { border: none; background: var(--ink); color: var(--paper); border-radius: 6px; padding: 0 10px; cursor: pointer; font-size: 13px; }

        .empty-tray { font-size: 12px; color: #a7a196; font-style: italic; padding: 6px 6px; }

        .hist-overlay { position: fixed; inset: 0; background: rgba(33,38,43,0.35); display: flex; align-items: flex-start;
          justify-content: center; padding-top: 80px; z-index: 20; }
        .hist-panel { background: var(--paper-raised); border-radius: 12px; border: 1px solid var(--line); width: 320px;
          max-height: 60vh; overflow-y: auto; padding: 8px; }
        .hist-item { padding: 10px 12px; border-radius: 8px; cursor: pointer; font-size: 14px; display: flex; justify-content: space-between; }
        .hist-item:hover { background: var(--paper); }
        .hist-item.active { background: var(--today-bg); color: var(--today); font-weight: 600; }
        .hist-empty { padding: 16px; font-size: 13px; color: var(--ink-soft); }

        .rec-panel { background: var(--paper-raised); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 20px; }
        .rec-panel h3 { margin: 0 0 10px; font-size: 14px; }
        .rec-list-item { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
        .rec-list-item:last-of-type { border-bottom: none; }
        .rec-tag { font-size: 10px; color: var(--ink-soft); background: var(--paper); padding: 2px 6px; border-radius: 4px; }
        .rec-form { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
        .rec-form input { flex: 1; min-width: 140px; font-size: 13px; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; }
        .rec-form select { font-size: 13px; border: 1px solid var(--line); border-radius: 6px; padding: 6px; background: var(--paper-raised); }
        .rec-form button { border: none; background: var(--ink); color: var(--paper); border-radius: 6px; padding: 0 12px; cursor: pointer; font-size: 13px; }

        .prefs-panel { background: var(--paper-raised); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 20px; }
        .prefs-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .prefs-head h3 { margin: 0; font-size: 14px; display: flex; align-items: center; gap: 6px; }
        .prefs-close { border: none; background: none; cursor: pointer; color: var(--ink-soft); padding: 4px; border-radius: 4px; }
        .prefs-close:hover { color: var(--ink); background: var(--paper); }
        .prefs-desc { font-size: 12px; color: var(--ink-soft); margin: 0 0 14px; line-height: 1.45; }
        .prefs-usage { background: var(--paper); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; }
        .prefs-usage-row { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center; font-size: 12px; margin-bottom: 8px; }
        .prefs-usage-row:last-child { margin-bottom: 0; }
        .prefs-usage-val { font-family: 'IBM Plex Mono', monospace; color: var(--ink-soft); font-size: 11px; }
        .prefs-usage-bar { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; }
        .prefs-usage-fill { height: 100%; background: var(--today); border-radius: 2px; }
        .prefs-fields { display: grid; gap: 10px; margin-bottom: 14px; }
        .prefs-field { display: grid; grid-template-columns: 1fr 72px auto; gap: 8px; align-items: center; font-size: 13px; }
        .prefs-field input { font-size: 13px; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font-family: 'IBM Plex Mono', monospace; background: var(--paper-raised); }
        .prefs-unit { font-size: 11px; color: var(--ink-soft); }
        .prefs-save { border: none; background: var(--ink); color: var(--paper); border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .prefs-save:hover { opacity: 0.9; }

        .sort-nudge-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px;
          background: var(--week-bg); color: var(--week); border-radius: 10px; padding: 10px 14px;
          font-size: 13px; margin-bottom: 18px; flex-wrap: wrap; }
        .sort-nudge-banner b { font-weight: 700; }

        .week-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 12px; }
        .week-card { background: var(--paper-raised); border: 1px solid var(--line); border-radius: 12px; padding: 14px 10px; cursor: pointer; text-align: center; }
        .week-card:hover { border-color: var(--ink-soft); }
        .week-card.is-today { border-color: var(--today); }
        .week-day { font-size: 12px; color: var(--ink-soft); margin-bottom: 6px; }
        .week-date { font-family: 'Fraunces', serif; font-size: 20px; margin-bottom: 8px; }
        .week-bar { height: 5px; border-radius: 3px; background: var(--line); overflow: hidden; margin-bottom: 6px; }
        .week-bar-fill { height: 100%; background: var(--today); }
        .week-count { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft); }

        @media (max-width: 480px) { .offload-title { font-size: 27px; } }
      `}</style>

      <div className="offload-inner">
        <div className="offload-header">
          <h1 className="offload-title">Offload</h1>
          <div className="offload-daterow">
            <span className="offload-datebtn"><CalendarDays size={13} />{fmtDate(dateKey)}</span>
            <button className={`offload-histbtn ${view === "week" ? "active" : ""}`} onClick={() => setView(view === "week" ? "day" : "week")}>
              <BarChart3 size={13} />Week view
            </button>
            <button className="offload-histbtn" onClick={openHistory}><History size={13} />History</button>
          </div>
        </div>
        <p className="offload-sub">Get it out of your head. Sort it once. Let the trays hold it.</p>

        {view === "day" && sortNudge && (
          <div className="sort-nudge-banner">
            <span>
              {sortNudge.skipped > 0 && (
                <><b>{sortNudge.skipped}</b> {sortNudge.skipped === 1 ? "item" : "items"} already on your list — skipped. </>
              )}
              {sortNudge.deferred?.length > 0 && (
                <><b>{sortNudge.deferred.length}</b> moved from Today to fit your daily capacity.</>
              )}
            </span>
            <button type="button" className="carryover-btn" onClick={() => setSortNudge(null)}>Got it</button>
          </div>
        )}

        {view === "day" && resurfaceNudge && (
          <div className="resurface-banner">
            <span>
              <b>{resurfaceNudge.count}</b> Someday {resurfaceNudge.count === 1 ? "idea" : "ideas"} resurfaced
              — moved to {resurfaceNudge.items.some((i) => i.toCategory === "tomorrow") ? "Tomorrow / This Week" : "This Week"}.
              Quick wins worth revisiting.
            </span>
            <button type="button" className="carryover-btn" onClick={() => setResurfaceNudge(null)}>Got it</button>
          </div>
        )}

        {view === "day" && carryOverNudge && (
          <div className="carryover-banner">
            <span>
              <b>{carryOverNudge.count}</b> unfinished from yesterday — moved to Today.
              Finish them, reschedule with the calendar icon, or snooze to Tomorrow.
            </span>
            <div className="carryover-actions">
              <button type="button" className="carryover-btn" onClick={() => setCarryOverNudge(null)}>Got it</button>
            </div>
          </div>
        )}

        {view === "day" && dueSoon.length > 0 && (
          <div className="reminder-banner">
            <Bell size={15} />
            <span><b>{dueSoon.filter((it) => it.due <= todayKey()).length}</b> due today
              {dueSoon.some((it) => it.due > todayKey()) && <> · <b>{dueSoon.filter((it) => it.due > todayKey()).length}</b> due tomorrow</>}
            </span>
          </div>
        )}

        {view === "day" ? (
          <>
            <div className="dumpzone">
              <textarea
                placeholder="Everything on your mind, no order needed — deadlines, errands, half-formed ideas..."
                value={dump}
                onChange={(e) => setDump(e.target.value)}
              />
              <div className="dumpzone-footer">
                <span className="dumpzone-hint">
                  {dump.trim()
                    ? `${dump.trim().split(/\s+/).length} words`
                    : "Empty tray, empty head"}
                </span>
                <div className="dumpzone-actions">
                  <button
                    className="sort-btn"
                    onClick={() => sortDump()}
                    disabled={sorting || !loaded || !preferencesLoaded || !dump.trim()}
                  >
                    {sorting ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                    {sorting ? "Sorting" : "Sort it out"}
                  </button>
                </div>
              </div>
            </div>

            <div className="toolbar">
              <button className="recur-btn" onClick={() => setRecurringOpen(!recurringOpen)}>
                <Repeat size={13} />Recurring items{recurring.length > 0 ? ` (${recurring.length})` : ""}
              </button>
              <button
                className={`recur-btn ${preferencesOpen ? "active" : ""}`}
                onClick={() => setPreferencesOpen(!preferencesOpen)}
              >
                <Settings size={13} />Daily capacity
              </button>
            </div>

            {preferencesOpen && preferencesLoaded && (
              <PreferencesPanel
                preferences={preferences}
                onSave={savePreferences}
                todayItems={items}
                onClose={() => setPreferencesOpen(false)}
              />
            )}

            {recurringOpen && (
              <div className="rec-panel">
                <h3>Recurring items</h3>
                {recurring.length === 0 && <div className="empty-tray">None yet — add something that repeats, like "Check email" or "Water plants".</div>}
                {recurring.map((r) => (
                  <div className="rec-list-item" key={r.id}>
                    <span style={{ flex: 1 }}>{r.text}</span>
                    <span className="rec-tag">{CATS.find((c) => c.id === r.category)?.label}</span>
                    <span className="rec-tag">{REPEATS.find((p) => p.id === r.repeat)?.label}{r.repeat === "weekly" ? ` · ${fmtShort(dateKey).slice(0,3)}` : ""}</span>
                    <button className="icon-btn danger" onClick={() => removeRecurring(r.id)}><Trash2 size={14} /></button>
                  </div>
                ))}
                <div className="rec-form">
                  <input placeholder="New recurring item..." value={recText} onChange={(e) => setRecText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addRecurring(); }} />
                  <select value={recCategory} onChange={(e) => setRecCategory(e.target.value)}>
                    {CATS.map((c) => <option value={c.id} key={c.id}>{c.label}</option>)}
                  </select>
                  <select value={recRepeat} onChange={(e) => setRecRepeat(e.target.value)}>
                    {REPEATS.map((p) => <option value={p.id} key={p.id}>{p.label}</option>)}
                  </select>
                  <button onClick={addRecurring}>Add</button>
                </div>
              </div>
            )}

            {error && <div className="error-banner">{error}</div>}

            <div className="gap-filters">
              <div className="gap-filters-head">
                <span className="gap-filters-title"><Filter size={13} />Fit the gap</span>
                {tagFilters.length > 0 && (
                  <button type="button" className="gap-filters-clear" onClick={() => setTagFilters([])}>Clear filters</button>
                )}
              </div>
              <div className="gap-filter-chips">
                {ENERGY_TAGS.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={`filter-chip ${tag.group} ${tagFilters.includes(tag.id) ? "active" : ""}`}
                    onClick={() => toggleTagFilter(tag.id)}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
              {tagFilters.length > 0 && (
                <div className="gap-filters-hint">
                  Showing tasks tagged {tagFilters.map((id) => tagById(id)?.label).filter(Boolean).join(" or ")}
                </div>
              )}
            </div>

            <div className="trays">
              {CATS.map((cat) => {
                const allCatItems = items.filter((it) => it.category === cat.id);
                const catItems = allCatItems.filter((it) => itemMatchesTagFilters(it, tagFilters));
                const Icon = cat.icon;
                return (
                  <div className="tray" key={cat.id}>
                    <div className="tray-head">
                      <span className="tray-title" style={{ color: `var(--${cat.id})` }}><Icon size={14} />{cat.label}</span>
                      <span className="tray-count">
                        {tagFilters.length ? `${catItems.length}/${allCatItems.length}` : allCatItems.length}
                      </span>
                    </div>

                    {catItems.length === 0 && addingTo !== cat.id && (
                      <div className="empty-tray">
                        {allCatItems.length > 0 && tagFilters.length > 0 ? "No matches for this filter" : "Nothing here"}
                      </div>
                    )}

                    {catItems.map((it, idx) => {
                      const dl = dueLabel(it.due);
                      return (
                        <div className={`item-card ${justLanded[it.id] ? "landed" : ""}`} key={it.id}>
                          <div className="item-row">
                            <span className={`item-check ${it.done ? "done" : ""}`} onClick={() => toggleDone(it.id)}>
                              {it.done && <Check size={11} color="var(--paper)" />}
                            </span>
                            <div className="item-body">
                              <textarea
                                className={`item-text ${it.done ? "done" : ""}`}
                                value={it.text}
                                rows={1}
                                ref={resizeItemText}
                                onChange={(e) => {
                                  editItem(it.id, e.target.value);
                                  resizeItemText(e.target);
                                }}
                              />
                              <div className="item-actions">
                                <button className="icon-btn" disabled={idx === 0} onClick={() => reorder(it.id, "up")}><ChevronUp size={14} /></button>
                                <button className="icon-btn" disabled={idx === catItems.length - 1} onClick={() => reorder(it.id, "down")}><ChevronDown size={14} /></button>
                                <button className="icon-btn" onClick={() => setDueEditingId(dueEditingId === it.id ? null : it.id)}><Calendar size={13} /></button>
                                <select value={it.category} onChange={(e) => setCategory(it.id, e.target.value)}>
                                  {CATS.map((c) => <option value={c.id} key={c.id}>{c.label}</option>)}
                                </select>
                                <button className="icon-btn danger" onClick={() => removeItem(it.id)}><X size={14} /></button>
                              </div>
                            </div>
                          </div>
                          <div className="item-meta">
                              {dueEditingId === it.id ? (
                                <input type="date" className="due-input" value={it.due || ""}
                                  onChange={(e) => { setDue(it.id, e.target.value); }}
                                  onBlur={() => setDueEditingId(null)} autoFocus />
                              ) : dl ? (
                                <span className={`due-badge ${dl === "Overdue" ? "overdue" : ""}`} onClick={() => setDueEditingId(it.id)}>{dl}</span>
                              ) : null}
                              {it.recurringId && <span className="recur-badge"><Repeat size={11} />repeats</span>}
                              {it.carriedFrom && (
                                <span className="carry-badge" title="Snooze to Tomorrow" onClick={() => snoozeToTomorrow(it.id)}>
                                  From yesterday
                                </span>
                              )}
                              {it.resurfacedFrom === "someday" && (
                                <span className="resurface-badge" title="Back to Someday" onClick={() => returnToSomeday(it.id)}>
                                  From Someday
                                </span>
                              )}
                              {(it.tags || []).map((tagId) => {
                                const tag = tagById(tagId);
                                if (!tag) return null;
                                return (
                                  <span
                                    key={tagId}
                                    className={`energy-tag ${tag.group}`}
                                    title="Click to remove tag"
                                    onClick={() => toggleItemTag(it.id, tagId)}
                                  >
                                    {tag.label}
                                  </span>
                                );
                              })}
                              <select
                                className="tag-add-select"
                                value=""
                                onChange={(e) => { if (e.target.value) toggleItemTag(it.id, e.target.value); }}
                                title="Add tag"
                              >
                                <option value="">+ tag</option>
                                {ENERGY_TAGS.filter((t) => !(it.tags || []).includes(t.id)).map((t) => (
                                  <option key={t.id} value={t.id}>{t.label}</option>
                                ))}
                              </select>
                            </div>
                        </div>
                      );
                    })}

                    {addingTo === cat.id ? (
                      <div className="add-row">
                        <input autoFocus value={addText} onChange={(e) => setAddText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") submitAdd(cat.id); if (e.key === "Escape") { setAddingTo(null); setAddText(""); } }}
                          placeholder="Add an item..." />
                        <button onClick={() => submitAdd(cat.id)}>Add</button>
                      </div>
                    ) : (
                      <button className="tray-add" onClick={() => { setAddingTo(cat.id); setAddText(""); }}><Plus size={13} /> Add</button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div>
            {weekLoading && <div className="empty-tray">Loading week...</div>}
            {weekData && (
              <div className="week-grid">
                {weekData.map((d) => {
                  const pct = d.total > 0 ? Math.round((d.done / d.total) * 100) : 0;
                  return (
                    <div className={`week-card ${d.key === todayKey() ? "is-today" : ""}`} key={d.key}
                      onClick={() => { setDateKey(d.key); setView("day"); }}>
                      <div className="week-day">{fmtShort(d.key)}</div>
                      <div className="week-date">{dateFromKey(d.key).getDate()}</div>
                      <div className="week-bar"><div className="week-bar-fill" style={{ width: `${pct}%` }} /></div>
                      <div className="week-count">{d.done}/{d.total}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {historyOpen && (
        <div className="hist-overlay" onClick={() => setHistoryOpen(false)}>
          <div className="hist-panel" onClick={(e) => e.stopPropagation()}>
            {historyKeys.length === 0 && <div className="hist-empty">No past days saved yet.</div>}
            {historyKeys.map((k) => (
              <div className={`hist-item ${k === dateKey ? "active" : ""}`} key={k}
                onClick={() => { setDateKey(k); setView("day"); setHistoryOpen(false); }}>
                <span>{fmtDate(k)}</span>
                {k === todayKey() && <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>today</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
