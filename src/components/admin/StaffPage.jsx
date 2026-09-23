import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  AlertCircle,
  Loader2,
  Plus,
  Paperclip,
  GraduationCap,
  Sun,
  ChevronDown,
  ChevronUp,
  Trash2,
  Pencil,
  ShieldCheck,
  HardHat,
  Truck,
  HeartPulse,
  Award,
  X,
  Clock,
  Mail,
} from "lucide-react";
import { supabase } from "../../supabaseClient";
import { uid, dateKey, prettyDate, PROJECT_OPTIONS } from "../../lib/helpers";
import { syncExcelExport } from "../../lib/exportExcel";
import {
  expiryStatus,
  EXPIRY_STATUS_LABEL,
  CERT_TYPES,
  CERT_TYPE_BY_KEY,
  certTypeOf,
  certLabel,
  shortDate,
  addYears,
  coreCertSummary,
} from "../../lib/adminHelpers";
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

const CERT_ICON = {
  safe_pass: ShieldCheck,
  manual_handling: HardHat,
  cscs: Truck,
  first_aid: HeartPulse,
  other: Award,
};

export default function StaffPage() {
  const [section, setSection] = useState("staff");
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
      <div className="subtabs">
        <button type="button" className={`subtab ${section === "staff" ? "active" : ""}`} onClick={() => setSection("staff")}>
          <GraduationCap size={15} />
          <span>Staff &amp; certs</span>
        </button>
        <button type="button" className={`subtab ${section === "holidays" ? "active" : ""}`} onClick={() => setSection("holidays")}>
          <Sun size={15} />
          <span>Holidays</span>
        </button>
        <button type="button" className={`subtab ${section === "hours" ? "active" : ""}`} onClick={() => setSection("hours")}>
          <Clock size={15} />
          <span>Hours</span>
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

      {!loading && !error && section === "staff" && (
        <StaffRecordsSection employees={employees} trainings={trainings} onSaved={() => setRefreshKey((k) => k + 1)} />
      )}
      {!loading && !error && section === "holidays" && (
        <HolidaysSection employees={employees} holidays={holidays} employeeById={employeeById} onSaved={() => setRefreshKey((k) => k + 1)} />
      )}
      {!loading && !error && section === "hours" && <HoursSection employees={employees} />}
    </div>
  );
}

// ---------- Staff & certs ----------

