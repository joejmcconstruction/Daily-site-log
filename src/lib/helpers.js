export const WEATHER_OPTIONS = ["Sunny", "Overcast", "Light rain", "Heavy rain", "Showers"];

export const PROJECT_OPTIONS = ["HML The Glen", "Glenageary Demo", "Farrenboley House", "Project 1", "Project 2"];

export const LABOUR_RATE_NAME = "Labour";

export const DUCT_FIELDS = [
  { key: "trench_excavated", label: "Trench excavated", unit: "m", required: true },
  { key: "trench_backfilled", label: "Trench backfilled", unit: "m", required: true },
  { key: "esb_5inch", label: 'ESB 5" duct laid', unit: "m", required: false },
  { key: "esb_50mm", label: "ESB 50mm duct installed", unit: "m", required: false },
  { key: "public_lighting", label: "Public lighting duct installed", unit: "m", required: false },
  { key: "virgin_duct", label: "Virgin duct installed", unit: "m", required: false },
  { key: "virgin_duct_32mm", label: "Virgin duct installed (32mm)", unit: "m", required: false },
  { key: "eir_duct", label: "Eir duct installed", unit: "m", required: false },
  { key: "eir_duct_32mm", label: "Eir duct installed (32mm)", unit: "m", required: false },
  { key: "siro_duct", label: "Siro duct installed", unit: "m", required: false },
  { key: "ev_charger_duct", label: "EV charger duct installed", unit: "m", required: false },
  { key: "chambers_fitted", label: "Chambers fitted", unit: "units", required: true },
];

export const MACHINE_OPTIONS = [
  "13T Hitachi",
  "Kubota",
  "Hitachi 225",
  "Kobelco 140",
  "Wacker Neuson Excavator",
  "Yanmar 0.8T",
  "Bobcat 1T",
  "10T Thwaites Dumper",
  "6T Thwaites Dumper",
  "Wacker Plate",
];

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB per file
export const MAX_FILES = 10;

// Approximate centre of the D18 Eircode area (Sandyford, Co. Dublin) —
// Eircodes aren't reverse-geocodable for free, so this is area-level, not
// exact-address precision. Good enough for a site weather forecast.
export const SITE_LOCATION = {
  label: "D18, Sandyford, Co. Dublin",
  lat: 53.2698,
  lon: -6.2246,
};

export function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function prettyDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function shortTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function fileSizeLabel(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// Resize + compress images client-side before upload, to keep storage
// and mobile data usage down. Leaves non-images untouched.
export function compressImage(file, maxWidth = 1600, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      resolve(file);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("image load failed"));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            const compressed = new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
              type: "image/jpeg",
            });
            resolve(compressed);
          },
          "image/jpeg",
          quality
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}