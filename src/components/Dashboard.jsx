import React, { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { dateKey } from "../lib/helpers";

const METRICS = [
  { key: "trench_excavated", label: "Trench excavated", unit: "m" },
  { key: "trench_backfilled", label: "Trench backfilled", unit: "m" },
  { key: "chambers_fitted", label: "Chambers fitted", unit: "units" },
];

function startOfWeek(d) {
  const date = new Date(d);
  const offset = (date.getDay() + 6) % 7; // days since most recent Monday
  date.setDate(date.getDate() - offset);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d, n) {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

function formatShortDate(d) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Dashboard() {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lastWeekStart = addDays(startOfWeek(new Date()), -7);
      const { data, error: fetchError } = await supabase
        .from("reports")
        .select("report_date, trench_excavated, trench_backfilled, chambers_fitted")
        .gte("report_date", dateKey(lastWeekStart));
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
      } else {
        setReports(data || []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Couldn't load dashboard</div>
        <div>{error}</div>
      </div>
    );
  }

  if (reports === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
        <Loader2 size={22} color="var(--accent)" className="spin" />
      </div>
    );
  }

  const thisWeekStart = startOfWeek(new Date());
  const lastWeekStart = addDays(thisWeekStart, -7);
  const thisWeekKey = dateKey(thisWeekStart);
  const lastWeekKey = dateKey(lastWeekStart);

  const totals = { thisWeek: {}, lastWeek: {} };
  METRICS.forEach((m) => {
    totals.thisWeek[m.key] = 0;
    totals.lastWeek[m.key] = 0;
  });

  reports.forEach((r) => {
    const bucket = r.report_date >= thisWeekKey ? "thisWeek" : r.report_date >= lastWeekKey ? "lastWeek" : null;
    if (!bucket) return;
    METRICS.forEach((m) => {
      totals[bucket][m.key] += Number(r[m.key]) || 0;
    });
  });

  return (
    <div>
      <div className="eyebrow" style={{ marginTop: 0 }}>
        This Week vs Last Week
        <div className="eyebrow-sub">
          Week of {formatShortDate(thisWeekStart)} (to date) vs week of {formatShortDate(lastWeekStart)}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {METRICS.map((m) => {
          const cur = totals.thisWeek[m.key];
          const prev = totals.lastWeek[m.key];
          const diff = cur - prev;
          const pct = prev > 0 ? Math.round((diff / prev) * 100) : cur > 0 ? 100 : 0;
          const Trend = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
          const trendColor = diff > 0 ? "var(--success)" : diff < 0 ? "var(--danger)" : "var(--text-muted)";
          return (
            <div className="card" key={m.key}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, fontWeight: 600 }}>{m.label}</div>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1 }}>
                    {cur}
                    <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 400 }}> {m.unit}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    Last week: {prev} {m.unit}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, color: trendColor, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                  <Trend size={15} />
                  {diff === 0 ? "No change" : `${diff > 0 ? "+" : ""}${diff} (${pct > 0 ? "+" : ""}${pct}%)`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
