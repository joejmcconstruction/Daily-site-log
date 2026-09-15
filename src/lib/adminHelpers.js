export const VEHICLE_CERT_TYPES = ["NCT", "CVRT", "Tax", "Insurance"];

// 5-day notice window, per Joe's spec — matches the in-app badges and the
// email alert job (Phase 2).
export const EXPIRY_WARNING_DAYS = 5;

// "expired" | "due-soon" | "valid" | "none"
export function expiryStatus(dateStr) {
  if (!dateStr) return "none";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = dateStr.split("-").map(Number);
  const expiry = new Date(y, m - 1, d);
  const diffDays = Math.round((expiry - today) / 86400000);
  if (diffDays < 0) return "expired";
  if (diffDays <= EXPIRY_WARNING_DAYS) return "due-soon";
  return "valid";
}

export const EXPIRY_STATUS_LABEL = {
  expired: "Expired",
  "due-soon": "Due soon",
  valid: "Valid",
  none: "No date set",
};

// ---------- Staff safety certs ----------
// The cards every operative carries, as tap-to-add presets. validYears fills
// the expiry date in from the date obtained (still editable). The first three
// are the "core" cards shown as chips on every employee row.
export const CERT_TYPES = [
  { key: "safe_pass", label: "Safe Pass", short: "Safe Pass", validYears: 4, core: true },
  { key: "manual_handling", label: "Manual Handling", short: "Man. Handling", validYears: 3, core: true },
  {
    key: "cscs",
    label: "CSCS",
    short: "CSCS",
    validYears: 5,
    core: true,
    details: [
      "360° Excavator",
      "180° Excavator",
      "Mini Digger",
      "Site Dumper",
      "Teleporter",
      "Roller",
      "Slinger / Signaller",
      "Signing, Lighting & Guarding",
      "Locating Underground Services",
      "MEWP",
      "Other",
    ],
  },
  { key: "first_aid", label: "First Aid", short: "First Aid", validYears: 2, core: false },
  { key: "other", label: "Other cert / training", short: "Other", validYears: null, core: false },
];

export const CERT_TYPE_BY_KEY = Object.fromEntries(CERT_TYPES.map((t) => [t.key, t]));

// Older rows only have training_name; guess the type from it so they still
// show as chips. Matches the SQL backfill in schema.sql.
export function certTypeOf(row) {
  if (row.cert_type && CERT_TYPE_BY_KEY[row.cert_type]) return row.cert_type;
  const n = (row.training_name || "").toLowerCase();
  if (n.includes("safe pass")) return "safe_pass";
  if (n.includes("manual handling")) return "manual_handling";
  if (n.includes("cscs")) return "cscs";
  if (n.includes("first aid")) return "first_aid";
  return "other";
}

export function certLabel(row) {
  const key = certTypeOf(row);
  if (key === "other") return row.training_name || "Other";
  const type = CERT_TYPE_BY_KEY[key];
  const detail = row.cert_detail || (key === "cscs" ? cscsDetailFromName(row.training_name) : "");
  return detail ? `${type.label} · ${detail}` : type.label;
}

function cscsDetailFromName(name) {
  if (!name) return "";
  const stripped = name.replace(/cscs/i, "").replace(/^[\s:\-–·]+/, "").trim();
  return stripped;
}

// "2028-03-12" -> "12 Mar 2028"
export function shortDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

export function addYears(iso, years) {
  if (!iso || !years) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y + years, m - 1, d);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// For each core cert type, the record that matters (latest expiry), so the
// employee row can show one chip per card.
export function coreCertSummary(rows) {
  const best = {};
  rows.forEach((row) => {
    const key = certTypeOf(row);
    const current = best[key];
    if (!current || (row.expiry_date || "") > (current.expiry_date || "")) best[key] = row;
  });
  return CERT_TYPES.filter((t) => t.core).map((t) => {
    const row = best[t.key];
    const count = rows.filter((r) => certTypeOf(r) === t.key).length;
    return { type: t, row: row || null, count, status: row ? expiryStatus(row.expiry_date) : "missing" };
  });
}

