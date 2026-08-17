import React, { useEffect, useState } from "react";
import { Check, AlertCircle, Loader2, Plus, Paperclip, Wrench, Truck } from "lucide-react";
import { supabase } from "../../supabaseClient";
import { MACHINE_OPTIONS, uid } from "../../lib/helpers";
import { VEHICLE_CERT_TYPES, expiryStatus, EXPIRY_STATUS_LABEL } from "../../lib/adminHelpers";
import AdminFileUpload from "./AdminFileUpload";

const emptyForm = () => ({
  subject_name: "",
  cert_type: "",
  cert_type_other: "",
  issue_date: "",
  expiry_date: "",
  notes: "",
});

export default function CertsPage() {
  const [section, setSection] = useState("machine");
  const [certs, setCerts] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [file, setFile] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data, error: fetchError } = await supabase.from("compliance_certs").select("*").order("expiry_date", { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setCerts(data || []);
    }
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (formErrors[key]) setFormErrors((e) => ({ ...e, [key]: false }));
  }

  function resetForm() {
    setForm(emptyForm());
    setFile(null);
    setFormErrors({});
  }

  function validate() {
    const errors = {};
    if (!form.subject_name.trim()) errors.subject_name = true;
    if (!form.cert_type) errors.cert_type = true;
    if (form.cert_type === "Other" && !form.cert_type_other.trim()) errors.cert_type_other = true;
    if (!form.expiry_date) errors.expiry_date = true;
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    setSubmitError("");
    if (!validate()) return;
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      let filePath = null;
      let fileName = null;
      if (file) {
        const ext = file.name.split(".").pop();
        filePath = `certs/${uid()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("admin-documents").upload(filePath, file.file, {
          contentType: file.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;
        fileName = file.name;
      }

      const payload = {
        category: section,
        subject_name: form.subject_name.trim(),
        cert_type: form.cert_type === "Other" ? form.cert_type_other.trim() : form.cert_type,
        issue_date: form.issue_date || null,
        expiry_date: form.expiry_date,
        file_path: filePath,
        file_name: fileName,
        notes: form.notes.trim() || null,
        created_by: userData?.user?.id || null,
      };

      const { error: insertError } = await supabase.from("compliance_certs").insert(payload);
      if (insertError) throw insertError;

      resetForm();
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 2500);
      load();
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || "Something went wrong saving this cert.");
    } finally {
      setSubmitting(false);
    }
  }

  async function fileUrlFor(row) {
    if (!row.file_path) return null;
    const { data } = await supabase.storage.from("admin-documents").createSignedUrl(row.file_path, 3600);
    return data?.signedUrl || null;
  }

  const sectionCerts = (certs || []).filter((c) => c.category === section);

  return (
    <div>
      <div className="eyebrow" style={{ marginTop: 0 }}>
        Certs &amp; Compliance
        <div className="eyebrow-sub">Plant machinery and road vehicle certificates, with a 5-day expiry warning.</div>
      </div>

      <div className="pill-row">
        <button className={`pill-btn ${section === "machine" ? "active" : ""}`} onClick={() => setSection("machine")}>
          <Wrench size={13} style={{ marginRight: 5, verticalAlign: -2 }} /> Plant Machinery
        </button>
        <button className={`pill-btn ${section === "vehicle" ? "active" : ""}`} onClick={() => setSection("vehicle")}>
          <Truck size={13} style={{ marginRight: 5, verticalAlign: -2 }} /> Road Vehicles
        </button>
      </div>

      {submitted && (
        <div className="banner success">
          <Check size={16} color="var(--success)" />
          <span style={{ color: "var(--text)", fontWeight: 600 }}>Cert saved.</span>
        </div>
      )}
      {submitError && (
        <div className="banner error">
          <AlertCircle size={16} color="var(--danger)" />
          <span>{submitError}</span>
        </div>
      )}
      {error && (
        <div className="empty-state">
          <div className="empty-state-title">Couldn't load certs</div>
          <div>{error}</div>
        </div>
      )}

      {certs === null && !error && (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Loader2 size={22} color="var(--accent)" className="spin" />
        </div>
      )}

      {certs !== null && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {sectionCerts.length === 0 && (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-state-title">No {section === "machine" ? "machine" : "vehicle"} certs yet</div>
                <div>Add the first one below.</div>
              </div>
            )}
            {sectionCerts.map((row) => (
              <CertRow key={row.id} row={row} onGetFileUrl={fileUrlFor} />
            ))}
          </div>

          <div className="eyebrow">Add a {section === "machine" ? "machine" : "vehicle"} cert</div>

          <div className="field">
            <label className="label">
              {section === "machine" ? "Machine" : "Vehicle registration"} <span className="req">*</span>
            </label>
            {section === "machine" ? (
              <select
                className={`input ${formErrors.subject_name ? "error" : ""}`}
                value={form.subject_name}
                onChange={(e) => setField("subject_name", e.target.value)}
              >
                <option value="">Select machine...</option>
                {MACHINE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={`input ${formErrors.subject_name ? "error" : ""}`}
                type="text"
                placeholder="e.g. 191-D-12345"
                value={form.subject_name}
                onChange={(e) => setField("subject_name", e.target.value)}
              />
            )}
            {formErrors.subject_name && <div className="hint error">Required</div>}
          </div>

          <div className="field">
            <label className="label">
              Cert type <span className="req">*</span>
            </label>
            {section === "machine" ? (
              <input
                className={`input ${formErrors.cert_type ? "error" : ""}`}
                type="text"
                placeholder="e.g. GA1"
                value={form.cert_type}
                onChange={(e) => setField("cert_type", e.target.value)}
              />
            ) : (
              <select
                className={`input ${formErrors.cert_type ? "error" : ""}`}
                value={form.cert_type}
                onChange={(e) => setField("cert_type", e.target.value)}
              >
                <option value="">Select type...</option>
                {VEHICLE_CERT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                <option value="Other">Other</option>
              </select>
            )}
            {formErrors.cert_type && <div className="hint error">Required</div>}
          </div>

          {section === "vehicle" && form.cert_type === "Other" && (
            <div className="field">
              <label className="label">
                Custom cert type <span className="req">*</span>
              </label>
              <input
                className={`input ${formErrors.cert_type_other ? "error" : ""}`}
                type="text"
                placeholder="e.g. CVRT"
                value={form.cert_type_other}
                onChange={(e) => setField("cert_type_other", e.target.value)}
              />
              {formErrors.cert_type_other && <div className="hint error">Required</div>}
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="label">Date obtained</label>
              <input className="input" type="date" value={form.issue_date} onChange={(e) => setField("issue_date", e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="label">
                Expiry date <span className="req">*</span>
              </label>
              <input
                className={`input ${formErrors.expiry_date ? "error" : ""}`}
                type="date"
                value={form.expiry_date}
                onChange={(e) => setField("expiry_date", e.target.value)}
              />
              {formErrors.expiry_date && <div className="hint error">Required</div>}
            </div>
          </div>

          <div className="field">
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
          </div>

          <div className="field">
            <label className="label">Cert photo / file</label>
            <AdminFileUpload value={file} onChange={setFile} />
          </div>

          <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}
            {submitting ? "Saving..." : "Add cert"}
          </button>
        </>
      )}
    </div>
  );
}

function CertRow({ row, onGetFileUrl }) {
  const [fileUrl, setFileUrl] = useState(null);
  const status = expiryStatus(row.expiry_date);

  async function openFile() {
    if (fileUrl) {
      window.open(fileUrl, "_blank", "noreferrer");
      return;
    }
    const url = await onGetFileUrl(row);
    if (url) {
      setFileUrl(url);
      window.open(url, "_blank", "noreferrer");
    }
  }

  return (
    <div className="record-row">
      <div className="record-row-top">
        <div className="record-row-title">{row.subject_name}</div>
        <span className={`status-badge status-${status}`}>{EXPIRY_STATUS_LABEL[status]}</span>
      </div>
      <div className="record-row-sub">{row.cert_type}</div>
      <div className="record-row-meta">
        <span>Expires {row.expiry_date}</span>
        {row.file_path && (
          <button type="button" className="record-file-link" onClick={openFile} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            <Paperclip size={11} /> {row.file_name || "File"}
          </button>
        )}
      </div>
      {row.notes && <div className="record-row-sub">{row.notes}</div>}
    </div>
  );
}
