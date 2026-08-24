import React, { useEffect, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  AlertCircle,
  Layers,
  PackageCheck,
  Boxes,
  Sun,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Droplets,
} from "lucide-react";
import { supabase } from "../supabaseClient";
import { dateKey, SITE_LOCATION } from "../lib/helpers";
import logo from "../assets/logo.png";

const METRICS = [
  { key: "trench_excavated", label: "Trench excavated", unit: "m", icon: Layers, color: "var(--accent)", bg: "rgba(22, 38, 77, 0.1)" },
  { key: "trench_backfilled", label: "Trench backfilled", unit: "m", icon: PackageCheck, color: "var(--accent-2)", bg: "rgba(184, 134, 44, 0.14)" },
  { key: "chambers_fitted", label: "Chambers fitted", unit: "units", icon: Boxes, color: "var(--success)", bg: "rgba(76, 154, 106, 0.16)" },
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

function weatherInfo(code) {
  if (code === 0 || code === 1) return { Icon: Sun, label: "Clear" };
  if (code === 2) return { Icon: Cloud, label: "Partly cloudy" };
  if (code === 3) return { Icon: Cloud, label: "Overcast" };
  if (code === 45 || code === 48) return { Icon: CloudFog, label: "Fog" };
  if (code >= 51 && code <= 57) return { Icon: CloudDrizzle, label: "Drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { Icon: CloudRain, label: "Rain" };
  if (code >= 71 && code <= 77) return { Icon: CloudSnow, label: "Snow" };
  if (code >= 95) return { Icon: CloudLightning, label: "Storm" };
  return { Icon: Cloud, label: "—" };
}

export default function Dashboard() {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState("");
  const [forecast, setForecast] = useState(null);
  const [forecastError, setForecastError] = useState("");

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${SITE_LOCATION.lat}&longitude=${SITE_LOCATION.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=5`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Forecast request failed");
        const json = await res.json();
        if (cancelled) return;
        setForecast(json.daily);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setForecastError("Couldn't load forecast");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const thisWeekStart = startOfWeek(new Date());
  const lastWeekStart = addDays(thisWeekStart, -7);
  const thisWeekKey = dateKey(thisWeekStart);
  const lastWeekKey = dateKey(lastWeekStart);

  const totals = { thisWeek: {}, lastWeek: {} };
  METRICS.forEach((m) => {
    totals.thisWeek[m.key] = 0;
    totals.lastWeek[m.key] = 0;
  });
  (reports || []).forEach((r) => {
    const bucket = r.report_date >= thisWeekKey ? "thisWeek" : r.report_date >= lastWeekKey ? "lastWeek" : null;
    if (!bucket) return;
    METRICS.forEach((m) => {
      totals[bucket][m.key] += Number(r[m.key]) || 0;
    });
  });

  return (
    <div>
      <div className="dashboard-header">
        <img src={logo} alt="Company logo" className="dashboard-logo" />
        <div className="dashboard-header-text">
          <div className="dashboard-header-title">Site Dashboard</div>
          <div className="dashboard-header-sub">{SITE_LOCATION.label}</div>
        </div>
      </div>

      <div className="eyebrow" style={{ marginTop: 0 }}>
        Weather Forecast
      </div>
      {forecastError && (
        <div className="hint error" style={{ marginBottom: 8 }}>
          <AlertCircle size={13} /> {forecastError}
        </div>
      )}
      {!forecast && !forecastError && (
        <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
          <Loader2 size={18} color="var(--accent)" className="spin" />
        </div>
      )}
      {forecast && (
        <div className="weather-strip">
          {forecast.time.map((date, i) => {
            const { Icon, label } = weatherInfo(forecast.weather_code[i]);
            const isToday = i === 0;
            return (
              <div key={date} className={`weather-day ${isToday ? "today" : ""}`}>
                <div className="weather-day-label">{isToday ? "Today" : new Date(date).toLocaleDateString(undefined, { weekday: "short" })}</div>
                <Icon size={22} color="var(--accent-2)" aria-label={label} />
                <div className="weather-day-temp">
                  {Math.round(forecast.temperature_2m_max[i])}°
                  <span className="weather-day-temp-lo"> / {Math.round(forecast.temperature_2m_min[i])}°</span>
                </div>
                <div className="weather-day-rain">
                  <Droplets size={11} /> {forecast.precipitation_probability_max[i]}%
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="eyebrow">
        This Week vs Last Week
        <div className="eyebrow-sub">
          Week of {formatShortDate(thisWeekStart)} (to date) vs week of {formatShortDate(lastWeekStart)}
        </div>
      </div>

      {error && (
        <div className="empty-state">
          <div className="empty-state-title">Couldn't load dashboard</div>
          <div>{error}</div>
        </div>
      )}

      {!error && reports === null && (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Loader2 size={22} color="var(--accent)" className="spin" />
        </div>
      )}

      {!error && reports !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {METRICS.map((m) => {
            const cur = totals.thisWeek[m.key];
            const prev = totals.lastWeek[m.key];
            const diff = cur - prev;
            const pct = prev > 0 ? Math.round((diff / prev) * 100) : cur > 0 ? 100 : 0;
            const Trend = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
            const trendColor = diff > 0 ? "var(--success)" : diff < 0 ? "var(--danger)" : "var(--text-muted)";
            const maxVal = Math.max(cur, prev, 1);
            const Icon = m.icon;
            return (
              <div className="stat-card" key={m.key}>
                <div className="stat-card-head">
                  <div className="stat-icon" style={{ background: m.bg }}>
                    <Icon size={16} color={m.color} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{m.label}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, color: trendColor, fontWeight: 700, fontSize: 12.5 }}>
                    <Trend size={14} />
                    {diff === 0 ? "No change" : `${diff > 0 ? "+" : ""}${diff} (${pct > 0 ? "+" : ""}${pct}%)`}
                  </div>
                </div>

                <div className="stat-bar-row">
                  <div className="stat-bar-label">This wk</div>
                  <div className="stat-bar-track">
                    <div className="stat-bar-fill" style={{ width: `${(cur / maxVal) * 100}%`, background: m.color }} />
                  </div>
                  <div className="stat-bar-value">
                    {cur} {m.unit}
                  </div>
                </div>
                <div className="stat-bar-row">
                  <div className="stat-bar-label">Last wk</div>
                  <div className="stat-bar-track">
                    <div className="stat-bar-fill" style={{ width: `${(prev / maxVal) * 100}%`, background: "var(--text-muted)" }} />
                  </div>
                  <div className="stat-bar-value">
                    {prev} {m.unit}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