// ---------- Plant & vehicle certs ----------
// Each machine / vehicle is one card with a chip per "slot" — the certs it
// should always hold. A slot is satisfied by any of its types (the
// roadworthiness test is an NCT on a car and a CVRT on a van or lorry).
// Anything else on file shows as an extra chip. validYears fills the expiry
// in from the date obtained; it stays editable.
export const VEHICLE_CERT_PRESETS = [
  { key: "NCT", label: "NCT", validYears: 1 },
  { key: "CVRT", label: "CVRT", validYears: 1 },
  { key: "Tax", label: "Tax", validYears: 1 },
  { key: "Insurance", label: "Insurance", validYears: 1 },
  { key: "Other", label: "Other", validYears: null },
];

export const VEHICLE_CERT_SLOTS = [
  { key: "test", label: "NCT / CVRT", types: ["NCT", "CVRT"] },
  { key: "tax", label: "Tax", types: ["Tax"] },
  { key: "insurance", label: "Insurance", types: ["Insurance"] },
];

export const MACHINE_CERT_PRESETS = [
  { key: "GA1", label: "GA1", validYears: 1 },
  { key: "Insurance", label: "Insurance", validYears: 1 },
  { key: "Service", label: "Service", validYears: 1 },
  { key: "Other", label: "Other", validYears: null },
];

export const MACHINE_CERT_SLOTS = [{ key: "ga1", label: "GA1", types: ["GA1"] }];

// GA1 (thorough examination) is for lifting equipment — the excavators.
// Dumpers, plates and rollers have nothing mandatory, so they only show
// what's on file.
export function machineCertSlots(machineName) {
  return /dumper|plate|roller/i.test(machineName || "") ? [] : MACHINE_CERT_SLOTS;
}

export const CERT_CATEGORY = {
  machine: { presets: MACHINE_CERT_PRESETS, noun: "machine" },
  vehicle: { presets: VEHICLE_CERT_PRESETS, noun: "vehicle" },
};

function sameType(a, b) {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
}

export function slotForCert(certType, slots) {
  return slots.find((s) => s.types.some((t) => sameType(t, certType))) || null;
}

// The preset button a stored cert_type belongs to ("Other" for custom ones).
export function presetForCert(certType, presets) {
  return presets.find((p) => p.key !== "Other" && sameType(p.key, certType)) || presets.find((p) => p.key === "Other");
}

function latestExpiry(rows) {
  return rows.reduce((best, r) => (!best || (r.expiry_date || "") > (best.expiry_date || "") ? r : best), null);
}

// One chip per slot (struck through when missing), then one per extra cert
// type on file. Each chip reports the record with the latest expiry.
export function certSlotSummary(rows, slots) {
  const bySlot = slots.map((slot) => {
    const matching = rows.filter((r) => slotForCert(r.cert_type, slots)?.key === slot.key);
    const row = latestExpiry(matching);
    return { key: slot.key, label: slot.label, row, count: matching.length, status: row ? expiryStatus(row.expiry_date) : "missing", required: true };
  });
  const extras = new Map();
  rows
    .filter((r) => !slotForCert(r.cert_type, slots))
    .forEach((r) => {
      const k = (r.cert_type || "").trim().toLowerCase();
      extras.set(k, [...(extras.get(k) || []), r]);
    });
  const extraItems = [...extras.entries()].map(([k, list]) => {
    const row = latestExpiry(list);
    return { key: `extra:${k}`, label: row.cert_type, row, count: list.length, status: expiryStatus(row.expiry_date), required: false };
  });
  return [...bySlot, ...extraItems];
}

const STATUS_RANK = { expired: 0, "due-soon": 1, missing: 2, none: 3, valid: 4 };

export function worstStatus(summary) {
  return summary.reduce((worst, s) => (STATUS_RANK[s.status] < STATUS_RANK[worst] ? s.status : worst), "valid");
}

// Group cert rows into one entry per machine name / vehicle registration.
// Keys are lower-cased so "191-d-123" and "191-D-123" land together.
export function groupCertsBySubject(certs, category) {
  const groups = new Map();
  certs
    .filter((c) => c.category === category)
    .forEach((c) => {
      const name = (c.subject_name || "").trim();
      const key = name.toLowerCase();
      if (!groups.has(key)) groups.set(key, { key, name, model: c.vehicle_model || "", certs: [] });
      const g = groups.get(key);
      g.certs.push(c);
      if (!g.model && c.vehicle_model) g.model = c.vehicle_model;
    });
  return groups;
}
