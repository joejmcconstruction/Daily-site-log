import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Image as ImageIcon,
  Loader2,
  Check,
  AlertCircle,
  Trash2,
  Plus,
  X,
  FileText,
  Download,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Save,
  ScanLine,
  List,
  Euro,
} from "lucide-react";
import { PROJECT_OPTIONS, dateKey, prettyDate } from "../lib/helpers";
import { syncExcelExport } from "../lib/exportExcel";
import {
  DELIVERY_PRODUCT_OPTIONS,
  SUPPLIER_OPTIONS,
  UNIT_OPTIONS,
  DELIVERY_STATUS_OPTIONS,
  PAYMENT_OPTIONS,
  PAID_OPTIONS,
  COST_CATEGORY_OPTIONS,
  DOC_TYPE_LABEL,
  REVIEW_CONFIDENCE_THRESHOLD,
  prepareDocketFile,
  readDocket,
  emptyDraft,
  emptyItem,
  applyDocketToDraft,
  validateDraft,
  saveDraft,
  fetchDeliveries,
  rowPatchFromForm,
  updateDelivery,
  deleteDelivery,
  docketUrl,
  formatQuantity,
  formatMoney,
} from "../lib/deliveries";
import { downloadDeliveriesWorkbook } from "../lib/deliveriesExcel";

const DOC_TYPE_CHOICES = ["docket", "receipt", "invoice"];

// Period filters shared by the Register and Costs views.
function periodStart(period) {
  const now = new Date();
  if (period === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
    return { from: dateKey(d), to: null };
  }
  if (period === "month") return { from: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: null };
  if (period === "lastmonth") {
    return {
      from: dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)),
    };
  }
  return { from: null, to: null };
}

function inPeriod(d, period) {
  const { from, to } = periodStart(period);
  if (from && d.delivery_date < from) return false;
  if (to && d.delivery_date >= to) return false;
  return true;
}

