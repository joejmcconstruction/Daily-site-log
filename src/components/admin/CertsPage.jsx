import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  AlertCircle,
  Loader2,
  Plus,
  Paperclip,
  Wrench,
  Truck,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  X,
  ShieldCheck,
  ClipboardCheck,
  Receipt,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { supabase } from "../../supabaseClient";
import { MACHINE_OPTIONS, VEHICLE_MODEL_OPTIONS, uid, dateKey } from "../../lib/helpers";
import {
  CERT_CATEGORY,
  VEHICLE_CERT_SLOTS,
  machineCertSlots,
  certSlotSummary,
  worstStatus,
  groupCertsBySubject,
  presetForCert,
  slotForCert,
  expiryStatus,
  EXPIRY_STATUS_LABEL,
  shortDate,
  addYears,
} from "../../lib/adminHelpers";
import AdminFileUpload from "./AdminFileUpload";

const CERT_ICON = {
  NCT: ClipboardCheck,
  CVRT: ClipboardCheck,
  GA1: ClipboardCheck,
  Tax: Receipt,
  Insurance: ShieldCheck,
  Service: Wrench,
  Other: FileText,
};

const STATUS_COLOR = {
  expired: "var(--danger)",
  "due-soon": "var(--accent-2)",
  missing: "var(--text-muted)",
  none: "var(--text-muted)",
  valid: "var(--success)",
};

function slotsFor(category, name) {
  return category === "vehicle" ? VEHICLE_CERT_SLOTS : machineCertSlots(name);
}

// One entry per machine / vehicle, with its chips and worst status. Machines
// come from the app's fixed list so one with nothing on file still shows as
// missing its GA1; vehicles come from whatever registrations have certs,
// plus any added this session that haven't had a cert saved yet.
function buildSubjects(certs, category, drafts) {
  const groups = groupCertsBySubject(certs, category);
  let list;
  if (category === "machine") {
    const seen = new Set();
    list = MACHINE_OPTIONS.map((name) => {
      const key = name.toLowerCase();
      seen.add(key);
      return groups.get(key) || { key, name, model: "", certs: [] };
    });
    groups.forEach((g, key) => {
      if (!seen.has(key)) list.push(g);
    });
  } else {
    list = [...groups.values()];
    drafts.forEach((d) => {
      if (!groups.has(d.key)) list.push({ ...d, certs: [], draft: true });
    });
    list.sort((a, b) => (a.model || "").localeCompare(b.model || "") || a.name.localeCompare(b.name));
  }
  return list.map((s) => {
    const summary = certSlotSummary(s.certs, slotsFor(category, s.name));
    return { ...s, summary, worst: summary.length ? worstStatus(summary) : "none" };
  });
}

function attentionFor(subjects) {
  const items = [];
  subjects.forEach((subject) => {
    subject.summary.forEach((c) => {
      if (c.status === "missing") items.push({ subject, level: "missing", text: `no ${c.label}` });
      else if (c.status === "expired") items.push({ subject, level: "expired", text: `${c.label} expired ${shortDate(c.row.expiry_date)}` });
      else if (c.status === "due-soon") items.push({ subject, level: "due-soon", text: `${c.label} due ${shortDate(c.row.expiry_date)}` });
    });
  });
  const order = { expired: 0, "due-soon": 1, missing: 2 };
  return items.sort((a, b) => order[a.level] - order[b.level]);
}

