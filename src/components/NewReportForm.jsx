import React, { useState, useRef } from "react";
import { Check, AlertCircle, Loader2, Camera, Paperclip, Plus, X } from "lucide-react";
import { supabase } from "../supabaseClient";
import { WEATHER_OPTIONS, DUCT_FIELDS, PROJECT_OPTIONS, MACHINE_OPTIONS, dateKey, uid } from "../lib/helpers";
import { syncExcelExport } from "../lib/exportExcel";
import FileUpload from "./FileUpload";

const emptyForm = () => ({
  report_date: dateKey(new Date()),
  project_name: "",
  weather: "",
  staff_on_site: "",
  labour_hours: "",
  description: "",
  trench_excavated: "",
  trench_backfilled: "",
  esb_5inch: "",
  esb_50mm: "",
  public_lighting: "",
  virgin_duct: "",
  eir_duct: "",
  siro_duct: "",
  ev_charger_duct: "",
  chambers_fitted: "",
  cause_of_delays: "",
  additional_work: "",
});

const emptyMachineRow = () => ({ id: uid(), machine_name: "", hours: "", driver_name: "" });

export default function NewReportForm({ onSubmitted }) {
  const [form, setForm] = useState(emptyForm());
  const [machines, setMachines] = useState([]);
  const [supportingFiles, setSupportingFiles] = useState([]);
  const [workPhotos, setWorkPhotos] = useState([]);
  const [errors, setErrors] = useState({});
  const [machineErrors, setMachineErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const topRef = useRef(null);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: false }));
  }

  function addMachine() {
    setMachines((prev) => [...prev, emptyMachineRow()]);
  }

  function removeMachine(id) {
    setMachines((prev) => prev.filter((m) => m.id !== id));
    setMachineErrors((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
  }

  function setMachineField(id, key, value) {
    setMachines((prev) => prev.map((m) => (m.id === id ? { ...m, [key]: value } : m)));
    setMachineErrors((e) => (e[id]?.[key] ? { ...e, [id]: { ...e[id], [key]: false } } : e));
  }

  function validate() {
    const req = {
      report_date: form.report_date,
      project_name: form.project_name,
      weather: form.weather,
      staff_on_site: form.staff_on_site,
      labour_hours: form.labour_hours,
      description: form.description,
      trench_excavated: form.trench_excavated,
      trench_backfilled: form.trench_backfilled,
      chambers_fitted: form.chambers_fitted,
    };
    const newErrors = {};
    Object.entries(req).forEach(([k, v]) => {
      if (!v || String(v).trim() === "") newErrors[k] = true;
    });
    if (workPhotos.length === 0) newErrors.workPhotos = true;

    const newMachineErrors = {};
    machines.forEach((m) => {
      const rowErrors = {};
      if (!m.machine_name) rowErrors.machine_name = true;
      if (!m.hours || String(m.hours).trim() === "") rowErrors.hours = true;
      if (!m.driver_name || !m.driver_name.trim()) rowErrors.driver_name = true;
      if (Object.keys(rowErrors).length > 0) newMachineErrors[m.id] = rowErrors;
    });

    setErrors(newErrors);
    setMachineErrors(newMachineErrors);
    return Object.keys(newErrors).length === 0 && Object.keys(newMachineErrors).length === 0;
  }

  async function uploadFile(reportId, item) {
    const ext = item.name.split(".").pop();
    const path = `${reportId}/${item.kind}-${uid()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("site-reports").upload(path, item.file, {
      contentType: item.type,
      upsert: false,
    });
    if (uploadError) throw uploadError;
    const { error: rowError } = await supabase.from("report_files").insert({
      report_id: reportId,
      storage_path: path,
      file_name: item.name,
      file_type: item.type,
      file_size: item.size,
      kind: item.kind,
    });
    if (rowError) throw rowError;
  }

  async function handleSubmit() {
    setSubmitError("");
    if (!validate()) {
      topRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const reportDate = form.report_date;
      const payload = {
        report_date: reportDate,
        project_name: form.project_name,
        weather: form.weather,
        staff_on_site: form.staff_on_site,
        labour_hours: form.labour_hours || null,
        description: form.description,
        trench_excavated: form.trench_excavated || null,
        trench_backfilled: form.trench_backfilled || null,
        esb_5inch: form.esb_5inch || null,
        esb_50mm: form.esb_50mm || null,
        public_lighting: form.public_lighting || null,
        virgin_duct: form.virgin_duct || null,
        eir_duct: form.eir_duct || null,
        siro_duct: form.siro_duct || null,
        ev_charger_duct: form.ev_charger_duct || null,
        chambers_fitted: form.chambers_fitted || null,
        cause_of_delays: form.cause_of_delays || null,
        additional_work: form.additional_work || null,
        created_by: userData?.user?.id || null,
      };

      const { data: inserted, error: insertError } = await supabase.from("reports").insert(payload).select().single();
      if (insertError) throw insertError;

      if (machines.length > 0) {
        const machineRows = machines.map((m) => ({
          report_id: inserted.id,
          log_date: reportDate,
          machine_name: m.machine_name,
          hours: m.hours,
          driver_name: m.driver_name.trim(),
          created_by: userData?.user?.id || null,
        }));
        const { error: machineError } = await supabase.from("machine_hours").insert(machineRows);
        if (machineError) throw machineError;
      }

      const allFiles = [...supportingFiles, ...workPhotos];
      for (const item of allFiles) {
        await uploadFile(inserted.id, item);
      }

      try {
        await syncExcelExport();
      } catch (exportErr) {
        console.error("Excel export sync failed:", exportErr);
      }

      setForm(emptyForm());
      setMachines([]);
      setSupportingFiles([]);
      setWorkPhotos([]);
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
      onSubmitted?.();
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || "Something went wrong submitting the report. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div ref={topRef}>
      {submitted && (
        <div className="banner success">
          <Check size={16} color="var(--success)" />
          <span style={{ color: "var(--text)", fontWeight: 600 }}>Report submitted and saved.</span>
        </div>
      )}
      {submitError && (
        <div className="banner error">
          <AlertCircle size={16} color="var(--danger)" />
          <span>{submitError}</span>
        </div>
      )}
      {(Object.keys(errors).length > 0 || Object.keys(machineErrors).length > 0) && (
        <div className="banner error">
          <AlertCircle size={16} color="var(--danger)" />
          <span>Fill in the required fields marked in red below.</span>
        </div>
      )}

      <div className="eyebrow" style={{ marginTop: 0 }}>Project</div>
      <div className="field">
        <label className="label">
          Report date <span className="req">*</span>
        </label>
        <input
          className={`input ${errors.report_date ? "error" : ""}`}
          type="date"
          max={dateKey(new Date())}
          value={form.report_date}
          onChange={(e) => setField("report_date", e.target.value)}
        />
        <div className="hint">Defaults to today — change this to back-log a report for an earlier day.</div>
        {errors.report_date && <div className="hint error">Report date is required</div>}
      </div>
      <div className="field">
        <label className="label">
          Which project is this report for? <span className="req">*</span>
        </label>
        <select
          className={`input ${errors.project_name ? "error" : ""}`}
          value={form.project_name}
          onChange={(e) => setField("project_name", e.target.value)}
        >
          <option value="">Select project...</option>
          {PROJECT_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {errors.project_name && <div className="hint error">Project is required</div>}
      </div>

      <div className="eyebrow">Conditions</div>
      <div className="field">
        <label className="label">
          Weather <span className="req">*</span>
        </label>
        <select className={`input ${errors.weather ? "error" : ""}`} value={form.weather} onChange={(e) => setField("weather", e.target.value)}>
          <option value="">Select weather...</option>
          {WEATHER_OPTIONS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        {errors.weather && <div className="hint error">Weather is required</div>}
      </div>

      <div className="field">
        <label className="label">
          Staff on site <span className="req">*</span>
        </label>
        <input
          className={`input ${errors.staff_on_site ? "error" : ""}`}
          type="text"
          placeholder="e.g. 4 (2x general operative, 1x foreman, 1x driver)"
          value={form.staff_on_site}
          onChange={(e) => setField("staff_on_site", e.target.value)}
        />
        {errors.staff_on_site && <div className="hint error">Staff on site is required</div>}
      </div>

      <div className="field">
        <label className="label">
          Labour hours (total man-hours on site today) <span className="req">*</span>
        </label>
        <input
          className={`input ${errors.labour_hours ? "error" : ""}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder="0"
          value={form.labour_hours}
          onChange={(e) => setField("labour_hours", e.target.value)}
        />
        <div className="hint">Everyone's full hours, including anyone driving plant — machine hours below are subtracted automatically so driving time isn't paid twice.</div>
        {errors.labour_hours && <div className="hint error">Labour hours is required</div>}
      </div>

      <div className="field">
        <label className="label">
          Work description <span className="req">*</span>
        </label>
        <textarea
          className={`input ${errors.description ? "error" : ""}`}
          rows={4}
          placeholder="Describe the work carried out today..."
          value={form.description}
          onChange={(e) => setField("description", e.target.value)}
        />
        {errors.description && <div className="hint error">Work description is required</div>}
      </div>

      <div className="eyebrow">
        Ducting &amp; Trenching
        <div className="eyebrow-sub">Enter quantities for today. Leave blank if not applicable.</div>
      </div>
      <div className="duct-grid">
        {DUCT_FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label className="label">
              {f.label} {f.required && <span className="req">*</span>}
              {f.unit && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> ({f.unit})</span>}
            </label>
            <input
              className={`input ${errors[f.key] ? "error" : ""}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="0"
              value={form[f.key]}
              onChange={(e) => setField(f.key, e.target.value)}
            />
            {errors[f.key] && <div className="hint error">{f.label} is required</div>}
          </div>
        ))}
      </div>

      <div className="eyebrow">
        Plant / Machine Hours
        <div className="eyebrow-sub">Add a row for each machine used on site today (optional).</div>
      </div>
      {machines.map((m) => {
        const rowErr = machineErrors[m.id] || {};
        return (
          <div className="machine-row" key={m.id}>
            <button type="button" className="machine-row-remove" onClick={() => removeMachine(m.id)}>
              <X size={13} color="var(--text-muted)" />
            </button>
            <div className="field">
              <label className="label">
                Machine <span className="req">*</span>
              </label>
              <select
                className={`input ${rowErr.machine_name ? "error" : ""}`}
                value={m.machine_name}
                onChange={(e) => setMachineField(m.id, "machine_name", e.target.value)}
              >
                <option value="">Select machine...</option>
                {MACHINE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              {rowErr.machine_name && <div className="hint error">Machine is required</div>}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label className="label">
                  Hours <span className="req">*</span>
                </label>
                <input
                  className={`input ${rowErr.hours ? "error" : ""}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={m.hours}
                  onChange={(e) => setMachineField(m.id, "hours", e.target.value)}
                />
                {rowErr.hours && <div className="hint error">Hours is required</div>}
              </div>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label className="label">
                  Driver <span className="req">*</span>
                </label>
                <input
                  className={`input ${rowErr.driver_name ? "error" : ""}`}
                  type="text"
                  placeholder="Name"
                  value={m.driver_name}
                  onChange={(e) => setMachineField(m.id, "driver_name", e.target.value)}
                />
                {rowErr.driver_name && <div className="hint error">Driver is required</div>}
              </div>
            </div>
          </div>
        );
      })}
      <button type="button" className="btn-secondary" onClick={addMachine}>
        <Plus size={15} /> Add machine
      </button>

      <div className="eyebrow">Delays &amp; Variations</div>
      <div className="field">
        <label className="label">Cause of delays</label>
        <textarea
          className="input"
          rows={3}
          placeholder="Any delays and their cause (weather, access, materials, etc.)"
          value={form.cause_of_delays}
          onChange={(e) => setField("cause_of_delays", e.target.value)}
        />
      </div>
      <div className="field">
        <label className="label">Variations / additional work</label>
        <textarea
          className="input"
          rows={3}
          placeholder="Any work carried out outside the original scope"
          value={form.additional_work}
          onChange={(e) => setField("additional_work", e.target.value)}
        />
      </div>

      <div className="eyebrow">
        Photos <span className="req">*</span>
        <div className="eyebrow-sub">At least one photo of the work is required.</div>
      </div>
      <FileUpload
        files={workPhotos}
        setFiles={setWorkPhotos}
        accept="image/*"
        label="Add work photo"
        icon={Camera}
        kind="photo"
      />
      {errors.workPhotos && <div className="hint error">At least one work photo is required</div>}

      <div className="eyebrow" style={{ marginTop: 22 }}>
        Supporting files
        <div className="eyebrow-sub">Delivery dockets, sign-off sheets, or other documents (optional).</div>
      </div>
      <FileUpload
        files={supportingFiles}
        setFiles={setSupportingFiles}
        accept="image/*,.pdf,.doc,.docx"
        label="Add supporting file"
        icon={Paperclip}
        kind="supporting"
      />

      <button className="btn-primary" style={{ marginTop: 24 }} onClick={handleSubmit} disabled={submitting}>
        {submitting ? <Loader2 size={17} className="spin" /> : <Check size={17} />}
        {submitting ? "Submitting..." : "Submit report"}
      </button>
    </div>
  );
}