export default function DeliveriesPage({ isAdmin = false }) {
  const [view, setView] = useState("add");
  const [deliveries, setDeliveries] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [banner, setBanner] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setDeliveries(await fetchDeliveries());
      setLoadError("");
    } catch (err) {
      console.error(err);
      setLoadError(err.message || "Couldn't load the register.");
    }
  }

  function flash(type, text) {
    setBanner({ type, text });
    window.setTimeout(() => setBanner(null), 3500);
  }

  function afterSave() {
    load();
    // No-op for crew accounts; keeps the admin workbook's sheets current.
    syncExcelExport().catch((err) => console.error("Excel export sync failed:", err));
  }

  // Each picked file becomes a card straight away (so the user sees progress),
  // then the reader fills it in. Cards are independent — one failing to read
  // just drops back to manual entry.
  async function handleFiles(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (!picked.length) return;
    const prepared = [];
    for (const original of picked) {
      let file = original;
      try {
        file = await prepareDocketFile(original);
      } catch (err) {
        console.error(err);
      }
      prepared.push({ ...emptyDraft({ file, fileName: original.name }), status: "reading" });
    }
    setDrafts((prev) => [...prepared, ...prev]);
    setView("add");
    prepared.forEach(runRead);
  }

  async function runRead(draft) {
    try {
      const docket = await readDocket(draft.file);
      setDrafts((prev) => prev.map((d) => (d.id === draft.id ? applyDocketToDraft(d, docket) : d)));
    } catch (err) {
      console.error(err);
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === draft.id
            ? { ...d, status: "review", flag: true, error: `${err.message || "Couldn't read this document."} Enter it by hand.` }
            : d
        )
      );
    }
  }

  function patchDraft(id, patch) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function removeDraft(id) {
    setDrafts((prev) => {
      const gone = prev.find((d) => d.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((d) => d.id !== id);
    });
  }

  async function saveOne(draft) {
    const errors = validateDraft(draft);
    if (Object.keys(errors).length) {
      patchDraft(draft.id, { errors });
      return false;
    }
    patchDraft(draft.id, { status: "saving", errors: {}, error: "" });
    try {
      await saveDraft(draft, { isAdmin });
      removeDraft(draft.id);
      return true;
    } catch (err) {
      console.error(err);
      patchDraft(draft.id, { status: "review", error: err.message || "Couldn't save this record." });
      return false;
    }
  }

  async function handleSave(draft) {
    if (await saveOne(draft)) {
      flash("success", "Saved to the register.");
      afterSave();
    }
  }

  async function handleSaveAll() {
    setSavingAll(true);
    let saved = 0;
    for (const draft of drafts.filter((d) => d.status === "review")) {
      if (await saveOne(draft)) saved += 1;
    }
    setSavingAll(false);
    if (saved) {
      flash("success", `${saved} ${saved === 1 ? "record" : "records"} saved to the register.`);
      afterSave();
    }
  }

  async function handleDownload(rows) {
    setDownloading(true);
    try {
      await downloadDeliveriesWorkbook(rows, `deliveries-${dateKey(new Date())}.xlsx`);
    } catch (err) {
      console.error(err);
      flash("error", err.message || "Couldn't build the Excel file.");
    } finally {
      setDownloading(false);
    }
  }

  const reviewCount = drafts.filter((d) => d.status === "review").length;
  const registerCount = deliveries ? deliveries.length : 0;

  return (
    <div>
      <datalist id="supplier-options">
        {SUPPLIER_OPTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="product-options">
        {DELIVERY_PRODUCT_OPTIONS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <datalist id="payment-options">
        {PAYMENT_OPTIONS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple onChange={handleFiles} style={{ display: "none" }} />
      <input ref={galleryRef} type="file" accept="image/*,application/pdf,.pdf" multiple onChange={handleFiles} style={{ display: "none" }} />

      <div className="subtabs">
        <button type="button" className={`subtab ${view === "add" ? "active" : ""}`} onClick={() => setView("add")}>
          <ScanLine size={15} />
          <span>Add</span>
          {drafts.length > 0 && <span className="subtab-count">{drafts.length}</span>}
        </button>
        <button type="button" className={`subtab ${view === "register" ? "active" : ""}`} onClick={() => setView("register")}>
          <List size={15} />
          <span>Register</span>
        </button>
        {isAdmin && (
          <button type="button" className={`subtab ${view === "costs" ? "active" : ""}`} onClick={() => setView("costs")}>
            <Euro size={15} />
            <span>Costs</span>
          </button>
        )}
      </div>

      {banner && (
        <div className={`banner ${banner.type}`}>
          {banner.type === "success" ? <Check size={16} color="var(--success)" /> : <AlertCircle size={16} color="var(--danger)" />}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{banner.text}</span>
        </div>
      )}

      {view === "add" && (
        <AddView
          drafts={drafts}
          isAdmin={isAdmin}
          reviewCount={reviewCount}
          savingAll={savingAll}
          registerCount={registerCount}
          onCamera={() => cameraRef.current?.click()}
          onGallery={() => galleryRef.current?.click()}
          onManual={() => setDrafts((prev) => [emptyDraft(), ...prev])}
          onPatch={patchDraft}
          onSave={handleSave}
          onSaveAll={handleSaveAll}
          onRemove={removeDraft}
          onShowRegister={() => setView("register")}
        />
      )}

      {view === "register" && (
        <RegisterView
          deliveries={deliveries}
          loadError={loadError}
          isAdmin={isAdmin}
          downloading={downloading}
          onDownload={handleDownload}
          onChanged={afterSave}
          onFlash={flash}
        />
      )}

      {view === "costs" && isAdmin && (
        <CostsView deliveries={deliveries} loadError={loadError} downloading={downloading} onDownload={handleDownload} />
      )}
    </div>
  );
}

// ---------- Add: capture paperwork and check what the reader found ----------

function AddView({ drafts, isAdmin, reviewCount, savingAll, registerCount, onCamera, onGallery, onManual, onPatch, onSave, onSaveAll, onRemove, onShowRegister }) {
  return (
    <div>
      <div className="scan-row">
        <button type="button" className="scan-btn" onClick={onCamera}>
          <Camera size={22} color="var(--accent)" />
          <span>Photo</span>
        </button>
        <button type="button" className="scan-btn" onClick={onGallery}>
          <ImageIcon size={22} color="var(--accent)" />
          <span>Upload / PDF</span>
        </button>
        <button type="button" className="scan-btn" onClick={onManual}>
          <Plus size={22} color="var(--accent)" />
          <span>Type it in</span>
        </button>
      </div>

      {drafts.length === 0 && (
        <div className="empty-state" style={{ padding: 22 }}>
          <div className="empty-state-title">Photograph a docket, receipt or invoice</div>
          <div>
            The details are read for you. Check them, pick the project, save.
            {registerCount > 0 && (
              <>
                {" "}
                <button type="button" className="btn-link" style={{ margin: 0, padding: 0 }} onClick={onShowRegister}>
                  {registerCount} in the register
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {drafts.length > 0 && (
        <>
          <div className="eyebrow" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
            <span>Check and save ({drafts.length})</span>
            {reviewCount > 1 && (
              <button type="button" className="btn-small" onClick={onSaveAll} disabled={savingAll}>
                {savingAll ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Save all
              </button>
            )}
          </div>
          {drafts.map((d) => (
            <DraftCard
              key={d.id}
              draft={d}
              isAdmin={isAdmin}
              onChange={(patch) => onPatch(d.id, patch)}
              onSave={() => onSave(d)}
              onRemove={() => onRemove(d.id)}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ---------- Register: browse, edit, download ----------

function RegisterView({ deliveries, loadError, isAdmin, downloading, onDownload, onChanged, onFlash }) {
  const [period, setPeriod] = useState("month");
  const [only, setOnly] = useState("all");
  const [search, setSearch] = useState("");

  const onlyOptions = useMemo(() => {
    const base = [
      ["all", "Everything"],
      ["check", "Needs check"],
      ["uninvoiced", "Dockets with no invoice"],
    ];
    if (isAdmin) base.push(["unpaid", "Unpaid"], ["nocost", "No price"]);
    return base;
  }, [isAdmin]);

  const visible = useMemo(() => {
    if (!deliveries) return [];
    const q = search.trim().toLowerCase();
    return deliveries.filter((d) => {
      if (!inPeriod(d, period)) return false;
      if (only === "check" && !d.needs_review) return false;
      if (only === "uninvoiced" && (d.invoice_ref || (d.doc_type && d.doc_type !== "docket"))) return false;
      if (only === "unpaid" && d.cost?.paid !== false) return false;
      if (only === "nocost" && d.cost?.line_total !== null && d.cost?.line_total !== undefined) return false;
      if (!q) return true;
      return [d.supplier, d.product, d.docket_no, d.vehicle_reg, d.po_number, d.location, d.invoice_ref, d.project_name, d.cost_category].some(
        (v) => (v || "").toLowerCase().includes(q)
      );
    });
  }, [deliveries, period, only, search]);

  const grouped = useMemo(() => {
    const map = new Map();
    visible.forEach((d) => {
      if (!map.has(d.delivery_date)) map.set(d.delivery_date, []);
      map.get(d.delivery_date).push(d);
    });
    return Array.from(map.entries());
  }, [visible]);

  const totals = useMemo(() => {
    const byUnit = {};
    let money = 0;
    let hasMoney = false;
    visible.forEach((d) => {
      if (d.quantity !== null && d.quantity !== undefined) {
        const u = d.unit || "";
        byUnit[u] = (byUnit[u] || 0) + Number(d.quantity);
      }
      if (d.cost && d.cost.line_total !== null && d.cost.line_total !== undefined) {
        money += Number(d.cost.line_total);
        hasMoney = true;
      }
    });
    const parts = Object.entries(byUnit).map(([u, q]) => `${formatQuantity(q)} ${u}`.trim());
    if (hasMoney) parts.push(`${formatMoney(money)} ex VAT`);
    return parts.join(" · ");
  }, [visible]);

  return (
    <div>
      <div className="pill-row">
        {[
          ["week", "This week"],
          ["month", "This month"],
          ["lastmonth", "Last month"],
          ["all", "All time"],
        ].map(([key, label]) => (
          <button key={key} className={`pill-btn small ${period === key ? "active" : ""}`} onClick={() => setPeriod(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="two-col" style={{ marginBottom: 10 }}>
        <select className="input" value={only} onChange={(e) => setOnly(e.target.value)} style={{ flex: 1 }}>
          {onlyOptions.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <input className="input" type="search" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1 }} />
      </div>

      <div className="register-summary">
        <span>
          {visible.length} {visible.length === 1 ? "line" : "lines"}
          {totals ? ` · ${totals}` : ""}
        </span>
        <button type="button" className="btn-small" onClick={() => onDownload(visible)} disabled={downloading || !visible.length}>
          {downloading ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Excel
        </button>
      </div>

      {loadError && (
        <div className="empty-state">
          <div className="empty-state-title">Couldn't load the register</div>
          <div>{loadError}</div>
        </div>
      )}

      {deliveries === null && !loadError && (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Loader2 size={22} color="var(--accent)" className="spin" />
        </div>
      )}

      {deliveries !== null && grouped.length === 0 && (
        <div className="empty-state" style={{ padding: 24 }}>
          <div className="empty-state-title">Nothing here</div>
          <div>{period === "all" && only === "all" && !search ? "Add a docket or receipt on the Add tab." : "Try a wider period or clear the filter."}</div>
        </div>
      )}

      {grouped.map(([date, rows]) => (
        <div key={date} style={{ marginBottom: 14 }}>
          <div className="date-heading">{prettyDate(date)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((row) => (
              <DeliveryRow key={row.id} row={row} isAdmin={isAdmin} onChanged={onChanged} onFlash={onFlash} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Costs (admin): what each project has cost ----------

function summariseCosts(rows) {
  const byProject = new Map();
  let noPrice = 0;
  rows.forEach((d) => {
    const lt = d.cost?.line_total;
    if (lt === null || lt === undefined) {
      if (d.doc_type === "receipt" || d.doc_type === "invoice") noPrice += 1;
      return;
    }
    const key = d.project_name || "(no project)";
    const p = byProject.get(key) || { project: key, total: 0, unpaid: 0, lines: 0, byCategory: {}, bySupplier: {} };
    const v = Number(lt);
    p.total += v;
    p.lines += 1;
    if (d.cost.paid === false) p.unpaid += v;
    const c = d.cost_category || "Uncategorised";
    p.byCategory[c] = (p.byCategory[c] || 0) + v;
    const s = d.supplier || "Unknown supplier";
    p.bySupplier[s] = (p.bySupplier[s] || 0) + v;
    byProject.set(key, p);
  });
  const projects = Array.from(byProject.values()).sort((a, b) => b.total - a.total);
  const grand = projects.reduce((sum, p) => sum + p.total, 0);
  const unpaid = projects.reduce((sum, p) => sum + p.unpaid, 0);
  return { projects, grand, unpaid, noPrice };
}

function CostsView({ deliveries, loadError, downloading, onDownload }) {
  const [period, setPeriod] = useState("month");
  const [openProject, setOpenProject] = useState(null);

  const rows = useMemo(() => (deliveries || []).filter((d) => inPeriod(d, period)), [deliveries, period]);
  const summary = useMemo(() => summariseCosts(rows), [rows]);

  return (
    <div>
      <div className="pill-row">
        {[
          ["month", "This month"],
          ["lastmonth", "Last month"],
          ["all", "All time"],
        ].map(([key, label]) => (
          <button key={key} className={`pill-btn small ${period === key ? "active" : ""}`} onClick={() => setPeriod(key)}>
            {label}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="empty-state">
          <div className="empty-state-title">Couldn't load costs</div>
          <div>{loadError}</div>
        </div>
      )}

      {deliveries === null && !loadError && (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Loader2 size={22} color="var(--accent)" className="spin" />
        </div>
      )}

      {deliveries !== null && (
        <>
          <div className="cost-total-card card">
            <div>
              <div className="cost-total-label">Materials cost, ex VAT</div>
              <div className="cost-total-value">{formatMoney(summary.grand)}</div>
              <div className="cost-total-sub">
                {summary.unpaid > 0 ? `${formatMoney(summary.unpaid)} still unpaid` : "Nothing marked unpaid"}
                {summary.noPrice > 0 ? ` · ${summary.noPrice} receipt/invoice ${summary.noPrice === 1 ? "line" : "lines"} with no price` : ""}
              </div>
            </div>
            <button type="button" className="btn-small" onClick={() => onDownload(rows)} disabled={downloading || !rows.length}>
              {downloading ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Excel
            </button>
          </div>

          {summary.projects.length === 0 && (
            <div className="empty-state" style={{ padding: 24 }}>
              <div className="empty-state-title">No costs in this period</div>
              <div>Receipts and invoices with prices show up here under their project.</div>
            </div>
          )}

          {summary.projects.map((p) => {
            const open = openProject === p.project;
            return (
              <div key={p.project} className="card" style={{ padding: 0, marginBottom: 8 }}>
                <button type="button" className="delivery-row" onClick={() => setOpenProject(open ? null : p.project)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="delivery-row-title">
                      <span>{p.project}</span>
                    </div>
                    <div className="delivery-row-sub">
                      {p.lines} {p.lines === 1 ? "line" : "lines"}
                      {p.unpaid > 0 ? ` · ${formatMoney(p.unpaid)} unpaid` : ""}
                    </div>
                  </div>
                  <span className="delivery-row-money" style={{ fontSize: 14 }}>
                    {formatMoney(p.total)}
                  </span>
                  {open ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
                </button>
                {open && (
                  <div className="delivery-edit">
                    <BreakdownList title="By category" map={p.byCategory} />
                    <BreakdownList title="By supplier" map={p.bySupplier} />
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function BreakdownList({ title, map }) {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="label" style={{ marginBottom: 4 }}>
        {title}
      </div>
      {entries.map(([name, value]) => (
        <div key={name} className="breakdown-row">
          <span>{name}</span>
          <span className="delivery-row-money">{formatMoney(value)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Shared pieces ----------

function DocketThumb({ previewUrl, isImage, href }) {
  const inner = previewUrl && isImage ? <img src={previewUrl} alt="Document" /> : <FileText size={20} color="var(--text-muted)" />;
  if (href) {
    return (
      <a className="docket-thumb" href={href} target="_blank" rel="noreferrer" title="Open">
        {inner}
      </a>
    );
  }
  return <div className="docket-thumb">{inner}</div>;
}

function ConfidenceBadge({ confidence, hasFile }) {
  if (!hasFile) return <span className="status-badge status-valid">Manual entry</span>;
  if (confidence === null || confidence === undefined) {
    return <span className="status-badge status-expired">Not read</span>;
  }
  const pct = Math.round(confidence * 100);
  const cls = confidence >= 0.9 ? "status-valid" : confidence >= REVIEW_CONFIDENCE_THRESHOLD ? "status-due-soon" : "status-expired";
  return <span className={`status-badge ${cls}`}>Read · {pct}% sure</span>;
}

function DocTypePills({ value, onChange }) {
  return (
    <div className="pill-row" style={{ marginBottom: 10 }}>
      {DOC_TYPE_CHOICES.map((t) => (
        <button key={t} type="button" className={`pill-btn small ${value === t ? "active" : ""}`} onClick={() => onChange(t)}>
          {DOC_TYPE_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

// The four fields that matter on every record, then everything else folded
// away under "More details" (opened automatically when the reader filled
// any of them in).
function HeaderFields({ value, errors = {}, onChange, docType }) {
  const isDocket = docType === "docket";
  const hasMore = !!(value.location || value.vehicle_reg || value.haulier || value.po_number || value.notes);
  return (
    <>
      <div className="two-col">
        <div className="field">
          <label className="label">
            Date <span className="req">*</span>
          </label>
          <input
            className={`input ${errors.delivery_date ? "error" : ""}`}
            type="date"
            value={value.delivery_date || ""}
            onChange={(e) => onChange("delivery_date", e.target.value)}
          />
          {errors.delivery_date && <div className="hint error">Required</div>}
        </div>
        <div className="field">
          <label className="label">{isDocket ? "Docket no" : `${DOC_TYPE_LABEL[docType] || "Doc"} no`}</label>
          <input className="input" type="text" value={value.docket_no || ""} onChange={(e) => onChange("docket_no", e.target.value)} />
        </div>
      </div>
      <div className="two-col">
        <div className="field">
          <label className="label">
            Project <span className="req">*</span>
          </label>
          <select
            className={`input ${errors.project_name ? "error" : ""}`}
            value={value.project_name || ""}
            onChange={(e) => onChange("project_name", e.target.value)}
          >
            <option value="">Select...</option>
            {PROJECT_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {errors.project_name && <div className="hint error">Pick a project</div>}
        </div>
        <div className="field">
          <label className="label">Supplier</label>
          <input className="input" type="text" list="supplier-options" value={value.supplier || ""} onChange={(e) => onChange("supplier", e.target.value)} />
        </div>
      </div>

      <details className="more-details" open={hasMore || undefined}>
        <summary>More details</summary>
        <div className="two-col">
          <div className="field">
            <label className="label">Location on site</label>
            <input
              className="input"
              type="text"
              placeholder="e.g. Unit 2 slab"
              value={value.location || ""}
              onChange={(e) => onChange("location", e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">{isDocket ? "Vehicle reg" : "PO / job ref"}</label>
            {isDocket ? (
              <input
                className="input"
                type="text"
                style={{ textTransform: "uppercase" }}
                value={value.vehicle_reg || ""}
                onChange={(e) => onChange("vehicle_reg", e.target.value)}
              />
            ) : (
              <input className="input" type="text" value={value.po_number || ""} onChange={(e) => onChange("po_number", e.target.value)} />
            )}
          </div>
        </div>
        {isDocket && (
          <div className="two-col">
            <div className="field">
              <label className="label">Haulier</label>
              <input className="input" type="text" value={value.haulier || ""} onChange={(e) => onChange("haulier", e.target.value)} />
            </div>
            <div className="field">
              <label className="label">PO no</label>
              <input className="input" type="text" value={value.po_number || ""} onChange={(e) => onChange("po_number", e.target.value)} />
            </div>
          </div>
        )}
        <div className="field">
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={value.notes || ""} onChange={(e) => onChange("notes", e.target.value)} />
        </div>
      </details>
    </>
  );
}

function ItemFields({ item, error, onChange, onRemove, showCost }) {
  return (
    <div className="item-block">
      <div className="item-row">
        <div>
          <input
            className={`input ${error ? "error" : ""}`}
            type="text"
            list="product-options"
            placeholder="Product"
            value={item.product}
            onChange={(e) => onChange("product", e.target.value)}
          />
          {error && <div className="hint error">Required</div>}
          {item.raw_description && item.raw_description !== item.product && (
            <div className="hint" style={{ marginTop: 3 }}>
              On paper: {item.raw_description}
            </div>
          )}
        </div>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          step="any"
          placeholder="Qty"
          value={item.quantity}
          onChange={(e) => onChange("quantity", e.target.value)}
        />
        <select className="input" value={item.unit || ""} onChange={(e) => onChange("unit", e.target.value)}>
          {UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
          <option value="">—</option>
        </select>
        {onRemove ? (
          <button type="button" className="icon-btn" style={{ width: 28, height: 38 }} onClick={onRemove} title="Remove line">
            <X size={14} color="var(--text-muted)" />
          </button>
        ) : (
          <span />
        )}
      </div>
      {showCost && (
        <div className="cost-row">
          <select className="input" value={item.category || ""} onChange={(e) => onChange("category", e.target.value)} title="Cost category">
            <option value="">Category...</option>
            {COST_CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="€ each"
            title="Unit price ex VAT"
            value={item.unit_price}
            onChange={(e) => onChange("unit_price", e.target.value)}
          />
          <input
            className="input"
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="€ line"
            title="Line total ex VAT"
            value={item.line_total}
            onChange={(e) => onChange("line_total", e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function CostFields({ value, onChange }) {
  return (
    <div className="two-col">
      <div className="field">
        <label className="label">Total inc VAT</label>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          step="any"
          placeholder="€"
          value={value.total}
          onChange={(e) => onChange("total", e.target.value)}
        />
      </div>
      <div className="field">
        <label className="label">Paid?</label>
        <select className="input" value={value.paid || ""} onChange={(e) => onChange("paid", e.target.value)}>
          {PAID_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label">Paid by</label>
        <input
          className="input"
          type="text"
          list="payment-options"
          placeholder="Card, cash..."
          value={value.payment_method || ""}
          onChange={(e) => onChange("payment_method", e.target.value)}
        />
      </div>
    </div>
  );
}

function DraftCard({ draft, isAdmin, onChange, onSave, onRemove }) {
  const reading = draft.status === "reading";
  const saving = draft.status === "saving";
  const errors = draft.errors || {};
  const showCost = isAdmin && (draft.docType !== "docket" || draft.showCost);

  function setHeader(key, value) {
    onChange({ header: { ...draft.header, [key]: value }, errors: { ...errors, [key]: false } });
  }
  function setItem(id, key, value) {
    onChange({
      items: draft.items.map((i) => (i.id === id ? { ...i, [key]: value } : i)),
      errors: { ...errors, [`item_${id}`]: false },
    });
  }
  function setCost(key, value) {
    onChange({ cost: { ...draft.cost, [key]: value } });
  }

  return (
    <div className="card docket-card">
      <div className="docket-card-head">
        <DocketThumb previewUrl={draft.previewUrl} isImage={draft.isImage} href={draft.isImage ? draft.previewUrl : null} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="docket-card-title">{draft.fileName || "Manual entry"}</div>
          <div className="docket-card-sub">
            {reading ? (
              <>
                <Loader2 size={12} className="spin" /> Reading...
              </>
            ) : saving ? (
              "Saving..."
            ) : (
              <ConfidenceBadge confidence={draft.confidence} hasFile={!!draft.file} />
            )}
          </div>
        </div>
        <button type="button" className="icon-btn" title="Discard" onClick={onRemove} disabled={saving}>
          <X size={16} color="var(--text-muted)" />
        </button>
      </div>

      {!reading && (
        <>
          {draft.error && (
            <div className="hint error" style={{ marginBottom: 8 }}>
              <AlertCircle size={13} /> {draft.error}
            </div>
          )}
          {draft.warnings.length > 0 && (
            <div className="warn-list">
              {draft.warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}

          <DocTypePills value={draft.docType} onChange={(t) => onChange({ docType: t })} />

          <HeaderFields value={draft.header} errors={errors} onChange={setHeader} docType={draft.docType} />

          <div className="label" style={{ margin: "10px 0 6px" }}>
            Items <span className="req">*</span>
          </div>
          {draft.items.map((item) => (
            <ItemFields
              key={item.id}
              item={item}
              error={errors[`item_${item.id}`]}
              showCost={showCost}
              onChange={(k, v) => setItem(item.id, k, v)}
              onRemove={draft.items.length > 1 ? () => onChange({ items: draft.items.filter((i) => i.id !== item.id) }) : null}
            />
          ))}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <button type="button" className="btn-link" onClick={() => onChange({ items: [...draft.items, emptyItem()] })}>
              <Plus size={13} /> Add a line
            </button>
            {isAdmin && !showCost && (
              <button type="button" className="btn-link" onClick={() => onChange({ showCost: true })}>
                <Plus size={13} /> Add prices
              </button>
            )}
          </div>

          {showCost && <CostFields value={draft.cost} onChange={setCost} />}

          {draft.docket && (
            <details className="transcript">
              <summary>What the reader saw</summary>
              <pre>{draft.docket.transcript?.trim() || "(nothing legible)"}</pre>
            </details>
          )}

          <label className="check-row">
            <input type="checkbox" checked={!!draft.flag} onChange={(e) => onChange({ flag: e.target.checked })} />
            Check against the paper later
          </label>

          <button className="btn-primary" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 size={17} className="spin" /> : <Check size={17} />}
            {saving ? "Saving..." : "Save"}
          </button>
        </>
      )}
    </div>
  );
}

function DeliveryRow({ row, isAdmin, onChanged, onFlash }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showCostForm, setShowCostForm] = useState(false);
  const cost = row.cost || {};

  function toggle() {
    if (!open) {
      setShowCostForm(false);
      setForm({
        docType: row.doc_type || "docket",
        header: {
          delivery_date: row.delivery_date || "",
          docket_no: row.docket_no || "",
          supplier: row.supplier || "",
          haulier: row.haulier || "",
          vehicle_reg: row.vehicle_reg || "",
          po_number: row.po_number || "",
          project_name: row.project_name || "",
          location: row.location || "",
          notes: row.notes || "",
        },
        item: {
          id: row.id,
          product: row.product || "",
          quantity: row.quantity ?? "",
          unit: row.unit || "",
          raw_description: "",
          unit_price: cost.unit_price ?? "",
          line_total: cost.line_total ?? "",
          vat_rate: cost.vat_rate ?? "",
          category: row.cost_category || "",
        },
        cost: {
          subtotal: "",
          vat_amount: "",
          total: cost.doc_total ?? "",
          currency: cost.currency || "EUR",
          paid: cost.paid === true ? "yes" : cost.paid === false ? "no" : "",
          payment_method: cost.payment_method || "",
        },
        invoice_ref: row.invoice_ref || "",
        status: row.status || "received",
        flag: !!row.needs_review,
      });
      setErrors({});
      setErr("");
    }
    setOpen((o) => !o);
  }

  async function save() {
    const e = {};
    if (!form.header.delivery_date) e.delivery_date = true;
    if (!form.header.project_name) e.project_name = true;
    if (!form.item.product.trim()) e.item = true;
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setErr("");
    try {
      const patch = rowPatchFromForm(form);
      await updateDelivery(row.id, patch.delivery, { cost: patch.cost, isAdmin });
      setOpen(false);
      onFlash("success", "Updated.");
      onChanged();
    } catch (error) {
      console.error(error);
      setErr(error.message || "Couldn't save the change.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this line?")) return;
    setBusy(true);
    setErr("");
    try {
      await deleteDelivery(row);
      onFlash("success", "Deleted.");
      onChanged();
    } catch (error) {
      console.error(error);
      setErr(error.message || "Couldn't delete this line.");
    } finally {
      setBusy(false);
    }
  }

  const qty = row.quantity === null || row.quantity === undefined ? "" : `${formatQuantity(row.quantity)} ${row.unit || ""}`.trim();
  const sub = [row.supplier, row.docket_no ? `#${row.docket_no}` : "", row.project_name, row.location].filter(Boolean).join(" · ");
  const fileHref = docketUrl(row.docket_path);
  const money = isAdmin && cost.line_total !== null && cost.line_total !== undefined ? formatMoney(cost.line_total) : "";
  const showCost =
    isAdmin && form && (showCostForm || form.docType !== "docket" || form.item.unit_price !== "" || form.item.line_total !== "" || form.cost.total !== "");

  return (
    <div className="card" style={{ padding: 0 }}>
      <button type="button" className="delivery-row" onClick={toggle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="delivery-row-title">
            <span>{row.product}</span>
            {qty && <span className="delivery-row-qty">{qty}</span>}
            {money && <span className="delivery-row-money">{money}</span>}
          </div>
          <div className="delivery-row-sub">{sub || "No details"}</div>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
          {row.doc_type && row.doc_type !== "docket" && <span className="status-badge status-valid">{DOC_TYPE_LABEL[row.doc_type]}</span>}
          {isAdmin && cost.paid === false && <span className="status-badge status-expired">Unpaid</span>}
          {row.needs_review && <span className="status-badge status-due-soon">Check</span>}
          {row.status && row.status !== "received" && <span className="status-badge status-expired">{row.status}</span>}
          {open ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
        </div>
      </button>

      {open && form && (
        <div className="delivery-edit">
          {fileHref && (
            <a className="btn-link" href={fileHref} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> Open {DOC_TYPE_LABEL[row.doc_type]?.toLowerCase() || "docket"}
              {row.docket_file_name ? ` (${row.docket_file_name})` : ""}
            </a>
          )}
          <DocTypePills value={form.docType} onChange={(t) => setForm((f) => ({ ...f, docType: t }))} />
          <HeaderFields
            value={form.header}
            errors={errors}
            docType={form.docType}
            onChange={(k, v) => setForm((f) => ({ ...f, header: { ...f.header, [k]: v } }))}
          />
          <div className="label" style={{ margin: "10px 0 6px" }}>
            Item <span className="req">*</span>
          </div>
          <ItemFields
            item={form.item}
            error={errors.item}
            showCost={showCost}
            onChange={(k, v) => setForm((f) => ({ ...f, item: { ...f.item, [k]: v } }))}
          />
          {isAdmin && !showCost && (
            <button type="button" className="btn-link" onClick={() => setShowCostForm(true)}>
              <Plus size={13} /> Add prices
            </button>
          )}
          {showCost && <CostFields value={form.cost} onChange={(k, v) => setForm((f) => ({ ...f, cost: { ...f.cost, [k]: v } }))} />}
          <details className="more-details" open={form.invoice_ref || form.status !== "received" ? true : undefined}>
            <summary>Invoice match and status</summary>
            <div className="two-col">
              <div className="field">
                <label className="label">Invoice ref</label>
                <input
                  className="input"
                  type="text"
                  placeholder="Supplier invoice no"
                  value={form.invoice_ref}
                  onChange={(e) => setForm((f) => ({ ...f, invoice_ref: e.target.value }))}
                />
              </div>
              <div className="field">
                <label className="label">Status</label>
                <select className="input" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  {DELIVERY_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </details>
          <label className="check-row">
            <input type="checkbox" checked={form.flag} onChange={(e) => setForm((f) => ({ ...f, flag: e.target.checked }))} />
            Check against the paper later
          </label>
          {err && (
            <div className="hint error" style={{ marginBottom: 8 }}>
              <AlertCircle size={13} /> {err}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={save} disabled={busy}>
              {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Save
            </button>
            <button className="btn-secondary btn-danger-outline" style={{ width: "auto" }} onClick={remove} disabled={busy} title="Delete">
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
