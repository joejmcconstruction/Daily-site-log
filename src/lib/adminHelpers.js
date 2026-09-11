export const VEHICLE_CERT_TYPES = ["NCT", "Tax", "Insurance"];

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