function StaffRecordsSection({ employees, trainings, onSaved }) {
  const [openId, setOpenId] = useState(null);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [banner, setBanner] = useState(null);

  function flash(type, text) {
    setBanner({ type, text });
    window.setTimeout(() => setBanner(null), 3000);
  }

  // Who needs a course booked: expired or due-soon on any cert, or missing a
  // core card altogether.
  const attention = useMemo(() => {
    const items = [];
    employees.forEach((emp) => {
      const rows = trainings.filter((t) => t.employee_id === emp.id);
      coreCertSummary(rows).forEach((c) => {
        if (c.status === "missing") items.push({ emp, text: `no ${c.type.label}`, level: "missing" });
        else if (c.status === "expired") items.push({ emp, text: `${c.type.label} expired ${shortDate(c.row.expiry_date)}`, level: "expired" });
        else if (c.status === "due-soon") items.push({ emp, text: `${c.type.label} due ${shortDate(c.row.expiry_date)}`, level: "due-soon" });
      });
      rows
        .filter((r) => !CERT_TYPE_BY_KEY[certTypeOf(r)]?.core)
        .forEach((r) => {
          const s = expiryStatus(r.expiry_date);
          if (s === "expired") items.push({ emp, text: `${certLabel(r)} expired ${shortDate(r.expiry_date)}`, level: "expired" });
          if (s === "due-soon") items.push({ emp, text: `${certLabel(r)} due ${shortDate(r.expiry_date)}`, level: "due-soon" });
        });
    });
    const order = { expired: 0, "due-soon": 1, missing: 2 };
    return items.sort((a, b) => order[a.level] - order[b.level]);
  }, [employees, trainings]);

  return (
    <div>
      {banner && (
        <div className={`banner ${banner.type}`}>
          {banner.type === "success" ? <Check size={16} color="var(--success)" /> : <AlertCircle size={16} color="var(--danger)" />}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{banner.text}</span>
        </div>
      )}

      {attention.length > 0 && (
        <div className="attention card">
          <div className="attention-title">Needs attention</div>
          {attention.map((a, i) => (
            <button
              key={`${a.emp.id}-${i}`}
              type="button"
              className="attention-row"
              onClick={() => setOpenId(a.emp.id)}
            >
              <span className={`attention-dot ${a.level}`} />
              <span className="attention-name">{a.emp.full_name}</span>
              <span className="attention-text">{a.text}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {employees.length === 0 && (
          <div className="empty-state" style={{ padding: 24 }}>
            <div className="empty-state-title">No staff yet</div>
            <div>Add the first person below.</div>
          </div>
        )}
        {employees.map((emp) => (
          <EmployeeCard
            key={emp.id}
            employee={emp}
            certs={trainings.filter((t) => t.employee_id === emp.id)}
            open={openId === emp.id}
            onToggle={() => setOpenId(openId === emp.id ? null : emp.id)}
            onSaved={onSaved}
            onFlash={flash}
          />
        ))}
      </div>

      {showAddEmployee ? (
        <AddEmployeeForm
          onCancel={() => setShowAddEmployee(false)}
          onSaved={() => {
            setShowAddEmployee(false);
            flash("success", "Employee added.");
            onSaved();
          }}
        />
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setShowAddEmployee(true)}>
          <Plus size={15} /> Add an employee
        </button>
      )}
    </div>
  );
}

function CertChip({ summary }) {
  const { type, row, count, status } = summary;
  if (status === "missing") {
    return <span className="cert-chip missing">{type.short}</span>;
  }
  const when = row.expiry_date ? shortDate(row.expiry_date) : "no expiry";
  const label = status === "expired" ? "expired" : when;
  return (
    <span className={`cert-chip ${status}`}>
      {type.short}
      {count > 1 ? ` ×${count}` : ""} · {label}
    </span>
  );
}

function EmployeeCard({ employee, certs, open, onToggle, onSaved, onFlash }) {
  const [adding, setAdding] = useState(null); // cert type key being added, or null
  const [editingId, setEditingId] = useState(null);
  const summary = coreCertSummary(certs);
  const sorted = [...certs].sort((a, b) => {
    const ta = CERT_TYPES.findIndex((t) => t.key === certTypeOf(a));
    const tb = CERT_TYPES.findIndex((t) => t.key === certTypeOf(b));
    if (ta !== tb) return ta - tb;
    return (a.expiry_date || "") < (b.expiry_date || "") ? -1 : 1;
  });

  return (
    <div className="card" style={{ padding: 0 }}>
      <button type="button" className="delivery-row" onClick={onToggle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="delivery-row-title">
            <span>{employee.full_name}</span>
            {employee.role && <span className="delivery-row-sub" style={{ marginTop: 0 }}>{employee.role}</span>}
          </div>
          <div className="cert-chips">
            {summary.map((s) => (
              <CertChip key={s.type.key} summary={s} />
            ))}
            {certs.filter((c) => !CERT_TYPE_BY_KEY[certTypeOf(c)]?.core).length > 0 && (
              <span className="cert-chip other">+{certs.filter((c) => !CERT_TYPE_BY_KEY[certTypeOf(c)]?.core).length} more</span>
            )}
          </div>
        </div>
        {open ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
      </button>

      {open && (
        <div className="delivery-edit">
          {sorted.length === 0 && <div className="record-row-sub" style={{ marginBottom: 10 }}>No certs on file yet.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {sorted.map((row) =>
              editingId === row.id ? (
                <CertForm
                  key={row.id}
                  employeeId={employee.id}
                  row={row}
                  onCancel={() => setEditingId(null)}
                  onSaved={(msg) => {
                    setEditingId(null);
                    onFlash("success", msg);
                    onSaved();
                  }}
                />
              ) : (
                <CertRow key={row.id} row={row} onEdit={() => setEditingId(row.id)} />
              )
            )}
          </div>

          {adding ? (
            <CertForm
              employeeId={employee.id}
              typeKey={adding}
              onCancel={() => setAdding(null)}
              onSaved={(msg) => {
                setAdding(null);
                onFlash("success", msg);
                onSaved();
              }}
            />
          ) : (
            <>
              <div className="label" style={{ marginBottom: 6 }}>
                Add a cert
              </div>
              <div className="cert-type-grid">
                {CERT_TYPES.map((t) => {
                  const Icon = CERT_ICON[t.key];
                  return (
                    <button key={t.key} type="button" className="cert-type-btn" onClick={() => setAdding(t.key)}>
                      <Icon size={18} color="var(--accent)" />
                      <span>{t.short}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <details className="more-details" style={{ marginTop: 12 }}>
            <summary>Employee details</summary>
            <div className="record-row-sub" style={{ marginTop: 6 }}>
              {employee.annual_holiday_allowance} holiday days/yr
              {employee.start_date ? ` · started ${shortDate(employee.start_date)}` : ""}
            </div>
            {employee.notes && <div className="record-row-sub">{employee.notes}</div>}
          </details>
        </div>
      )}
    </div>
  );
}

function CertRow({ row, onEdit }) {
  const key = certTypeOf(row);
  const Icon = CERT_ICON[key] || Award;
  const status = expiryStatus(row.expiry_date);
  const [opening, setOpening] = useState(false);

  async function openFile(e) {
    e.stopPropagation();
    if (!row.file_path) return;
    setOpening(true);
    try {
      const { data } = await supabase.storage.from("admin-documents").createSignedUrl(row.file_path, 3600);
      if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noreferrer");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="cert-row">
      <button type="button" className="cert-row-main" onClick={onEdit}>
        <Icon size={16} color="var(--accent)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cert-row-title">{certLabel(row)}</div>
          <div className="cert-row-sub">
            {row.expiry_date ? `Expires ${shortDate(row.expiry_date)}` : "No expiry"}
            {row.card_number ? ` · No. ${row.card_number}` : ""}
          </div>
        </div>
        <span className={`status-badge status-${status}`}>{EXPIRY_STATUS_LABEL[status]}</span>
      </button>
      {row.file_path && (
        <button type="button" className="icon-btn" title={row.file_name || "Open file"} onClick={openFile} disabled={opening}>
          {opening ? <Loader2 size={14} className="spin" /> : <Paperclip size={14} color="var(--text-muted)" />}
        </button>
      )}
    </div>
  );
}

// Add (typeKey set) or edit (row set) one cert. Expiry fills in from the date
// obtained and the card's usual validity; it stays editable.
function CertForm({ employeeId, typeKey, row, onCancel, onSaved }) {
  const isEdit = !!row;
  const initialType = isEdit ? certTypeOf(row) : typeKey;
  const [type, setType] = useState(initialType);
  const [form, setForm] = useState(() => ({
    detail: row?.cert_detail || "",
    other_name: initialType === "other" ? row?.training_name || "" : "",
    card_number: row?.card_number || "",
    completed_date: row?.completed_date || (isEdit ? "" : dateKey(new Date())),
    expiry_date: row?.expiry_date || (isEdit ? "" : addYears(dateKey(new Date()), CERT_TYPE_BY_KEY[initialType]?.validYears)),
    notes: row?.notes || "",
  }));
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const typeDef = CERT_TYPE_BY_KEY[type];

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: false }));
  }

  function setObtained(value) {
    setForm((f) => ({
      ...f,
      completed_date: value,
      expiry_date: typeDef?.validYears && value ? addYears(value, typeDef.validYears) : f.expiry_date,
    }));
  }

  function changeType(key) {
    setType(key);
    const def = CERT_TYPE_BY_KEY[key];
    setForm((f) => ({
      ...f,
      detail: "",
      expiry_date: def?.validYears && f.completed_date ? addYears(f.completed_date, def.validYears) : f.expiry_date,
    }));
  }

  function displayName() {
    if (type === "other") return form.other_name.trim();
    const label = typeDef.label;
    return form.detail ? `${label} - ${form.detail}` : label;
  }

  async function handleSave() {
    const e = {};
    if (type === "other" && !form.other_name.trim()) e.other_name = true;
    if (type === "cscs" && !form.detail) e.detail = true;
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setError("");
    try {
      let filePath = row?.file_path || null;
      let fileName = row?.file_name || null;
      if (file) {
        const ext = file.name.split(".").pop();
        const newPath = `training/${uid()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("admin-documents").upload(newPath, file.file, {
          contentType: file.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;
        if (row?.file_path) await supabase.storage.from("admin-documents").remove([row.file_path]);
        filePath = newPath;
        fileName = file.name;
      }
      const payload = {
        employee_id: employeeId,
        cert_type: type,
        cert_detail: type === "cscs" ? form.detail || null : null,
        training_name: displayName(),
        card_number: form.card_number.trim() || null,
        completed_date: form.completed_date || null,
        expiry_date: form.expiry_date || null,
        notes: form.notes.trim() || null,
        file_path: filePath,
        file_name: fileName,
      };
      const { error: dbError } = isEdit
        ? await supabase.from("employee_training").update(payload).eq("id", row.id)
        : await supabase.from("employee_training").insert(payload);
      if (dbError) throw dbError;
      onSaved(isEdit ? "Cert updated." : `${typeDef.label} added.`);
    } catch (err) {
      console.error(err);
      setError(err.message || "Couldn't save this cert.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete ${certLabel(row)}?`)) return;
    setDeleting(true);
    setError("");
    try {
      if (row.file_path) await supabase.storage.from("admin-documents").remove([row.file_path]);
      const { error: dbError } = await supabase.from("employee_training").delete().eq("id", row.id);
      if (dbError) throw dbError;
      onSaved("Cert deleted.");
    } catch (err) {
      console.error(err);
      setError(err.message || "Couldn't delete this cert.");
      setDeleting(false);
    }
  }

  const Icon = CERT_ICON[type] || Award;

  return (
    <div className="card cert-form">
      <div className="cert-form-head">
        <Icon size={18} color="var(--accent)" />
        <span>{isEdit ? "Edit" : "Add"} {typeDef?.label}</span>
        <button type="button" className="icon-btn" style={{ marginLeft: "auto" }} onClick={onCancel} disabled={saving} title="Cancel">
          <X size={16} color="var(--text-muted)" />
        </button>
      </div>

      {error && (
        <div className="hint error" style={{ marginBottom: 8 }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {isEdit && (
        <div className="pill-row" style={{ marginBottom: 10 }}>
          {CERT_TYPES.map((t) => (
            <button key={t.key} type="button" className={`pill-btn small ${type === t.key ? "active" : ""}`} onClick={() => changeType(t.key)}>
              {t.short}
            </button>
          ))}
        </div>
      )}

      {type === "cscs" && (
        <div className="field">
          <label className="label">
            Card type <span className="req">*</span>
          </label>
          <select className={`input ${errors.detail ? "error" : ""}`} value={form.detail} onChange={(e) => setField("detail", e.target.value)}>
            <option value="">Select...</option>
            {typeDef.details.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {errors.detail && <div className="hint error">Pick the card</div>}
        </div>
      )}

      {type === "other" && (
        <div className="field">
          <label className="label">
            Cert / course name <span className="req">*</span>
          </label>
          <input
            className={`input ${errors.other_name ? "error" : ""}`}
            type="text"
            placeholder="e.g. Abrasive Wheels"
            value={form.other_name}
            onChange={(e) => setField("other_name", e.target.value)}
          />
          {errors.other_name && <div className="hint error">Required</div>}
        </div>
      )}

      <div className="two-col">
        <div className="field">
          <label className="label">Date obtained</label>
          <input className="input" type="date" value={form.completed_date} onChange={(e) => setObtained(e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Expires{typeDef?.validYears ? ` (${typeDef.validYears} yrs)` : ""}</label>
          <input className="input" type="date" value={form.expiry_date} onChange={(e) => setField("expiry_date", e.target.value)} />
        </div>
      </div>

      <div className="two-col">
        <div className="field">
          <label className="label">Card number</label>
          <input className="input" type="text" value={form.card_number} onChange={(e) => setField("card_number", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Photo of card {row?.file_name && <span style={{ fontWeight: 400 }}>(have one)</span>}</label>
          <AdminFileUpload value={file} onChange={setFile} label={row?.file_name ? "Replace" : "Attach"} />
        </div>
      </div>

      <details className="more-details">
        <summary>Notes</summary>
        <div className="field">
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
        </div>
      </details>

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={saving || deleting}>
          {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {saving ? "Saving..." : "Save"}
        </button>
        {isEdit && (
          <button type="button" className="btn-secondary btn-danger-outline" style={{ width: "auto" }} onClick={handleDelete} disabled={saving || deleting} title="Delete">
            {deleting ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}

function AddEmployeeForm({ onCancel, onSaved }) {
  const [form, setForm] = useState({ full_name: "", role: "", start_date: "", annual_holiday_allowance: "20", notes: "" });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
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
      onSaved();
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || "Something went wrong adding this employee.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card cert-form">
      <div className="cert-form-head">
        <Plus size={18} color="var(--accent)" />
        <span>Add an employee</span>
        <button type="button" className="icon-btn" style={{ marginLeft: "auto" }} onClick={onCancel} disabled={submitting} title="Cancel">
          <X size={16} color="var(--text-muted)" />
        </button>
      </div>
      {submitError && (
        <div className="hint error" style={{ marginBottom: 8 }}>
          <AlertCircle size={13} /> {submitError}
        </div>
      )}
      <div className="two-col">
        <div className="field">
          <label className="label">
            Full name <span className="req">*</span>
          </label>
          <input className={`input ${errors.full_name ? "error" : ""}`} type="text" value={form.full_name} onChange={(e) => setField("full_name", e.target.value)} />
          {errors.full_name && <div className="hint error">Required</div>}
        </div>
        <div className="field">
          <label className="label">Role</label>
          <input className="input" type="text" placeholder="e.g. Foreman" value={form.role} onChange={(e) => setField("role", e.target.value)} />
        </div>
      </div>
      <div className="two-col">
        <div className="field">
          <label className="label">Start date</label>
          <input className="input" type="date" value={form.start_date} onChange={(e) => setField("start_date", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Holiday days / yr</label>
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
      <details className="more-details">
        <summary>Notes</summary>
        <div className="field">
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
        </div>
      </details>
      <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
        {submitting ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}
        {submitting ? "Saving..." : "Add employee"}
      </button>
    </div>
  );
}

function HolidaysSection({ employees, holidays, employeeById, onSaved }) {
  const [expanded, setExpanded] = useState({});
  const [form, setForm] = useState({ employee_id: "", start_date: "", end_date: "", notes: "" });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function toggleExpand(id) {
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  }

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
        <div>Holidays are attached to an employee — add someone on the Staff Records tab first.</div>
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
          const bookedTaken = takenByEmployee[emp.id] || 0;
          const taken = emp.manual_days_taken != null ? Number(emp.manual_days_taken) : bookedTaken;
          const remaining = (Number(emp.annual_holiday_allowance) || 0) - taken;
          const isOpen = !!expanded[emp.id];
          const empUpcoming = upcoming.filter((h) => h.employee_id === emp.id);
          return (
            <div className="record-row" key={emp.id}>
              <button
                type="button"
                onClick={() => toggleExpand(emp.id)}
                style={{ background: "none", border: "none", padding: 0, width: "100%", textAlign: "left", cursor: "pointer", color: "inherit" }}
              >
                <div className="record-row-top">
                  <div className="record-row-title">{emp.full_name}</div>
                  <span className="record-row-sub" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {taken} taken · {remaining} remaining
                    {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </div>
              </button>

              {isOpen && (
                <div style={{ marginTop: 4, paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
                  {empUpcoming.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div className="record-row-sub" style={{ fontWeight: 600 }}>
                        Upcoming
                      </div>
                      {empUpcoming.map((h) => (
                        <div className="record-row-sub" key={h.id}>
                          {h.start_date} — {h.end_date} ({dayCount(h.start_date, h.end_date)} days){h.notes ? ` · ${h.notes}` : ""}
                        </div>
                      ))}
                    </div>
                  )}
                  <AllowanceEditor employee={emp} taken={taken} remaining={remaining} onSaved={onSaved} />
                  <AddHolidayInline employeeId={emp.id} onSaved={onSaved} />
                </div>
              )}
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

function AllowanceEditor({ employee, taken, remaining, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [takenValue, setTakenValue] = useState(String(taken));
  const [remainingValue, setRemainingValue] = useState(String(remaining));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTakenValue(String(taken));
    setRemainingValue(String(remaining));
  }, [taken, remaining]);

  async function handleSave() {
    const parsedTaken = Number(takenValue);
    const parsedRemaining = Number(remainingValue);
    if (Number.isNaN(parsedTaken) || Number.isNaN(parsedRemaining)) {
      setError("Enter numbers for both fields");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { error: updateError } = await supabase
        .from("employees")
        .update({
          manual_days_taken: parsedTaken,
          annual_holiday_allowance: parsedTaken + parsedRemaining,
        })
        .eq("id", employee.id);
      if (updateError) throw updateError;
      setEditing(false);
      onSaved();
    } catch (err) {
      console.error(err);
      setError(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setEditing(true)}
        style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6 }}
      >
        <Pencil size={14} /> Edit days taken / remaining
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {error && (
        <div className="banner error" style={{ marginBottom: 0 }}>
          <AlertCircle size={16} color="var(--danger)" />
          <span>{error}</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ marginBottom: 0, maxWidth: 160 }}>
          <label className="label">Days taken</label>
          <input className="input" type="number" step="1" value={takenValue} onChange={(e) => setTakenValue(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0, maxWidth: 160 }}>
          <label className="label">Days remaining</label>
          <input className="input" type="number" step="1" value={remainingValue} onChange={(e) => setRemainingValue(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setEditing(false);
            setTakenValue(String(taken));
            setRemainingValue(String(remaining));
            setError("");
          }}
          disabled={saving}
        >
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={17} className="spin" /> : <Check size={17} />}
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function AddHolidayInline({ employeeId, onSaved }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ start_date: "", end_date: "", notes: "" });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: false }));
  }

  async function handleSubmit() {
    setSubmitError("");
    const newErrors = {};
    if (!form.start_date) newErrors.start_date = true;
    if (!form.end_date) newErrors.end_date = true;
    if (form.start_date && form.end_date && form.end_date < form.start_date) newErrors.end_date = true;
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSubmitting(true);
    try {
      const { error: insertError } = await supabase.from("employee_holidays").insert({
        employee_id: employeeId,
        start_date: form.start_date,
        end_date: form.end_date,
        notes: form.notes.trim() || null,
      });
      if (insertError) throw insertError;
      setForm({ start_date: "", end_date: "", notes: "" });
      setOpen(false);
      onSaved();
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || "Something went wrong saving this holiday.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)} style={{ alignSelf: "flex-start" }}>
        <Plus size={15} /> Add upcoming holiday
      </button>
    );
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {submitError && (
        <div className="banner error" style={{ marginBottom: 0 }}>
          <AlertCircle size={16} color="var(--danger)" />
          <span>{submitError}</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
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
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
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
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Notes</label>
        <textarea className="input" rows={2} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={submitting}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}
          {submitting ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

// ---------- Hours (admin): clock in / out per person per day ----------

// 24-hour clock in 15-minute steps, "00:00" .. "23:45".
const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, "0");
  const m = String((i % 4) * 15).padStart(2, "0");
  return `${h}:${m}`;
});
const BREAK_OPTIONS = [0, 15, 30, 45, 60];
const HOURS_DEFAULTS_KEY = "staff-hours.defaults";

function toMinutes(t) {
  const [h, m] = String(t || "00:00").slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

// Net hours for one entry, to two decimals. Clock-out before clock-in is
// treated as running past midnight.
export function entryHours(row) {
  let mins = toMinutes(row.clock_out) - toMinutes(row.clock_in);
  if (mins < 0) mins += 24 * 60;
  mins -= Number(row.break_minutes) || 0;
  return Math.max(0, Math.round((mins / 60) * 100) / 100);
}

function hhmm(t) {
  return String(t || "").slice(0, 5);
}

function hoursPeriod(period) {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  if (period === "week") return { from: dateKey(monday), to: null };
  if (period === "lastweek") {
    const lastMon = new Date(monday);
    lastMon.setDate(monday.getDate() - 7);
    return { from: dateKey(lastMon), to: dateKey(monday) };
  }
  if (period === "month") return { from: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: null };
  return { from: null, to: null };
}

function rememberedHourDefaults() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(HOURS_DEFAULTS_KEY) || "{}");
    return {
      clock_in: TIME_OPTIONS.includes(saved.clock_in) ? saved.clock_in : "08:00",
      clock_out: TIME_OPTIONS.includes(saved.clock_out) ? saved.clock_out : "17:00",
      break_minutes: BREAK_OPTIONS.includes(Number(saved.break_minutes)) ? Number(saved.break_minutes) : 30,
      project_name: PROJECT_OPTIONS.includes(saved.project_name) ? saved.project_name : "",
    };
  } catch {
    return { clock_in: "08:00", clock_out: "17:00", break_minutes: 30, project_name: "" };
  }
}

function HoursSection({ employees }) {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [period, setPeriod] = useState("week");
  const [form, setForm] = useState(() => ({ work_date: dateKey(new Date()), employee_ids: [], notes: "", ...rememberedHourDefaults() }));
  const [emailWeek, setEmailWeek] = useState("this");
  const [emailing, setEmailing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState(null);
  const [setupReport, setSetupReport] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const employeeById = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data, error } = await supabase
      .from("staff_hours")
      .select("*")
      .order("work_date", { ascending: false })
      .order("clock_in", { ascending: true });
    if (error) {
      setLoadError(error.message);
      setRows([]);
    } else {
      setLoadError("");
      setRows(data || []);
    }
  }

  function flash(type, text) {
    setBanner({ type, text });
    window.setTimeout(() => setBanner(null), 3000);
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: false }));
  }

  const preview = entryHours(form);

  function togglePerson(id) {
    setForm((f) => ({
      ...f,
      employee_ids: f.employee_ids.includes(id) ? f.employee_ids.filter((x) => x !== id) : [...f.employee_ids, id],
    }));
    if (errors.employee_ids) setErrors((e) => ({ ...e, employee_ids: false }));
  }

  function pickAll(on) {
    setForm((f) => ({ ...f, employee_ids: on ? employees.map((emp) => emp.id) : [] }));
    if (errors.employee_ids) setErrors((e) => ({ ...e, employee_ids: false }));
  }

  // One row per person picked, all with the same times — the usual case is
  // the whole crew on the same hours.
  async function handleAdd() {
    const e = {};
    if (!form.work_date) e.work_date = true;
    if (form.employee_ids.length === 0) e.employee_ids = true;
    if (form.clock_in === form.clock_out) e.clock_out = true;
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const rowsToInsert = form.employee_ids.map((employee_id) => ({
        employee_id,
        work_date: form.work_date,
        clock_in: form.clock_in,
        clock_out: form.clock_out,
        break_minutes: Number(form.break_minutes) || 0,
        project_name: form.project_name || null,
        notes: form.notes.trim() || null,
        created_by: userData?.user?.id || null,
      }));
      const { error } = await supabase.from("staff_hours").insert(rowsToInsert);
      if (error) throw error;
      try {
        window.localStorage.setItem(
          HOURS_DEFAULTS_KEY,
          JSON.stringify({ clock_in: form.clock_in, clock_out: form.clock_out, break_minutes: form.break_minutes, project_name: form.project_name })
        );
      } catch {
        // Storage blocked: defaults just won't persist.
      }
      const count = form.employee_ids.length;
      const who = count === 1 ? employeeById[form.employee_ids[0]]?.full_name || "1 person" : `${count} people`;
      flash("success", `${preview}h saved for ${who}.`);
      // Keep date and times; clear the names and note for the next batch.
      setForm((f) => ({ ...f, employee_ids: [], notes: "" }));
      load();
      syncExcelExport().catch((err) => console.error("Excel export sync failed:", err));
    } catch (err) {
      console.error(err);
      flash("error", err.message || "Couldn't save those hours.");
    } finally {
      setSaving(false);
    }
  }

  // Anchor date for the week to email: today for this Thu-Wed week, or a
  // week back for the last one. The server works out the Thu-Wed span.
  function emailAnchor() {
    const d = new Date();
    if (emailWeek === "last") d.setDate(d.getDate() - 7);
    return dateKey(d);
  }

  async function callHoursApi(path, payload) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error("Not signed in.");
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    return res;
  }

  async function handleEmailWeek() {
    setEmailing(true);
    try {
      const res = await callHoursApi("/api/hours-weekly", { week: emailAnchor() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Email failed (${res.status}).`);
      flash("success", `Sent to ${json.to}: ${json.people} ${json.people === 1 ? "person" : "people"}, ${json.hours}h.`);
    } catch (err) {
      console.error(err);
      flash("error", err.message || "Couldn't send the email.");
    } finally {
      setEmailing(false);
    }
  }

  async function handlePreviewWeek() {
    try {
      const res = await callHoursApi("/api/hours-weekly", { week: emailAnchor(), preview: "1" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Preview failed (${res.status}).`);
      }
      // Shown inside the app: a new tab opened after a fetch gets blocked as
      // a popup on phones.
      setPreviewHtml(await res.text());
    } catch (err) {
      console.error(err);
      flash("error", err.message || "Couldn't build the preview.");
    }
  }

  async function handleCheckSetup() {
    setSetupReport(null);
    try {
      const res = await callHoursApi("/api/hours-weekly", { check: "1" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Check failed (${res.status}).`);
      setSetupReport(json);
    } catch (err) {
      console.error(err);
      flash("error", err.message || "Couldn't run the check.");
    }
  }

  async function handleDelete(row) {
    const name = employeeById[row.employee_id]?.full_name || "this entry";
    if (!window.confirm(`Delete ${name}, ${shortDate(row.work_date)}?`)) return;
    setBusyId(row.id);
    try {
      const { error } = await supabase.from("staff_hours").delete().eq("id", row.id);
      if (error) throw error;
      load();
      syncExcelExport().catch((err) => console.error("Excel export sync failed:", err));
    } catch (err) {
      console.error(err);
      flash("error", err.message || "Couldn't delete that entry.");
    } finally {
      setBusyId(null);
    }
  }

  const visible = useMemo(() => {
    if (!rows) return [];
    const { from, to } = hoursPeriod(period);
    return rows.filter((r) => (!from || r.work_date >= from) && (!to || r.work_date < to));
  }, [rows, period]);

  const totals = useMemo(() => {
    const byEmp = {};
    visible.forEach((r) => {
      const t = byEmp[r.employee_id] || { hours: 0, days: new Set() };
      t.hours += entryHours(r);
      t.days.add(r.work_date);
      byEmp[r.employee_id] = t;
    });
    return Object.entries(byEmp)
      .map(([id, t]) => ({ id, name: employeeById[id]?.full_name || "Unknown", hours: Math.round(t.hours * 100) / 100, days: t.days.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [visible, employeeById]);

  const grouped = useMemo(() => {
    const map = new Map();
    visible.forEach((r) => {
      if (!map.has(r.work_date)) map.set(r.work_date, []);
      map.get(r.work_date).push(r);
    });
    return Array.from(map.entries());
  }, [visible]);

  if (employees.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Add an employee first</div>
        <div>Hours are logged against a name — add people on the Staff &amp; certs tab.</div>
      </div>
    );
  }

  return (
    <div>
      {banner && (
        <div className={`banner ${banner.type}`}>
          {banner.type === "success" ? <Check size={16} color="var(--success)" /> : <AlertCircle size={16} color="var(--danger)" />}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{banner.text}</span>
        </div>
      )}

      <div className="card cert-form">
        <div className="cert-form-head">
          <Clock size={18} color="var(--accent)" />
          <span>Add hours</span>
          <span style={{ marginLeft: "auto", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "var(--accent-2)" }}>{preview}h</span>
        </div>
        <div className="field">
          <label className="label">
            Date <span className="req">*</span>
          </label>
          <input className={`input ${errors.work_date ? "error" : ""}`} type="date" value={form.work_date} onChange={(e) => setField("work_date", e.target.value)} />
        </div>
        <div className="field">
          <div className="label" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>
              Who <span className="req">*</span>
              {form.employee_ids.length > 0 && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {form.employee_ids.length} picked</span>}
            </span>
            <button type="button" className="btn-link" style={{ marginLeft: "auto", marginBottom: 0, padding: 0 }} onClick={() => pickAll(true)}>
              Everyone
            </button>
            <button type="button" className="btn-link" style={{ marginBottom: 0, padding: 0 }} onClick={() => pickAll(false)}>
              Clear
            </button>
          </div>
          <div className={`pick-grid ${errors.employee_ids ? "error" : ""}`}>
            {employees.map((emp) => {
              const on = form.employee_ids.includes(emp.id);
              return (
                <button key={emp.id} type="button" className={`pick-btn ${on ? "active" : ""}`} onClick={() => togglePerson(emp.id)}>
                  {on && <Check size={13} />}
                  {emp.full_name}
                </button>
              );
            })}
          </div>
          {errors.employee_ids && <div className="hint error">Pick at least one person</div>}
        </div>
        <div className="hours-times">
          <div className="field">
            <label className="label">Clock in</label>
            <select className="input" value={form.clock_in} onChange={(e) => setField("clock_in", e.target.value)}>
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Clock out</label>
            <select className={`input ${errors.clock_out ? "error" : ""}`} value={form.clock_out} onChange={(e) => setField("clock_out", e.target.value)}>
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {errors.clock_out && <div className="hint error">Same as clock in</div>}
          </div>
          <div className="field">
            <label className="label">Break</label>
            <select className="input" value={form.break_minutes} onChange={(e) => setField("break_minutes", Number(e.target.value))}>
              {BREAK_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b} min
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="label">Project</label>
          <select className="input" value={form.project_name} onChange={(e) => setField("project_name", e.target.value)}>
            <option value="">Not set</option>
            {PROJECT_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label">Notes for the day</label>
          <textarea
            className="input"
            rows={2}
            placeholder="e.g. Left early for delivery, rained off at 2"
            value={form.notes}
            onChange={(e) => setField("notes", e.target.value)}
          />
        </div>
        <button className="btn-primary" onClick={handleAdd} disabled={saving}>
          {saving ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}
          {saving ? "Saving..." : "Add hours"}
        </button>
      </div>

      <div className="card" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Mail size={16} color="var(--accent)" />
        <select className="input" style={{ width: "auto", flex: 1, minWidth: 120 }} value={emailWeek} onChange={(e) => setEmailWeek(e.target.value)}>
          <option value="this">This week (Thu–Wed)</option>
          <option value="last">Last week</option>
        </select>
        <button type="button" className="btn-small" onClick={handlePreviewWeek} disabled={emailing}>
          Preview
        </button>
        <button type="button" className="btn-small" onClick={handleEmailWeek} disabled={emailing}>
          {emailing ? <Loader2 size={14} className="spin" /> : <Mail size={14} />} Email to Kate
        </button>
        <div style={{ width: "100%", fontSize: 11.5, color: "var(--text-muted)" }}>
          Goes automatically every Wednesday at 8pm. A reminder comes to you at 3pm if days or people are missing.{" "}
          <button type="button" className="btn-link" style={{ margin: 0, padding: 0, fontSize: 11.5 }} onClick={handleCheckSetup}>
            Check setup
          </button>
        </div>
        {setupReport && (
          <div className="setup-report">
            {Object.entries(setupReport.env || {}).map(([k, ok]) => (
              <div key={k} className={ok ? "ok" : "bad"}>
                {ok ? "✓" : "✗"} {k} {ok ? "set" : "missing in Vercel"}
              </div>
            ))}
            <div className={setupReport.smtp === "ok" ? "ok" : setupReport.smtp === "not tried" ? "" : "bad"}>
              {setupReport.smtp === "ok" ? "✓" : setupReport.smtp === "not tried" ? "·" : "✗"} Gmail login: {setupReport.smtp}
            </div>
            <div className={setupReport.database === "ok" ? "ok" : setupReport.database === "not tried" ? "" : "bad"}>
              {setupReport.database === "ok" ? "✓" : setupReport.database === "not tried" ? "·" : "✗"} Hours data: {setupReport.database}
            </div>
            <div>Sends to {setupReport.to}{setupReport.cc ? `, copy ${setupReport.cc}` : ""}</div>
          </div>
        )}
      </div>

      {previewHtml !== null && (
        <div className="preview-overlay" onClick={() => setPreviewHtml(null)}>
          <div className="preview-panel" onClick={(e) => e.stopPropagation()}>
            <div className="preview-head">
              <span>Email preview</span>
              <button type="button" className="icon-btn" onClick={() => setPreviewHtml(null)} title="Close">
                <X size={16} color="var(--text-muted)" />
              </button>
            </div>
            <iframe title="Email preview" className="preview-frame" srcDoc={previewHtml} sandbox="" />
          </div>
        </div>
      )}

      <div className="pill-row" style={{ marginTop: 14 }}>
        {[
          ["week", "This week"],
          ["lastweek", "Last week"],
          ["month", "This month"],
          ["all", "All"],
        ].map(([key, label]) => (
          <button key={key} className={`pill-btn small ${period === key ? "active" : ""}`} onClick={() => setPeriod(key)}>
            {label}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="empty-state">
          <div className="empty-state-title">Couldn't load hours</div>
          <div>{loadError}</div>
        </div>
      )}

      {rows === null && !loadError && (
        <div style={{ display: "flex", justifyContent: "center", padding: 30 }}>
          <Loader2 size={22} color="var(--accent)" className="spin" />
        </div>
      )}

      {rows !== null && totals.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          {totals.map((t) => (
            <div key={t.id} className="breakdown-row">
              <span>
                {t.name}
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {" "}
                  · {t.days} {t.days === 1 ? "day" : "days"}
                </span>
              </span>
              <span className="delivery-row-qty">{t.hours}h</span>
            </div>
          ))}
        </div>
      )}

      {rows !== null && grouped.length === 0 && (
        <div className="empty-state" style={{ padding: 24 }}>
          <div className="empty-state-title">No hours logged</div>
          <div>Nothing in this period yet.</div>
        </div>
      )}

      {grouped.map(([date, list]) => (
        <div key={date} style={{ marginBottom: 12 }}>
          <div className="date-heading">{prettyDate(date)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {list.map((r) => (
              <div key={r.id} className="cert-row">
                <div className="cert-row-main" style={{ cursor: "default" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cert-row-title">{employeeById[r.employee_id]?.full_name || "Unknown"}</div>
                    <div className="cert-row-sub">
                      {hhmm(r.clock_in)}–{hhmm(r.clock_out)}
                      {r.break_minutes ? ` · ${r.break_minutes} min break` : ""}
                      {r.project_name ? ` · ${r.project_name}` : ""}
                    </div>
                    {r.notes && <div className="cert-row-sub" style={{ fontStyle: "italic" }}>{r.notes}</div>}
                  </div>
                  <span className="delivery-row-qty" style={{ fontSize: 13.5 }}>
                    {entryHours(r)}h
                  </span>
                </div>
                <button type="button" className="icon-btn" title="Delete" onClick={() => handleDelete(r)} disabled={busyId === r.id}>
                  {busyId === r.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} color="var(--text-muted)" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
