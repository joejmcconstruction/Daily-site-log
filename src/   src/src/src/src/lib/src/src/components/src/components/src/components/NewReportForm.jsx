import React, { useState, useRef } from "react";
import { Check, AlertCircle, Loader2, Camera, Paperclip } from "lucide-react";
import { supabase } from "../supabaseClient";
import { WEATHER_OPTIONS, DUCT_FIELDS, dateKey, uid } from "../lib/helpers";
import FileUpload from "./FileUpload";

const emptyForm = () => ({
  weather: "",
  staff_on_site: "",
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

export default function NewReportForm({ onSubmitted }) {
  const [form, setForm] = useState(emptyForm());
  const [supportingFiles, setSupportingFiles] = useState([]);
  const [workPhotos, setWorkPhotos] = useState([]);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const topRef = useRef(null);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: false }));
  }

  function validate() {
    const req = {
      weather: form.weather,
      staff_on_site: form.staff_on_site,
      description: form.description,
      trench_excavated: form.trench_excavated,
      trench_backfilled: form.trench_backfilled,
    };
    const newErrors = {};
    Object.entries(req).forEach(([k, v]) => {
      if (!v || String(v).trim() === "") newErrors[k] = true;
    });
    if (workPhotos.length === 0) newErrors.workPhotos = true;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
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
      const payload = {
        report_date: dateKey(new Date()),
        weather: form.weather,
        staff_on_site: form.staff_on_site,
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

      const allFiles = [...supportingFiles, ...workPhotos];
      for (const item of allFiles) {
        await uploadFile(inserted.id, item);
      }

      setForm(emptyForm());
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
      {Object.keys(errors).length > 0 && (
        <div className="banner error">
          <AlertCircle size={16} color="var(--danger)" />
          <span>Fill in the required fields marked in red below.</span>
        </div>
      )}

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
        <label
      
