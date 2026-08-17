import React, { useEffect, useState } from "react";
import { Check, AlertCircle, Loader2, Plus, Paperclip, User, GraduationCap, Sun } from "lucide-react";
import { supabase } from "../../supabaseClient";
import { uid } from "../../lib/helpers";
import { expiryStatus, EXPIRY_STATUS_LABEL } from "../../lib/adminHelpers";
import AdminFileUpload from "./AdminFileUpload";

function currentYear() {
  return new Date().getFullYear();
}

function dayCount(start, end) {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const s = new Date(sy, sm - 1, sd);
  const e = new Date(ey, em - 1, ed);
  return Math.round((e - s) / 86400000) + 1;
}

export default function StaffPage() {
  const [section, setSection] = useState("people");
  const [employees, setEmployees] = useState(null);
  const [trainings, setTrainings] = useState(null);
  const [holidays, setHolidays] = useState(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [empRes, trainRes, holRes] = await Promise.all([
        supabase.from("employees").select("*").order("full_name", { ascending: true }),
        supabase.from("employee_training").select("*").order("expiry_date", { ascending: true }),
        supabase.from("employee_holidays").select("*").order("start_date", { ascending: true }),
      ]);
      if (cancelled) return;
      if (empRes.error) setError(empRes.error.message);
      else setEmployees(empRes.data || []);
      if (trainRes.error) setError(trainRes.error.message);
      else setTrainings(trainRes.data || []);
      if (holRes.error) setError(holRes.error.message);
      else setHolidays(holRes.data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const employeeById = {};
  (employees || []).forEach((e) => {
    employeeById[e.id] = e;
  });

  const loading = employees === null || trainings === null || holidays === null;

  return (
    <div>
      <div className="eyebrow" style={{ marginTop: 0 }}>
        Staff
        <div className="eyebrow-sub">Employees, training records, and holidays — 5-day warning on expiring training.</div>
      </div>

      <div className="pill-row">
        <button className={`pill-btn ${section === "people" ? "active" : ""}`} onClick={() => setSection("people")}>
          <User size={13} style={{ marginRight: 5, verticalAlign: -2 }} /> People
        </button>
        <button className={`pill-btn ${section === "training" ? "active" : ""}`} onClick={() => setSection("training")}>
          <GraduationCap size={13} style={{ marginRight: 5, verticalAlign: -2 }} /> Training
        </button>
        <button className={`pill-btn ${section === "holidays" ? "active" : ""}`} onClick={() => setSection("holidays")}>
          <Sun size={13} style={{ marginRight: 5, verticalAlign: -2 }} /> Holidays
        </button>
      </div>

      {error && (
        <div className="empty-state">
          <div className="empty-state-title">Couldn't load staff data</div>
          <div>{error}</div>
        </div>
      )}

      {loading && !error && (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Loader2 size={22} color="var(--accent)" className="spin" />
        </div>
      )}

      {!loading && !error && section === "people" && (
        <PeopleSection employees={employees} onSaved={() => setRefreshKey((k) => k + 1)} />
      )}
      {!loading && !error && section === "training" && (
        <TrainingSection employees={employees} trainings={trainings} employeeById={employeeById} onSaved={() => setRefreshKey((k) => k + 1)} />
      )}
      {!loading && !error && section === "holidays" && (
        <HolidaysSection employees={employees} holidays={holidays} employeeById={employeeById} onSaved={() => setRefreshKey((k) => k + 1)} />
      )}
    </div>
  );
}

function PeopleSection({ employees, onSaved }) {
  const [form, setForm] = useState({ full_name: "", role: "", start_date: "", annual_holiday_allowance: "20", notes: "" });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: false }));
  }

  async function handleSubmit() {
    setSubmitError("");
    if (!form.full_name.trim()) {
      setErrors({ full_name: true });
      return;
    }
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error: insertError } = await supabase.from("employees").insert({
        full_name: form.full_name.trim(),
        role: form.role.trim() || null,
        start_date: form.start_date || null,
        annual_holiday_allowance: form.annual_holiday_allowance || 20,
        notes: form.notes.trim() || null,
        created_by: userData?.user?.id || null,
      });
      if (insertError) throw insertError;
      setForm({ full_name: "", role: "", start_date: "", annual_holiday_allowance: "20", notes: "" });
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 2500);
      onSaved();
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || "Something went wrong adding this employee.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {submitted && (
        <div className="banner success">
          <Check size={16} color="var(--success)" />
          <span style={{ color: "var(--text)", fontWeight: 600 }}>Employee added.</span>
        </div>
      )}
      {submitError && (
        <div className="banner error">
          <AlertCircle size={16} color="var(--danger)" />
          <span>{submitError}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {employees.length === 0 && (
          <div className="empty-state" style={{ padding: 24 }}>
            <div className="empty-state-title">No employees yet</div>
            <div>Add your first employee below.</div>
          </div>
        )}
        {employees.map((emp) => (
          <div className="record-row" key={emp.id}>
            <div className="record-row-top">
              <div className="record-row-title">{emp.full_name}</div>
              <span className="record-row-sub">{emp.annual_holiday_allowance} days/yr</span>
            </div>
            {emp.role && <div className="record-row-sub">{emp.role}</div>}
            {emp.start_date && <div className="record-row-sub">Started {emp.start_date}</div>}
          </div>
        ))}
      </div>

      <div className="eyebrow">Add an employee</div>
      <div className="field">
        <label className="label">
          Full name <span className="req">*</span>
        </label>
        <input
          className={`input ${errors.full_name ? "error" : ""}`}
          type="text"
          value={form.full_name}
          onChange={(e) => setField("full_name", e.target.value)}
        />
        {errors.full_name && <div className="hint error">Required</div>}
      </div>
      <div className="field">
        <label className="label">Role</label>
        <input className="input" type="text" placeholder="e.g. Foreman" value={form.role} onChange={(e) => setField("role", e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">Start date</label>
          <input className="input" type="date" value={form.start_date} onChange={(e) => setField("start_date", e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">Annual holiday allowance</label>
          <input
            className="input"
            type="number"
            min="0"
            step="1"
            value={form.annual_holiday_allowance}
            onChange={(e) => setField("annual_holiday_allowance", e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label className="label">Notes</label>
        <textarea className="input" rows={2} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
      </div>
      <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
        {submitting ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}
        {submitting ? "Saving..." : "Add employee"}
      </button>
    </div>
  );
}

function TrainingSection({ employees, trainings, employeeById, onSaved }) {
  const [form, setForm] = useState({ employee_id: "", training_name: "", completed_date: "", expiry_date: "", notes: "" });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: false }));
  }

  async function handleSubmit() {
    setSubmitError("");
    const newErrors = {};
    if (!form.employee_id) newErrors.employee_id = true;
    if (!form.training_name.trim()) newErrors.training_name = true;
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSubmitting(true);
    try {
      let filePath = null;
      let fileName = null;
      if (file) {
        const ext = file.name.split(".").pop();
        filePath = `training/${uid()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("admin-documents").upload(filePath, file.file, {
          contentType: file.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;
        fileName = file.name;
      }

      const { error: insertError } = await supabase.from("employee_training").insert({
        employee_id: form.employee_id,
        training_name: form.training_name.trim(),
        completed_date: form.completed_date || null,
        expiry_date: form.expiry_date || null,
        file_path: filePath,
        file_name: fileName,
        notes: form.notes.trim() || null,
      });
      if (insertError) throw insertError;

      setForm({ employee_id: "", training_name: "", completed_date: "", expiry_date: "", notes: "" });
      setFile(null);
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 2500);
      onSaved();
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || "Something went wrong saving this training record.");
    } finally {
      setSubmitting(false);
    }
  }

  async function fileUrlFor(row) {
    if (!row.file_path) return null;
    const { data } = await supabase.storage.from("admin-documents").createSignedUrl(row.file_path, 3600);
    return data?.signedUrl || null;
  }

  if (employees.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Add an employee first</div>
        <div>Training records are attached to an employee — add someone on the People tab first.</div>
      </div>
    );
  }

  return (
    <div>
      {submitted && (
        <div className="banner success">
          <Check size={16} color="var(--success)" />
          <span style={{ color: "var(--text)", fontWeight: 600 }}>Training record saved.</span>
        </div>
      )}
      {submitError && (
        <div className="banner error">
          <AlertCircle size={16} color="var(--danger)" />
          <span>{submitError}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {trainings.length === 0 && (
          <div className="empty-state" style={{ padding: 24 }}>
            <div className="empty-state-title">No training records yet</div>
            <div>Add the first one below.</div>
          </div>
        )}
        {trainings.map((row) => (
          <TrainingRow key={row.id} row={row} employeeName={employeeById[row.employee_id]?.full_name || "Unknown"} onGetFileUrl={fileUrlFor} />
        ))}
      </div>

      <div className="eyebrow">Add a training record</div>
      <div className="field">
        <label className="label">
          Employee <span className="req">*</span>
        </label>
        <select className={`input ${errors.employee_id ? "error" : ""}`} value={form.employee_id} onChange={(e) => setField("employee_id", e.target.value)}>
          <option value="">Select employee...</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.full_name}
            </option>
          ))}
        </select>
        {errors.employee_id && <div className="hint error">Required</div>}
      </div>
      <div className="field">
        <label className="label">
          Training <span className="req">*</span>
        </label>
        <input
          className={`input ${errors.training_name ? "error" : ""}`}
          type="text"
          placeholder="e.g. Manual Handling"
          value={form.training_name}
          onChange={(e) => setField("training_name", e.target.value)}
        />
        {errors.training_name && <div className="hint error">Required</div>}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">Date obtained</label>
          <input className="input" type="date" value={form.completed_date} onChange={(e) => setField("completed_date", e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">Expiry date</label>
          <input className="input" type="date" value={form.expiry_date} onChange={(e) => setField("expiry_date", e.target.value)} />
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
        {submitting ? "Saving..." : "Add training record"}
      </button>
    </div>
  );
}

function TrainingRow({ row, employeeName, onGetFileUrl }) {
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
        <div className="record-row-title">{row.training_name}</div>
        <span className={`status-badge status-${status}`}>{EXPIRY_STATUS_LABEL[status]}</span>
      </div>
      <div className="record-row-sub">{employeeName}</div>
      <div className="record-row-meta">
        <span>{row.expiry_date ? `Expires ${row.expiry_date}` : "No expiry"}</span>
        {row.file_path && (
          <button type="button" className="record-file-link" onClick={openFile} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            <Paperclip size={11} /> {row.file_name || "File"}
          </button>
        )}
      </div>
    </div>
  );
}

function HolidaysSection({ employees, holidays, employeeById, onSaved }) {
  const [form, setForm] = useState({ employee_id: "", start_date: "", end_date: "", notes: "" });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: false }));
  }

  async function handleSubmit() {
    setSubmitError("");
    const newErrors = {};
    if (!form.employee_id) newErrors.employee_id = true;
    if (!form.start_date) newErrors.start_date = true;
    if (!form.end_date) newErrors.end_date = true;
    if (form.start_date && form.end_date && form.end_date < form.start_date) newErrors.end_date = true;
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSubmitting(true);
    try {
      const { error: insertError } = await supabase.from("employee_holidays").insert({
        employee_id: form.employee_id,
        start_date: form.start_date,
        end_date: form.end_date,
        notes: form.notes.trim() || null,
      });
      if (insertError) throw insertError;
      setForm({ employee_id: "", start_date: "", end_date: "", notes: "" });
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 2500);
      onSaved();
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || "Something went wrong saving this holiday.");
    } finally {
      setSubmitting(false);
    }
  }

  if (employees.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Add an employee first</div>
        <div>Holidays are attached to an employee — add someone on the People tab first.</div>
      </div>
    );
  }

  const year = currentYear();
  const takenByEmployee = {};
  holidays.forEach((h) => {
    const [hy] = h.start_date.split("-").map(Number);
    if (hy === year) {
      takenByEmployee[h.employee_id] = (takenByEmployee[h.employee_id] || 0) + dayCount(h.start_date, h.end_date);
    }
  });

  const todayKey = new Date().toISOString().slice(0, 10);
  const upcoming = holidays.filter((h) => h.end_date >= todayKey).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const past = holidays.filter((h) => h.end_date < todayKey).sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

  return (
    <div>
      {submitted && (
        <div className="banner success">
          <Check size={16} color="var(--success)" />
          <span style={{ color: "var(--text)", fontWeight: 600 }}>Holiday saved.</span>
        </div>
      )}
      {submitError && (
        <div className="banner error">
          <AlertCircle size={16} color="var(--danger)" />
          <span>{submitError}</span>
        </div>
      )}

      <div className="eyebrow" style={{ marginTop: 0 }}>
        {year} allowance
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {employees.map((emp) => {
          const taken = takenByEmployee[emp.id] || 0;
          const remaining = (Number(emp.annual_holiday_allowance) || 0) - taken;
          return (
            <div className="record-row" key={emp.id}>
              <div className="record-row-top">
                <div className="record-row-title">{emp.full_name}</div>
                <span className="record-row-sub">
                  {taken} taken · {remaining} remaining
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="eyebrow">Coming up</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {upcoming.length === 0 && <div className="record-row-sub">Nothing booked.</div>}
        {upcoming.map((h) => (
          <div className="record-row" key={h.id}>
            <div className="record-row-top">
              <div className="record-row-title">{employeeById[h.employee_id]?.full_name || "Unknown"}</div>
              <span className="record-row-sub">{dayCount(h.start_date, h.end_date)} days</span>
            </div>
            <div className="record-row-sub">
              {h.start_date} — {h.end_date}
            </div>
            {h.notes && <div className="record-row-sub">{h.notes}</div>}
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <>
          <div className="eyebrow">Past</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {past.map((h) => (
              <div className="record-row" key={h.id} style={{ opacity: 0.7 }}>
                <div className="record-row-top">
                  <div className="record-row-title">{employeeById[h.employee_id]?.full_name || "Unknown"}</div>
                  <span className="record-row-sub">{dayCount(h.start_date, h.end_date)} days</span>
                </div>
                <div className="record-row-sub">
                  {h.start_date} — {h.end_date}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="eyebrow">Add a holiday</div>
      <div className="field">
        <label className="label">
          Employee <span className="req">*</span>
        </label>
        <select className={`input ${errors.employee_id ? "error" : ""}`} value={form.employee_id} onChange={(e) => setField("employee_id", e.target.value)}>
          <option value="">Select employee...</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.full_name}
            </option>
          ))}
        </select>
        {errors.employee_id && <div className="hint error">Required</div>}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">
            Start date <span className="req">*</span>
          </label>
          <input
            className={`input ${errors.start_date ? "error" : ""}`}
            type="date"
            value={form.start_date}
            onChange={(e) => setField("start_date", e.target.value)}
          />
          {errors.start_date && <div className="hint error">Required</div>}
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">
            End date <span className="req">*</span>
          </label>
          <input
            className={`input ${errors.end_date ? "error" : ""}`}
            type="date"
            value={form.end_date}
            onChange={(e) => setField("end_date", e.target.value)}
          />
          {errors.end_date && <div className="hint error">Must be on or after start date</div>}
        </div>
      </div>
      <div className="field">
        <label className="label">Notes</label>
        <textarea className="input" rows={2} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
      </div>
      <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
        {submitting ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}
        {submitting ? "Saving..." : "Add holiday"}
      </button>
    </div>
  );
}
