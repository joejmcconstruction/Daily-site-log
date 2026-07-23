import React, { useEffect, useState } from "react";
import { CalendarDays, Cloud, Sun, CloudDrizzle, CloudRain, Image as ImageIcon, Paperclip, Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { prettyDate, shortTime } from "../lib/helpers";

const WEATHER_ICONS = { Sunny: Sun, Overcast: Cloud, "Light rain": CloudDrizzle, "Heavy rain": CloudRain, Showers: CloudRain };

export default function HistoryList({ onOpen, refreshKey }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from("reports")
        .select("id, report_date, created_at, weather, staff_on_site, description, report_files(kind)")
        .order("report_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
      } else {
        setReports(data || []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
        <Loader2 size={22} color="var(--accent)" className="spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Couldn't load reports</div>
        <div>{error}</div>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="empty-state">
        <CalendarDays size={30} strokeWidth={1.5} />
        <div className="empty-state-title">No reports yet</div>
        <div>Submitted daily reports will show up here for you to look back on.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="eyebrow" style={{ marginTop: 0 }}>
        Submitted Reports
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {reports.map((r) => {
          const WIcon = WEATHER_ICONS[r.weather] || Cloud;
          const photoCount = r.report_files?.filter((f) => f.kind === "photo").length || 0;
          const fileCount = r.report_files?.filter((f) => f.kind === "supporting").length || 0;
          return (
            <button key={r.id} className="report-row" onClick={() => onOpen(r.id)}>
              <div className="report-row-icon">
                <WIcon size={16} color="var(--accent-2)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5, fontFamily: "'IBM Plex Mono', monospace" }}>{prettyDate(r.report_date)}</span>
                  <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{shortTime(r.created_at)}</span>
                </div>
                <div className="report-row-desc">{r.description}</div>
                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  {photoCount > 0 && (
                    <span style={{ fontSize: 11, color: "var(--accent)", display: "flex", alignItems: "center", gap: 3 }}>
                      <ImageIcon size={11} /> {photoCount}
                    </span>
                  )}
                  {fileCount > 0 && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 3 }}>
                      <Paperclip size={11} /> {fileCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
