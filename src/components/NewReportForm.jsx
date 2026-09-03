import React, { useState, useRef, useEffect } from "react";
import { Check, AlertCircle, Loader2, Camera, Paperclip, Plus, X, RotateCcw, FileText, ClipboardList } from "lucide-react";
import { supabase } from "../supabaseClient";
import { WEATHER_OPTIONS, QUANTITY_FIELDS, PROJECT_OPTIONS, MACHINE_OPTIONS, dateKey, uid } from "../lib/helpers";
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
  virgin_duct_32mm: "",
  eir_duct: "",
  eir_duct_32mm: "",
  siro_duct: "",
  ev_charger_duct: "",
  chambers_fitted: "",
  water_main_trench: "",
  storm_pipework_150mm: "",
  gully_pots_fitted: "",
  tree_pits_excavated: "",
  kerb_base_prepped: "",
  road_base_prepped: "",
  cause_of_delays: "",
  additional_work: "",
});

const emptyMachineRow = () => ({ id: uid(), machine_name: "", hours: "", driver_name: "" });

const emptyDayworkRow = () => ({ id: uid(), man_name: "", machine_name: "", hours: "", activity: "" });

// Doubles as the edit form: pass editReportId and the same fields load from the
// saved report and save back over it instead of creating a new one.
export default function NewReportForm({ onSubmitted, editReportId = null, onSaved, onCancelEdit }) {
  const isEdit = !!editReportId;
  const [form, setForm] = useState(emptyForm());
  const [machines, setMachines] = useState([]);
  const [dayworks, setDayworks] = useState([]);
  const [dayworksSheets, setDayworksSheets] = useState([]);
  const [supportingFiles, setSupportingFiles] = useState([]);
  const [workPhotos, setWorkPhotos] = useState([]);
  const [existingFiles, setExistingFiles] = useState([]);
  const [removedFileIds, setRemovedFileIds] = useState([]);
  const [loadingReport, setLoadingReport] = useState(isEdit);
  const [errors, setErrors] = useState({});
  const [machineErrors, setMachineErrors] = useState({});
  const [dayworkErrors, setDayworkErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const topRef = useRef(null);

  useEffect(() => {
    if (!editReportId) return;
    let cancelled = false;
    (async () => {
      setLoadingReport(true);
      const { data: report, error: loadError } = await supabase.from("reports").select("*").eq("id", editReportId).single();
      const { data: machineData } = await supabase.from("machine_hours").select("*").eq("report_id", editReportId);
      const { data: dayworkData } = await supabase.from("dayworks").select("*").eq("report_id", editReportId);
      const { data: fileData } = await supabase.from("report_files").select("*").eq("report_id", editReportId);
      if (cancelled) return;
      if (loadError || !report) {
        setSubmitError(loadError?.message || "Couldn't load this report for editing.");
        setLoadingReport(false);
        return;
      }
      const prefilled = {};
      Object.keys(emptyForm()).forEach((key) => {
        prefilled[key] = report[key] === null || report[key] === undefined ? "" : String(report[key]);
      });
      setForm(prefilled);
      setMachines(
        (machineData || []).map((m) => ({
          id: uid(),
          machine_name: m.machine_name || "",
          hours: m.hours === null || m.hours === undefined ? "" : String(m.hours),
          driver_name: m.driver_name || "",
        }))
      );
      setDayworks(
        (dayworkData || []).map((d) => ({
          id: uid(),
          man_name: d.man_name || "",
          machine_name: d.machine_name || "",
          hours: d.hours === null || d.hours === undefined ? "" : String(d.hours),
          activity: d.activity || "",
        }))
      );
      setExistingFiles(
        (fileData || []).map((f) => ({
          ...f,
          publicUrl: supabase.storage.from("site-reports").getPublicUrl(f.storage_path).data.publicUrl,
        }))
      );
      setRemovedFileIds([]);
      setLoadingReport(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [editReportId]);

  // Existing attachments aren't deleted until the edit is saved, so removing one
  // stays reversible up to that point.
  function toggleExistingFile(id) {
    setRemovedFileIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    if (errors.workPhotos) setErrors((e) => ({ ...e, workPhotos: false }));
  }

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

  function addDaywork() {
    setDayworks((prev) => [...prev, emptyDayworkRow()]);
  }

  function removeDaywork(id) {
    setDayworks((prev) => prev.filter((d) => d.id !== id));
    setDayworkErrors((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
  }

  function setDayworkField(id, key, value) {
    setDayworks((prev) => prev.map((d) => (d.id === id ? { ...d, [key]: value } : d)));
    setDayworkErrors((e) => (e[id]?.[key] ? { ...e, [id]: { ...e[id], [key]: false } } : e));
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
    const keptPhotos = existingFiles.filter((f) => f.kind === "photo" && !removedFileIds.includes(f.id));
    if (workPhotos.length === 0 && keptPhotos.length === 0) newErrors.workPhotos = true;

    const newMachineErrors = {};
    machines.forEach((m) => {
      const rowErrors = {};
      if (!m.machine_name) rowErrors.machine_name = true;
      if (!m.hours || String(m.hours).trim() === "") rowErrors.hours = true;
      if (!m.driver_name || !m.driver_name.trim()) rowErrors.driver_name = true;
      if (Object.keys(rowErrors).length > 0) newMachineErrors[m.id] = rowErrors;
    });

    // Machine is optional on a daywork line (hand-dig work has none), the rest
    // are needed for the line to stand up as a charge.
    const newDayworkErrors = {};
    dayworks.forEach((d) => {
      const rowErrors = {};
      if (!d.man_name || !d.man_name.trim()) rowErrors.man_name = true;
      if (!d.hours || String(d.hours).trim() === "") rowErrors.hours = true;
      if (!d.activity || !d.activity.trim()) rowErrors.activity = true;
      if (Object.keys(rowErrors).length > 0) newDayworkErrors[d.id] = rowErrors;
    });

    setErrors(newErrors);
    setMachineErrors(newMachineErrors);
    setDayworkErrors(newDayworkErrors);
    return (
      Object.keys(newErrors).length === 0 &&
      Object.keys(newMachineErrors).length === 0 &&
      Object.keys(newDayworkErrors).length === 0
    );
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
        virgin_duct_32mm: form.virgin_duct_32mm || null,
        eir_duct: form.eir_duct || null,
        eir_duct_32mm: form.eir_duct_32mm || null,
        siro_duct: form.siro_duct || null,
        ev_charger_duct: form.ev_charger_duct || null,
        chambers_fitted: form.chambers_fitted || null,
        water_main_trench: form.water_main_trench || null,
        storm_pipework_150mm: form.storm_pipework_150mm || null,
        gully_pots_fitted: form.gully_pots_fitted || null,
        tree_pits_excavated: form.tree_pits_excavated || null,
        kerb_base_prepped: form.kerb_base_prepped || null,
        road_base_prepped: form.road_base_prepped || null,
        cause_of_delays: form.cause_of_delays || null,
        additional_work: form.additional_work || null,
        created_by: userData?.user?.id || null,
      };

      let reportId = editReportId;
      if (isEdit) {
        // created_by stays with whoever filed the report originally.
        const { created_by, ...updates } = payload;
        const { data: updated, error: updateError } = await supabase
          .from("reports")
          .update(updates)
          .eq("id", editReportId)
          .select()
          .maybeSingle();
        if (updateError) throw updateError;
        if (!updated) throw new Error("That report couldn't be updated — you can only edit your own reports.");
        // Machine rows are rewritten wholesale rather than diffed — they hold no
        // history of their own, so a clean replace is simpler and can't drift.
        const { error: clearError } = await supabase.from("machine_hours").delete().eq("report_id", editReportId);
        if (clearError) throw clearError;
        // Daywork rows are replaced the same way, and for the same reason.
        const { error: clearDayworkError } = await supabase.from("dayworks").delete().eq("report_id", editReportId);
        if (clearDayworkError) throw clearDayworkError;
      } else {
        const { data: inserted, error: insertError } = await supabase.from("reports").insert(payload).select().single();
        if (insertError) throw insertError;
        reportId = inserted.id;
      }

      if (machines.length > 0) {
        const machineRows = machines.map((m) => ({
          report_id: reportId,
          log_date: reportDate,
          machine_name: m.machine_name,
          hours: m.hours,
          driver_name: m.driver_name.trim(),
          created_by: userData?.user?.id || null,
        }));
        const { error: machineError } = await supabase.from("machine_hours").insert(machineRows);
        if (machineError) throw machineError;
      }

      if (dayworks.length > 0) {
        const dayworkRows = dayworks.map((d) => ({
          report_id: reportId,
          log_date: reportDate,
          man_name: d.man_name.trim(),
          machine_name: d.machine_name || null,
          hours: d.hours,
          activity: d.activity.trim(),
          created_by: userData?.user?.id || null,
        }));
        const { error: dayworkError } = await supabase.from("dayworks").insert(dayworkRows);
        if (dayworkError) throw dayworkError;
      }

      if (removedFileIds.length > 0) {
        const paths = existingFiles.filter((f) => removedFileIds.includes(f.id)).map((f) => f.storage_path);
        if (paths.length) await supabase.storage.from("site-reports").remove(paths);
        const { error: fileDeleteError } = await supabase.from("report_files").delete().in("id", removedFileIds);
        if (fileDeleteError) throw fileDeleteError;
      }

      const allFiles = [...supportingFiles, ...workPhotos, ...dayworksSheets];
      for (const item of allFiles) {
        await uploadFile(reportId, item);
      }

      try {
        await syncExcelExport();
      } catch (exportErr) {
        console.error("Excel export sync failed:", exportErr);
      }

      if (isEdit) {
        setSupportingFiles([]);
        setWorkPhotos([]);
        setDayworksSheets([]);
        onSaved?.();
        return;
      }

      setForm(emptyForm());
      setMachines([]);
      setDayworks([]);
      setSupportingFiles([]);
      setWorkPhotos([]);
      setDayworksSheets([]);
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
      onSubmitted?.();
    } catch (err) {
      console.error(err);
      setSubmitError(
        err.message ||
          (isEdit
            ? "Something went wrong saving your changes. Check your connection and try again."
            : "Something went wrong submitting the report. Check your connection and try again.")
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingReport) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
        <Loader2 size={22} color="var(--accent)" className="spin" />
      </div>
    );
  }

  const existingPhotos = existingFiles.filter((f) => f.kind === "photo");
  const existingSupporting = existingFiles.filter((f) => f.kind === "supporting");
  const existingDayworkSheets = existingFiles.filter((f) => f.kind === "dayworks");

  return (
    <div ref={topRef}>
      {isEdit && (
        <div className="banner" style={{ background: "rgba(127, 127, 127, 0.12)", border: "1px solid var(--border)" }}>
          <AlertCircle size={16} color="var(--accent)" />
          <span>Editing a saved report — saving overwrites the original.</span>
        </div>
      )}
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
      {(Object.keys(errors).length > 0 || Object.keys(machineErrors).length > 0 || Object.keys(dayworkErrors).length > 0) && (
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
        <div className="hint">
          Everyone's full hours, including anyone driving plant or on dayworks — machine and daywork hours below are
          subtracted automatically, so no one's time is counted twice.
        </div>
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
        Site Quantities
        <div className="eyebrow-sub">Ducting, drainage, kerbing &amp; roads. Enter quantities for today — leave blank if not applicable.</div>
      </div>
      <div className="duct-grid">
        {QUANTITY_FIELDS.map((f) => (
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

      <div className="eyebrow">
        Dayworks
        <div className="eyebrow-sub">
          One row per man and activity carried out on dayworks today (optional). Enter the labour and machine hours above as
          full totals for the day as normal — just say here how much of that time was daywork. Upload the signed sheet below.
        </div>
      </div>
      {dayworks.map((d) => {
        const rowErr = dayworkErrors[d.id] || {};
        return (
          <div className="machine-row" key={d.id}>
            <button type="button" className="machine-row-remove" onClick={() => removeDaywork(d.id)}>
              <X size={13} color="var(--text-muted)" />
            </button>
            <div style={{ display: "flex", gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="label">
                  Man <span className="req">*</span>
                </label>
                <input
                  className={`input ${rowErr.man_name ? "error" : ""}`}
                  type="text"
                  placeholder="Name"
                  value={d.man_name}
                  onChange={(e) => setDayworkField(d.id, "man_name", e.target.value)}
                />
                {rowErr.man_name && <div className="hint error">Man is required</div>}
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="label">Hours <span className="req">*</span></label>
                <input
                  className={`input ${rowErr.hours ? "error" : ""}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={d.hours}
                  onChange={(e) => setDayworkField(d.id, "hours", e.target.value)}
                />
                {rowErr.hours && <div className="hint error">Hours is required</div>}
              </div>
            </div>
            <div className="field">
              <label className="label">Machine</label>
              <select className="input" value={d.machine_name} onChange={(e) => setDayworkField(d.id, "machine_name", e.target.value)}>
                <option value="">None — hand work</option>
                {MACHINE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label">
                Description of activity <span className="req">*</span>
              </label>
              <textarea
                className={`input ${rowErr.activity ? "error" : ""}`}
                rows={2}
                placeholder="What was done, and who instructed it"
                value={d.activity}
                onChange={(e) => setDayworkField(d.id, "activity", e.target.value)}
              />
              {rowErr.activity && <div className="hint error">Description of activity is required</div>}
            </div>
          </div>
        );
      })}
      <button type="button" className="btn-secondary" onClick={addDaywork}>
        <Plus size={15} /> Add daywork line
      </button>

      <div className="eyebrow" style={{ marginTop: 22 }}>
        Signed dayworks sheet
        <div className="eyebrow-sub">Photo or scan of the sheet signed off on site (optional).</div>
      </div>
      {existingDayworkSheets.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {existingDayworkSheets.map((f) => {
            const removed = removedFileIds.includes(f.id);
            return (
              <div key={f.id} className="card" style={{ display: "flex", alignItems: "center", gap: 10, opacity: removed ? 0.45 : 1 }}>
                <FileText size={16} color="var(--text-muted)" />
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.file_name}
                </div>
                <button type="button" className="icon-btn" onClick={() => toggleExistingFile(f.id)}>
                  {removed ? <RotateCcw size={14} color="var(--text-muted)" /> : <X size={14} color="var(--text-muted)" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <FileUpload
        files={dayworksSheets}
        setFiles={setDayworksSheets}
        accept="image/*,.pdf,.doc,.docx"
        label="Add signed dayworks sheet"
        icon={ClipboardList}
        kind="dayworks"
      />

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
      {existingPhotos.length > 0 && (
        <div className="file-grid" style={{ marginBottom: 12 }}>
          {existingPhotos.map((f) => {
            const removed = removedFileIds.includes(f.id);
            return (
              <div key={f.id} className="file-thumb" style={{ opacity: removed ? 0.35 : 1 }}>
                <img src={f.publicUrl} alt={f.file_name} />
                <button type="button" className="file-thumb-remove" onClick={() => toggleExistingFile(f.id)}>
                  {removed ? <RotateCcw size={12} color="#fff" /> : <X size={12} color="#fff" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
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
      {existingSupporting.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {existingSupporting.map((f) => {
            const removed = removedFileIds.includes(f.id);
            return (
              <div key={f.id} className="card" style={{ display: "flex", alignItems: "center", gap: 10, opacity: removed ? 0.45 : 1 }}>
                <FileText size={16} color="var(--text-muted)" />
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.file_name}
                </div>
                <button type="button" className="icon-btn" onClick={() => toggleExistingFile(f.id)}>
                  {removed ? <RotateCcw size={14} color="var(--text-muted)" /> : <X size={14} color="var(--text-muted)" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
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
        {submitting ? (isEdit ? "Saving..." : "Submitting...") : isEdit ? "Save changes" : "Submit report"}
      </button>
      {isEdit && (
        <button className="btn-secondary" style={{ marginTop: 10, width: "100%" }} onClick={onCancelEdit} disabled={submitting}>
          Cancel
        </button>
      )}
    </div>
  );
}
