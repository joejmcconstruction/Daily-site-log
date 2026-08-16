import React, { useEffect, useState } from "react";
import { Loader2, AlertCircle, Check, Save, Download } from "lucide-react";
import { supabase } from "../supabaseClient";
import { exportToExcel } from "../lib/exportExcel";

const currency = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });

export default function CostsPage() {
  const [rates, setRates] = useState(null);
  const [ratesDraft, setRatesDraft] = useState({});
  const [savingRates, setSavingRates] = useState(false);
  const [ratesSaved, setRatesSaved] = useState(false);
  const [error, setError] = useState("");

  const [reports, setReports] = useState(null);
  const [machineHours, setMachineHours] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: fetchError } = await supabase.from("cost_rates").select("*").order("rate_type").order("name");
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setRates(data || []);
      const draft = {};
      (data || []).forEach((r) => {
        draft[r.id] = String(r.hourly_rate ?? 0);
      });
      setRatesDraft(draft);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [reportsRes, machineRes] = await Promise.all([
        supabase.from("reports").select("id, report_date, project_name, labour_hours"),
        supabase.from("machine_hours").select("id, report_id, log_date, machine_name, hours, driver_name"),
      ]);
      if (cancelled) return;
      if (reportsRes.error) {
        setError(reportsRes.error.message);
        return;
      }
      if (machineRes.error) {
        setError(machineRes.error.message);
        return;
      }
      setReports(reportsRes.data || []);
      setMachineHours(machineRes.data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateDraft(id, value) {
    setRatesDraft((d) => ({ ...d, [id]: value }));
  }

  async function saveRates() {
    setSavingRates(true);
    setError("");
    try {
      for (const r of rates) {
        const val = Number(ratesDraft[r.id]) || 0;
        if (val !== r.hourly_rate) {
          const { error: updateError } = await supabase
            .from("cost_rates")
            .update({ hourly_rate: val, updated_at: new Date().toISOString() })
            .eq("id", r.id);
          if (updateError) throw updateError;
        }
      }
      setRates((prev) => prev.map((r) => ({ ...r, hourly_rate: Number(ratesDraft[r.id]) || 0 })));
      setRatesSaved(true);
      setTimeout(() => setRatesSaved(false), 2500);
    } catch (err) {
      console.error(err);
      setError(err.message || "Couldn't save rates.");
    } finally {
      setSavingRates(false);
    }
  }

  const loading = rates === null || reports === null || machineHours === null;

  let projectRows = [];
  if (!loading) {
    const machineRateByName = {};
    let labourRate = 0;
    rates.forEach((r) => {
      if (r.rate_type === "machine") machineRateByName[r.name] = Number(r.hourly_rate) || 0;
      if (r.rate_type === "labour") labourRate = Number(r.hourly_rate) || 0;
    });

    const reportById = {};
    reports.forEach((r) => {
      reportById[r.id] = r;
    });

    const byProject = {};
    function bucket(name) {
      if (!byProject[name]) {
        byProject[name] = { project: name, machineHours: 0, machineCost: 0, labourHours: 0, labourCost: 0 };
      }
      return byProject[name];
    }

    reports.forEach((r) => {
      const name = r.project_name || "Unassigned";
      const b = bucket(name);
      const hrs = Number(r.labour_hours) || 0;
      b.labourHours += hrs;
      b.labourCost += hrs * labourRate;
    });

    machineHours.forEach((m) => {
      const report = m.report_id ? reportById[m.report_id] : null;
      const name = report?.project_name || "Unassigned";
      const b = bucket(name);
      const hrs = Number(m.hours) || 0;
      const rate = machineRateByName[m.machine_name] || 0;
      b.machineHours += hrs;
      b.machineCost += hrs * rate;
    });

    projectRows = Object.values(byProject)
      .map((b) => ({ ...b, totalCost: b.machineCost + b.labourCost }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }

  function handleExport() {
    setExporting(true);
    setExportError("");
    try {
      exportToExcel({ reports, machineHours, projectRows });
    } catch (err) {
      console.error(err);
      setExportError("Couldn't build the Excel file.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="eyebrow" style={{ marginTop: 0 }}>
        Project Costs
        <div className="eyebrow-sub">Machine + labour hours logged, valued at your hourly rates.</div>
      </div>

      {error && (
        <div className="banner error">
          <AlertCircle size={16} color="var(--danger)" />
          <span>{error}</span>
        </div>
      )}

      <button className="btn-primary" onClick={handleExport} disabled={loading || exporting}>
        {exporting ? <Loader2 size={17} className="spin" /> : <Download size={17} />}
        {exporting ? "Building file..." : "Export to Excel"}
      </button>
      {exportError && (
        <div className="hint error" style={{ marginTop: 8 }}>
          <AlertCircle size={13} /> {exportError}
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Loader2 size={22} color="var(--accent)" className="spin" />
        </div>
      )}

      {!loading && projectRows.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-title">No cost data yet</div>
          <div>Submit a report with labour or machine hours to see costs here.</div>
        </div>
      )}

      {!loading && projectRows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
          {projectRows.map((p) => (
            <div className="cost-card" key={p.project}>
              <div className="cost-card-title">{p.project}</div>
              <div className="cost-card-row">
                <span>Machine hours</span>
                <span>
                  {p.machineHours.toFixed(1)} h · {currency.format(p.machineCost)}
                </span>
              </div>
              <div className="cost-card-row">
                <span>Labour hours</span>
                <span>
                  {p.labourHours.toFixed(1)} h · {currency.format(p.labourCost)}
                </span>
              </div>
              <div className="cost-card-row cost-card-total">
                <span>Total operating cost</span>
                <span>{currency.format(p.totalCost)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="eyebrow">
        Hourly Rates
        <div className="eyebrow-sub">Set what each machine and an hour of labour costs. Used for the totals above.</div>
      </div>

      {ratesSaved && (
        <div className="banner success">
          <Check size={16} color="var(--success)" />
          <span style={{ color: "var(--text)", fontWeight: 600 }}>Rates saved.</span>
        </div>
      )}

      {rates === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
          <Loader2 size={20} color="var(--accent)" className="spin" />
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rates.map((r) => (
              <div className="rate-row" key={r.id}>
                <span className="rate-row-label">{r.name}</span>
                <div className="rate-row-input">
                  <span>€</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={ratesDraft[r.id] ?? ""}
                    onChange={(e) => updateDraft(r.id, e.target.value)}
                  />
                  <span>/hr</span>
                </div>
              </div>
            ))}
          </div>
          <button className="btn-secondary" style={{ marginTop: 12 }} onClick={saveRates} disabled={savingRates}>
            {savingRates ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
            {savingRates ? "Saving..." : "Save rates"}
          </button>
        </>
      )}
    </div>
  );
}
