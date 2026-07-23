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
          <div className="duct-grid">
            {ductValues.map((d) => (
              <div className="card" key={d.key}>
                <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 3 }}>{d.label}</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 15, color: "var(--accent-2)" }}>
                  {report[d.key]} <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{d.unit}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {report.cause_of_delays && (
        <>
          <div className="eyebrow">Cause of delays</div>
          <p className="detail-text">{report.cause_of_delays}</p>
        </>
      )}
      {report.additional_work && (
        <>
          <div className="eyebrow">Additional work / variation</div>
          <p className="detail-text">{report.additional_work}</p>
        </>
      )}

      {photos.length > 0 && (
        <>
          <div className="eyebrow">Photos of work completed</div>
          <div className="photo-grid">
            {photos.map((p) => (
              <a key={p.id} href={p.publicUrl} target="_blank" rel="noreferrer">
                <img src={p.publicUrl} alt={p.file_name} />
              </a>
            ))}
          </div>
        </>
      )}

      {supportingFiles.length > 0 && (
        <>
          <div className="eyebrow">Supporting files</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {supportingFiles.map((f) => (
              <a
                key={f.id}
                href={f.publicUrl}
                target="_blank"
                rel="noreferrer"
                style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 11px", textDecoration: "none" }}
              >
                <FileText size={14} color="var(--accent)" />
                <span style={{ fontSize: 12.5, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name}</span>
                <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{fileSizeLabel(f.file_size)}</span>
              </a>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 26 }}>
        {!confirmingDelete ? (
          <button className="btn-secondary btn-danger-outline" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={15} /> Delete report
          </button>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
            <button className="btn-primary btn-danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 size={16} className="spin" /> : null}
              {deleting ? "Deleting..." : "Confirm delete"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
