import { useEffect, useState } from "react";
import { Settings, X } from "lucide-react";
import {
  BUCKET_LABELS,
  ENERGY_BUCKETS,
  computeCapacitySnapshot,
  normalizePreferences,
} from "../../shared/preferences.js";

export default function PreferencesPanel({
  preferences,
  onSave,
  todayItems,
  onClose,
}) {
  const [draft, setDraft] = useState(() => normalizePreferences(preferences));

  useEffect(() => {
    setDraft(normalizePreferences(preferences));
  }, [preferences]);

  const prefs = draft;
  const snapshot = computeCapacitySnapshot(
    todayItems.filter((it) => !it.done),
    prefs
  );

  const setMinutes = (bucket, value) => {
    const n = parseInt(value, 10);
    if (Number.isNaN(n) || n < 0) return;
    setDraft((prev) => ({
      ...prev,
      dailyMinutes: { ...prev.dailyMinutes, [bucket]: n },
    }));
  };

  const setMaxToday = (value) => {
    const n = parseInt(value, 10);
    if (Number.isNaN(n) || n < 1) return;
    setDraft((prev) => ({ ...prev, maxTodayItems: n }));
  };

  const handleSave = () => {
    void onSave(prefs);
  };

  return (
    <div className="prefs-panel">
      <div className="prefs-head">
        <h3><Settings size={14} /> Daily capacity</h3>
        <button type="button" className="prefs-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <p className="prefs-desc">
        How much time you can realistically spend on each type of work per day.
        New dumps respect these limits when sorting into Today.
      </p>

      <div className="prefs-usage">
        <div className="prefs-usage-row">
          <span>Today tray</span>
          <span className="prefs-usage-val">
            {snapshot.todayCount}/{prefs.maxTodayItems} items
          </span>
        </div>
        {ENERGY_BUCKETS.map((bucket) => {
          const used = snapshot.used[bucket];
          const limit = prefs.dailyMinutes[bucket];
          const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
          return (
            <div className="prefs-usage-row" key={bucket}>
              <span>{BUCKET_LABELS[bucket]}</span>
              <span className="prefs-usage-val">{used}/{limit} min</span>
              <div className="prefs-usage-bar">
                <div className="prefs-usage-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="prefs-fields">
        {ENERGY_BUCKETS.map((bucket) => (
          <label className="prefs-field" key={bucket}>
            <span>{BUCKET_LABELS[bucket]}</span>
            <input
              type="number"
              min={0}
              step={15}
              value={prefs.dailyMinutes[bucket]}
              onChange={(e) => setMinutes(bucket, e.target.value)}
            />
            <span className="prefs-unit">min/day</span>
          </label>
        ))}
        <label className="prefs-field">
          <span>Max Today items</span>
          <input
            type="number"
            min={1}
            step={1}
            value={prefs.maxTodayItems}
            onChange={(e) => setMaxToday(e.target.value)}
          />
          <span className="prefs-unit">items</span>
        </label>
      </div>

      <button type="button" className="prefs-save" onClick={handleSave}>
        Save preferences
      </button>
    </div>
  );
}
