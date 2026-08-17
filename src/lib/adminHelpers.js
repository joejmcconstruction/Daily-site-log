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
