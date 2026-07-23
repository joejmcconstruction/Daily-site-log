import React, { useEffect, useState } from "react";
import { ArrowLeft, Cloud, Sun, CloudDrizzle, CloudRain, Trash2, FileText, Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { prettyDate, shortTime, fileSizeLabel, DUCT_FIELDS } from "../lib/helpers";

const WEATHER_ICONS = { Sunny: Sun, Overcast: Cloud, "Light rain": CloudDrizzle, "Heavy rain": CloudRain, Showers: CloudRain };

export default function ReportDetail({ reportId, onBack, onDeleted }) {
  const [report, setReport] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: reportData } = await supabase.from("reports").select("*").eq("id", reportId).single();
      const { data: fileData } = await supabase.from("report_files").select("*").eq("report_id", reportId);
      if (cancelled) return;
      setReport(reportData);
      setFiles(
        (fileData || []).map((f) => ({
          ...f,
          publicUrl: supabase.storage.from("site-reports").getPublicUrl(f.storage_path).data.publicUrl,
        }))
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  async function handleDelete() {
    setDeleting(true);
    const paths = files.map((f) => f.storage_path);
    if (paths.length) {
      await supabase.storage.from("site-reports").remove(paths);
    }
    await supabase.from("reports").delete().eq("id", reportId); // cascades to report_files
    setDeleting(false);
    onDeleted?.();
  }

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
        <Loader2 size={22} color="var(--accent)" className="spin" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Report not found</div>
        <button className="btn-secondary" onClick={onBack} style={{ marginTop: 14 }}>
          Back to history
        </button>
      </div>
    );
  }

  const WIcon = WEATHER_ICONS[report.weather] || Cloud;
  const ductValues = DUCT_FIELDS.filter((d) => report[d.key] !== null && report[d.key] !== undefined && report[d.key] !== "");
  const photos = files.filter((f) => f.kind === "photo");
  const supportingFiles = files.filter((f) => f.kind === "supporting");

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} /> Back to history
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div className="report-row-icon" style={{ width: 38, height: 38 }}>
          <WIcon size={18} color="var(--accent-2)" />
        </div>
        <div>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 17 }}>{prettyDate(report.report_date)}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {report.weather} · Logged {shortTime(report.created_at)}
          </div>
        </div>
      </div>

      <div className="eyebrow">Staff on site</div>
      <p className="detail-text">{report.staff_on_site}</p>

      <div className="eyebrow">Work completed</div>
      <p className="detail-text">{report.description}</p>

      {ductValues.length > 0 && (
        <>
          <div className="eyebrow">Ducting & Trenching</div>
          <div