export default function CertsPage() {
  const [section, setSection] = useState("machine");
  const [certs, setCerts] = useState(null);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const [draftVehicles, setDraftVehicles] = useState([]);
  const [showAddVehicle, setShowAddVehicle] = useState(false);

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

  function flash(type, text) {
    setBanner({ type, text });
    window.setTimeout(() => setBanner(null), 3000);
  }

  const subjects = useMemo(() => buildSubjects(certs || [], section, draftVehicles), [certs, section, draftVehicles]);
  const attention = useMemo(() => attentionFor(subjects), [subjects]);
  const issueCounts = useMemo(
    () => ({
      machine: attentionFor(buildSubjects(certs || [], "machine", [])).length,
      vehicle: attentionFor(buildSubjects(certs || [], "vehicle", draftVehicles)).length,
    }),
    [certs, draftVehicles]
  );

  function switchSection(next) {
    setSection(next);
    setOpenKey(null);
    setShowAddVehicle(false);
  }

  function addDraftVehicle({ name, model }) {
    const key = name.toLowerCase();
    if (!subjects.some((s) => s.key === key)) {
      setDraftVehicles((d) => [...d, { key, name, model }]);
    }
    setShowAddVehicle(false);
    setOpenKey(key);
  }

  const noun = CERT_CATEGORY[section].noun;

  return (
    <div>
      <div className="eyebrow" style={{ marginTop: 0 }}>
        Certs &amp; Compliance
        <div className="eyebrow-sub">Tap a machine or vehicle to see its certs. Missing, expired and due-soon certs are flagged.</div>
      </div>

      <div className="pill-row">
        <button className={`pill-btn ${section === "machine" ? "active" : ""}`} onClick={() => switchSection("machine")}>
          <Wrench size={13} style={{ marginRight: 5, verticalAlign: -2 }} /> Plant Machinery
          {issueCounts.machine > 0 && <span className="pill-badge">{issueCounts.machine}</span>}
        </button>
        <button className={`pill-btn ${section === "vehicle" ? "active" : ""}`} onClick={() => switchSection("vehicle")}>
          <Truck size={13} style={{ marginRight: 5, verticalAlign: -2 }} /> Road Vehicles
          {issueCounts.vehicle > 0 && <span className="pill-badge">{issueCounts.vehicle}</span>}
        </button>
      </div>

      {banner && (
        <div className={`banner ${banner.type}`}>
          {banner.type === "success" ? <Check size={16} color="var(--success)" /> : <AlertCircle size={16} color="var(--danger)" />}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{banner.text}</span>
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
          {attention.length > 0 && (
            <div className="attention card">
              <div className="attention-title">Needs attention</div>
              {attention.map((a, i) => (
                <button key={`${a.subject.key}-${i}`} type="button" className="attention-row" onClick={() => setOpenKey(a.subject.key)}>
                  <span className={`attention-dot ${a.level}`} />
                  <span className="attention-name">{a.subject.name}</span>
                  <span className="attention-text">{a.text}</span>
                </button>
              ))}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {subjects.length === 0 && (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-state-title">No {noun}s yet</div>
                <div>Add the first one below.</div>
              </div>
            )}
            {subjects.map((subject) => (
              <SubjectCard
                key={subject.key}
                category={section}
                subject={subject}
                open={openKey === subject.key}
                onToggle={() => setOpenKey(openKey === subject.key ? null : subject.key)}
                onSaved={(msg, nextKey) => {
                  if (msg) flash("success", msg);
                  if (nextKey) setOpenKey(nextKey);
                  load();
                }}
                onRemoveDraft={() => {
                  setDraftVehicles((d) => d.filter((v) => v.key !== subject.key));
                  setOpenKey(null);
                }}
              />
            ))}
          </div>

          {section === "vehicle" &&
            (showAddVehicle ? (
              <AddVehicleForm onCancel={() => setShowAddVehicle(false)} onAdd={addDraftVehicle} />
            ) : (
              <button type="button" className="btn-secondary" onClick={() => setShowAddVehicle(true)}>
                <Plus size={15} /> Add a vehicle
              </button>
            ))}
        </>
      )}
    </div>
  );
}

function SlotChip({ item }) {
  if (item.status === "missing") {
    return <span className="cert-chip missing">{item.label}</span>;
  }
  const when = item.status === "expired" ? "expired" : shortDate(item.row.expiry_date);
  return (
    <span className={`cert-chip ${item.status}`}>
      {item.label}
      {item.count > 1 ? ` ×${item.count}` : ""} · {when}
    </span>
  );
}

function SubjectCard({ category, subject, open, onToggle, onSaved, onRemoveDraft }) {
  const [adding, setAdding] = useState(null); // preset key being added, or null
  const [editingId, setEditingId] = useState(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const { presets } = CERT_CATEGORY[category];
  const slots = slotsFor(category, subject.name);
  const Icon = category === "machine" ? Wrench : Truck;

  // Required slots first, in slot order, then extras; newest expiry first
  // within a type so the live cert sits above any old ones.
  const sorted = [...subject.certs].sort((a, b) => {
    const sa = slots.indexOf(slotForCert(a.cert_type, slots));
    const sb = slots.indexOf(slotForCert(b.cert_type, slots));
    const ra = sa === -1 ? slots.length : sa;
    const rb = sb === -1 ? slots.length : sb;
    if (ra !== rb) return ra - rb;
    const ta = (a.cert_type || "").toLowerCase();
    const tb = (b.cert_type || "").toLowerCase();
    if (ta !== tb) return ta < tb ? -1 : 1;
    return (a.expiry_date || "") > (b.expiry_date || "") ? -1 : 1;
  });

  function closeForms() {
    setAdding(null);
    setEditingId(null);
    setEditingDetails(false);
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <button type="button" className="delivery-row" onClick={onToggle}>
        <div className={`subject-icon ${subject.worst}`}>
          <Icon size={16} color={STATUS_COLOR[subject.worst]} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="delivery-row-title">
            <span>{subject.name}</span>
            {subject.model && (
              <span className="delivery-row-sub" style={{ marginTop: 0 }}>
                {subject.model}
              </span>
            )}
          </div>
          <div className="cert-chips">
            {subject.summary.length === 0 && <span className="cert-chip none">No certs on file</span>}
            {subject.summary.map((item) => (
              <SlotChip key={item.key} item={item} />
            ))}
          </div>
        </div>
        {open ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
      </button>

      {open && (
        <div className="delivery-edit">
          {sorted.length === 0 && (
            <div className="record-row-sub" style={{ marginBottom: 10 }}>
              No certs on file yet.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {sorted.map((row) =>
              editingId === row.id ? (
                <CertForm
                  key={row.id}
                  category={category}
                  subject={subject}
                  row={row}
                  onCancel={() => setEditingId(null)}
                  onSaved={(msg) => {
                    setEditingId(null);
                    onSaved(msg);
                  }}
                />
              ) : (
                <CertRow
                  key={row.id}
                  row={row}
                  presets={presets}
                  onEdit={() => {
                    closeForms();
                    setEditingId(row.id);
                  }}
                />
              )
            )}
          </div>

          {adding ? (
            <CertForm
              category={category}
              subject={subject}
              typeKey={adding}
              onCancel={() => setAdding(null)}
              onSaved={(msg) => {
                setAdding(null);
                onSaved(msg);
              }}
            />
          ) : (
            <>
              <div className="label" style={{ marginBottom: 6 }}>
                Add a cert
              </div>
              <div className="cert-type-grid">
                {presets.map((p) => {
                  const PresetIcon = CERT_ICON[p.key] || FileText;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      className="cert-type-btn"
                      onClick={() => {
                        closeForms();
                        setAdding(p.key);
                      }}
                    >
                      <PresetIcon size={18} color="var(--accent)" />
                      <span>{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {category === "vehicle" && (
            <div style={{ marginTop: 12 }}>
              {subject.draft ? (
                <button type="button" className="link-btn danger" onClick={onRemoveDraft}>
                  <Trash2 size={12} /> Remove this vehicle
                </button>
              ) : editingDetails ? (
                <VehicleDetailsForm
                  subject={subject}
                  onCancel={() => setEditingDetails(false)}
                  onSaved={(msg, nextKey) => {
                    setEditingDetails(false);
                    onSaved(msg, nextKey);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    closeForms();
                    setEditingDetails(true);
                  }}
                >
                  <Pencil size={12} /> Edit registration / model
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CertRow({ row, presets, onEdit }) {
  const preset = presetForCert(row.cert_type, presets);
  const Icon = CERT_ICON[preset?.key] || FileText;
  const status = expiryStatus(row.expiry_date);
  const [opening, setOpening] = useState(false);
  const isImage = /\.(jpe?g|png|gif|webp|heic)$/i.test(row.file_name || "");

  // Open the tab before the signed URL arrives so mobile browsers don't
  // treat it as a pop-up.
  async function openFile(e) {
    e.stopPropagation();
    if (!row.file_path) return;
    setOpening(true);
    const win = window.open("about:blank", "_blank");
    try {
      const { data } = await supabase.storage.from("admin-documents").createSignedUrl(row.file_path, 3600);
      if (data?.signedUrl) {
        if (win) win.location.href = data.signedUrl;
        else window.open(data.signedUrl, "_blank", "noreferrer");
      } else if (win) {
        win.close();
      }
    } catch (err) {
      console.error(err);
      if (win) win.close();
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="cert-row">
      <button type="button" className="cert-row-main" onClick={onEdit}>
        <Icon size={16} color="var(--accent)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cert-row-title">{row.cert_type}</div>
          <div className="cert-row-sub">
            {row.expiry_date ? `Expires ${shortDate(row.expiry_date)}` : "No expiry"}
            {row.issue_date ? ` · from ${shortDate(row.issue_date)}` : ""}
            {row.notes ? ` · ${row.notes}` : ""}
          </div>
        </div>
        <span className={`status-badge status-${status}`}>{EXPIRY_STATUS_LABEL[status]}</span>
      </button>
      {row.file_path && (
        <button type="button" className="icon-btn" title={row.file_name || "Open file"} onClick={openFile} disabled={opening}>
          {opening ? (
            <Loader2 size={14} className="spin" />
          ) : isImage ? (
            <ImageIcon size={14} color="var(--text-muted)" />
          ) : (
            <Paperclip size={14} color="var(--text-muted)" />
          )}
        </button>
      )}
    </div>
  );
}

// Add (typeKey set) or edit (row set) one cert on a machine / vehicle.
function CertForm({ category, subject, typeKey, row, onCancel, onSaved }) {
  const { presets } = CERT_CATEGORY[category];
  const isEdit = !!row;
  const initialPreset = isEdit ? presetForCert(row.cert_type, presets) : presets.find((p) => p.key === typeKey) || presets[0];
  const [type, setType] = useState(initialPreset.key);
  const [form, setForm] = useState(() => ({
    other_name: isEdit && initialPreset.key === "Other" ? row.cert_type : "",
    issue_date: row?.issue_date || (isEdit ? "" : dateKey(new Date())),
    expiry_date: row?.expiry_date || (isEdit ? "" : addYears(dateKey(new Date()), initialPreset.validYears)),
    notes: row?.notes || "",
  }));
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const typeDef = presets.find((p) => p.key === type);
  const Icon = CERT_ICON[type] || FileText;

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: false }));
  }

  function setObtained(value) {
    setForm((f) => ({
      ...f,
      issue_date: value,
      expiry_date: typeDef?.validYears && value ? addYears(value, typeDef.validYears) : f.expiry_date,
    }));
  }

  function changeType(key) {
    setType(key);
    const def = presets.find((p) => p.key === key);
    setForm((f) => ({
      ...f,
      expiry_date: def?.validYears && f.issue_date ? addYears(f.issue_date, def.validYears) : f.expiry_date,
    }));
  }

  const certTypeName = type === "Other" ? form.other_name.trim() : typeDef.label;

  async function handleSave() {
    const e = {};
    if (type === "Other" && !form.other_name.trim()) e.other_name = true;
    if (!form.expiry_date) e.expiry_date = true;
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setError("");
    try {
      let filePath = row?.file_path || null;
      let fileName = row?.file_name || null;
      if (file) {
        const ext = file.name.split(".").pop();
        const newPath = `certs/${uid()}.${ext}`;
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
        cert_type: certTypeName,
        issue_date: form.issue_date || null,
        expiry_date: form.expiry_date,
        notes: form.notes.trim() || null,
        file_path: filePath,
        file_name: fileName,
      };
      if (isEdit) {
        const { error: dbError } = await supabase.from("compliance_certs").update(payload).eq("id", row.id);
        if (dbError) throw dbError;
      } else {
        const { data: userData } = await supabase.auth.getUser();
        const { error: dbError } = await supabase.from("compliance_certs").insert({
          ...payload,
          category,
          subject_name: subject.name,
          vehicle_model: category === "vehicle" ? subject.model || null : null,
          created_by: userData?.user?.id || null,
        });
        if (dbError) throw dbError;
      }
      onSaved(isEdit ? "Cert updated." : `${certTypeName} added to ${subject.name}.`);
    } catch (err) {
      console.error(err);
      setError(err.message || "Couldn't save this cert.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete the ${row.cert_type} cert for ${subject.name}? This can't be undone.`)) return;
    setDeleting(true);
    setError("");
    try {
      if (row.file_path) await supabase.storage.from("admin-documents").remove([row.file_path]);
      const { error: dbError } = await supabase.from("compliance_certs").delete().eq("id", row.id);
      if (dbError) throw dbError;
      onSaved("Cert deleted.");
    } catch (err) {
      console.error(err);
      setError(err.message || "Couldn't delete this cert.");
      setDeleting(false);
    }
  }

  return (
    <div className="card cert-form">
      <div className="cert-form-head">
        <Icon size={18} color="var(--accent)" />
        <span>
          {isEdit ? "Edit" : "Add"} {typeDef?.label} · {subject.name}
        </span>
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
          {presets.map((p) => (
            <button key={p.key} type="button" className={`pill-btn small ${type === p.key ? "active" : ""}`} onClick={() => changeType(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      {type === "Other" && (
        <div className="field">
          <label className="label">
            Cert name <span className="req">*</span>
          </label>
          <input
            className={`input ${errors.other_name ? "error" : ""}`}
            type="text"
            placeholder={category === "vehicle" ? "e.g. Tacho calibration" : "e.g. LOLER"}
            value={form.other_name}
            onChange={(e) => setField("other_name", e.target.value)}
          />
          {errors.other_name && <div className="hint error">Required</div>}
        </div>
      )}

      <div className="two-col">
        <div className="field">
          <label className="label">Date obtained</label>
          <input className="input" type="date" value={form.issue_date} onChange={(e) => setObtained(e.target.value)} />
        </div>
        <div className="field">
          <label className="label">
            Expires{typeDef?.validYears ? ` (${typeDef.validYears} yr)` : ""} <span className="req">*</span>
          </label>
          <input
            className={`input ${errors.expiry_date ? "error" : ""}`}
            type="date"
            value={form.expiry_date}
            onChange={(e) => setField("expiry_date", e.target.value)}
          />
          {errors.expiry_date && <div className="hint error">Required</div>}
        </div>
      </div>

      <div className="field">
        <label className="label">
          Photo / file {row?.file_name && <span style={{ fontWeight: 400 }}>(currently: {row.file_name})</span>}
        </label>
        <AdminFileUpload value={file} onChange={setFile} label={row?.file_name ? "Upload a new file to replace it" : "Attach a photo or file"} />
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
          <button
            type="button"
            className="btn-secondary btn-danger-outline"
            style={{ width: "auto" }}
            onClick={handleDelete}
            disabled={saving || deleting}
            title="Delete"
          >
            {deleting ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}

// Rename a vehicle / change its model across every cert it holds.
function VehicleDetailsForm({ subject, onCancel, onSaved }) {
  const [name, setName] = useState(subject.name);
  const [model, setModel] = useState(subject.model || "");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    const e = {};
    if (!name.trim()) e.name = true;
    if (!model) e.model = true;
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setError("");
    try {
      const newName = name.trim().toUpperCase();
      const { error: dbError } = await supabase
        .from("compliance_certs")
        .update({ subject_name: newName, vehicle_model: model })
        .in(
          "id",
          subject.certs.map((c) => c.id)
        );
      if (dbError) throw dbError;
      onSaved("Vehicle updated.", newName.toLowerCase());
    } catch (err) {
      console.error(err);
      setError(err.message || "Couldn't update this vehicle.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card cert-form">
      <div className="cert-form-head">
        <Truck size={18} color="var(--accent)" />
        <span>Vehicle details</span>
        <button type="button" className="icon-btn" style={{ marginLeft: "auto" }} onClick={onCancel} disabled={saving} title="Cancel">
          <X size={16} color="var(--text-muted)" />
        </button>
      </div>
      {error && (
        <div className="hint error" style={{ marginBottom: 8 }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}
      <VehicleFields name={name} model={model} errors={errors} onName={setName} onModel={setModel} />
      <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

function AddVehicleForm({ onCancel, onAdd }) {
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [errors, setErrors] = useState({});

  function handleAdd() {
    const e = {};
    if (!name.trim()) e.name = true;
    if (!model) e.model = true;
    setErrors(e);
    if (Object.keys(e).length) return;
    onAdd({ name: name.trim().toUpperCase(), model });
  }

  return (
    <div className="card cert-form">
      <div className="cert-form-head">
        <Truck size={18} color="var(--accent)" />
        <span>Add a vehicle</span>
        <button type="button" className="icon-btn" style={{ marginLeft: "auto" }} onClick={onCancel} title="Cancel">
          <X size={16} color="var(--text-muted)" />
        </button>
      </div>
      <VehicleFields name={name} model={model} errors={errors} onName={setName} onModel={setModel} />
      <div className="record-row-sub" style={{ marginBottom: 10 }}>
        The vehicle is kept once you add its first cert.
      </div>
      <button type="button" className="btn-primary" onClick={handleAdd}>
        <Plus size={16} /> Add vehicle
      </button>
    </div>
  );
}

function VehicleFields({ name, model, errors, onName, onModel }) {
  return (
    <div className="two-col">
      <div className="field">
        <label className="label">
          Registration <span className="req">*</span>
        </label>
        <input
          className={`input ${errors.name ? "error" : ""}`}
          type="text"
          placeholder="e.g. 191-D-12345"
          value={name}
          onChange={(e) => onName(e.target.value)}
          style={{ textTransform: "uppercase" }}
        />
        {errors.name && <div className="hint error">Required</div>}
      </div>
      <div className="field">
        <label className="label">
          Model <span className="req">*</span>
        </label>
        <select className={`input ${errors.model ? "error" : ""}`} value={model} onChange={(e) => onModel(e.target.value)}>
          <option value="">Select model...</option>
          {VEHICLE_MODEL_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {errors.model && <div className="hint error">Required</div>}
      </div>
    </div>
  );
}
