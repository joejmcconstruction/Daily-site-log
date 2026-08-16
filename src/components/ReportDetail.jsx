import React, { useEffect, useState } from "react";
import { ArrowLeft, Cloud, Sun, CloudDrizzle, CloudRain, Trash2, FileText, Loader2, Wrench } from "lucide-react";
import { supabase } from "../supabaseClient";
import { prettyDate, shortTime, fileSizeLabel, DUCT_FIELDS } from "../lib/helpers";

const WEATHER_ICONS = { Sunny: Sun, Overcast: Cloud, "Light rain": CloudDrizzle, "Heavy rain": CloudRain, Showers: CloudRain };

export default function ReportDetail({ reportId, onBack, onDeleted }) {
  const [report, setReport] = useState(null);
  const [files, setFiles] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: reportData } = await supabase.from("reports").select("*").eq("id", reportId).single();
      const { data: fileData } = await supabase.from("report_files").select("*").eq("report_id", reportId);
      const { data: machineData } = await supabase.from("machine_hours").select("*").eq("report_id", reportId);
      if (cancelled) return;
      setReport(reportData);
      setMachines(machineData || []);
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
    await supabase.from("reports").delete().eq("id", reportId);
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

      {report.project_name && <div className="project-badge">{report.project_name}</div>}

      <div className="eyebrow">Staff on site</div>
      <p className="detail-text">{report.staff_on_site}</p>
      {report.labour_hours != null && (
        <p className="detail-text" style={{ color: "var(--text-muted)", fontSize: 12.5 }}>
          {report.labour_hours} total labour hours
        </p>
      )}

      <div className="eyebrow">Work completed</div>
      <p className="detail-text">{report.description}</p>

      {ductValues.length > 0 && (
        <>
          <div className="eyebrow">Ducting &amp; Trenching</div>
          <div className="duct-grid">
            {ductValues.map((d) => (
              <div className="card" key={d.key}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>{d.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>
                  {report[d.key]}
                  {d.unit && <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}> {d.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {machines.length > 0 && (
        <>
          <div className="eyebrow">Plant / Machine Hours</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {machines.map((m) => (
              <div className="card" key={m.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Wrench size={15} color="var(--accent-2)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{m.machine_name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Driver: {m.driver_name}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>{m.hours}h</div>
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
          <div className="eyebrow">Variations / additional work</div>
          <p className="detail-text">{report.additional_work}</p>
        </>
      )}

      {photos.length > 0 && (
        <>
          <div className="eyebrow">Photos</div>
          <div className="photo-grid">
            {photos.map((f) => (
              <a key={f.id} href={f.publicUrl} target="_blank" rel="noreferrer">
                <img src={f.publicUrl} alt={f.file_name} />
              </a>
            ))}
          </div>
        </>
      )}

      {supportingFiles.length > 0 && (
        <>
          <div className="eyebrow">Supporting files</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {supportingFiles.map((f) => (
              <a key={f.id} href={f.publicUrl} target="_blank" rel="noreferrer" className="card" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "var(--text)" }}>
                <FileText size={16} color="var(--text-muted)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.file_name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fileSizeLabel(f.file_size)}</div>
                </div>
              </a>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 28 }}>
        {!confirmingDelete ? (
          <button className="btn-secondary btn-danger-outline" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={15} /> Delete report
          </button>
        ) : (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13 }}>Delete this report and all its files? This can't be undone.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn-secondary btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                {deleting ? "Deleting..." : "Confirm delete"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
