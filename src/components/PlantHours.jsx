import React, { useState } from "react";
import { Check, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { MACHINE_OPTIONS, dateKey } from "../lib/helpers";

const emptyForm = () => ({
  machine_name: "",
  hours: "",
  driver_name: "",
});

export default function PlantHours() {
  const [form, setForm] = useState(emptyForm());
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: false }));
  }

  function validate() {
    const newErrors = {};
    if (!form.machine_name) newErrors.machine_name = true;
    if (!form.hours || String(form.hours).trim() === "") newErrors.hours = true;
    if (!form.driver_name || !form.driver_name.trim()) newErrors.driver_name = true;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit() {
    setSubmitError("");
    if (!validate()) return;
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const payload = {
        log_date: dateKey(new Date()),
        machine_name: form.machine_name,
        hours: form.hours,
        driver_name: form.driver_name.trim(),
        created_by: userData?.user?.id || null,
      };
      const { error: insertError } = await supabase.from("machine_hours").insert(payload);
      if (insertError) throw insertError;

      setForm(emptyForm());
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
    } catch (err) {
      console.error(err);
      setSubmitError(err.message || "Something went wrong saving plant hours. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {submitted && (
        <div className="banner success">
          <Check size={16} color="var(--success)" />
          <span style={{ color: "var(--text)", fontWeight: 600 }}>Plant hours logged.</span>
        </div>
      )}
      {submitError && (
        <div className="banner error">
          <AlertCircle size={16} color="var(--danger)" />
          <span>{submitError}</span>
        </div>
      )}

      <div className="eyebrow" style={{ marginTop: 0 }}>
        Plant Hours
        <div className="eyebrow-sub">Log hours for a machine used today.</div>
      </div>

      <div className="field">
        <label className="label">
          Machine <span className="req">*</span>
        </label>
        <select
          className={`input ${errors.machine_name ? "error" : ""}`}
          value={form.machine_name}
          onChange={(e) => setField("machine_name", e.target.value)}
        >
          <option value="">Select machine...</option>
          {MACHINE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {errors.machine_name && <div className="hint error">Machine is required</div>}
      </div>

      <div className="field">
        <label className="label">
          Hours <span className="req">*</span>
        </label>
        <input
          className={`input ${errors.hours ? "error" : ""}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder="0"
          value={form.hours}
          onChange={(e) => setField("hours", e.target.value)}
        />
        {errors.hours && <div className="hint error">Hours is required</div>}
      </div>

      <div className="field">
        <label className="label">
          Driver name <span className="req">*</span>
        </label>
        <input
          className={`input ${errors.driver_name ? "error" : ""}`}
          type="text"
          placeholder="e.g. John Smith"
          value={form.driver_name}
          onChange={(e) => setField("driver_name", e.target.value)}
        />
        {errors.driver_name && <div className="hint error">Driver name is required</div>}
      </div>

      <button className="btn-primary" style={{ marginTop: 10 }} onClick={handleSubmit} disabled={submitting}>
        {submitting ? <Loader2 size={17} className="spin" /> : <Check size={17} />}
        {submitting ? "Saving..." : "Log hours"}
      </button>
    </div>
  );
}
