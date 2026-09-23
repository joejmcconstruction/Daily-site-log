export const WEATHER_OPTIONS = ["Sunny", "Overcast", "Light rain", "Heavy rain", "Showers"];

// "General" is for business costs that don't belong to one job (fuel for the
// vans, PPE, office bits) so they still get logged and costed.
export const PROJECT_OPTIONS = ["Horizon Swords", "Tallaght School", "General", "HML The Glen", "Glenageary Demo", "Farrenboley House", "Project 1", "Project 2"];

export const LABOUR_RATE_NAME = "Labour";

// Every measured quantity captured on a daily report, grouped into the sub-tabs
// the foreman fills them in under. This is the only list: the form's fields and
// save payload, the report detail view and the Excel export columns are all
// built from it — add a field here plus a matching column in schema.sql and it
// flows through everywhere.
export const QUANTITY_GROUPS = [
  {
    key: "ducting",
    label: "Ducting",
    title: "Ducting & Trenching",
    fields: [
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
      { key: "water_main_trench", label: "Water main trench excavated", unit: "m", required: false },
    ],
  },
  {
    key: "drainage",
    label: "Drainage",
    title: "Drainage & Landscaping",
    fields: [
      { key: "storm_pipework_150mm", label: "Storm pipework fitted (150mm)", unit: "m", required: false },
      { key: "gully_pots_fitted", label: "Gully pots fitted", unit: "units", required: false },
      { key: "tree_pits_excavated", label: "Tree pits excavated", unit: "units", required: false },
    ],
  },
  {
    key: "substructure",
    label: "Substructure",
    title: "Substructure",
    fields: [
      { key: "aj_600mm", label: "AJ 600mm diameter", unit: "m", required: false },
      { key: "aj_450mm", label: "AJ 450mm diameter", unit: "m", required: false },
      { key: "aj_300mm", label: "AJ 300mm diameter", unit: "m", required: false },
      { key: "foul_pipe_4inch", label: '4" foul pipe installed', unit: "m", required: false },
      { key: "pop_ups_installed", label: "Pop ups installed", unit: "nr", required: false },
      { key: "base_stone_build_up", label: "Stone build up to base", unit: "m³", required: false },
      { key: "house_base_reduced_dig", label: "House base formation reduced dig", unit: "m³", required: false },
    ],
  },
  {
    key: "roads",
    label: "Road Prep",
    title: "Road Prep",
    fields: [
      { key: "kerb_prep_excavation", label: "Kerb prep excavation", unit: "m", required: false },
      { key: "kerb_prep_build_up", label: "Kerb prep build up", unit: "m", required: false },
      { key: "road_formation_reduced_dig", label: "Road formation reduced dig", unit: "m³", required: false },
      { key: "road_formation_stone_build_up", label: "Road formation stone build up", unit: "m³", required: false },
      { key: "kerb_base_prepped", label: "Kerb base prepped", unit: "m", required: false },
      { key: "road_base_prepped", label: "Road base prepped", unit: "m²", required: false },
    ],
  },
  {
    // TSL Swords (Horizon) — pad-by-pad progress is captured separately in
    // pad_progress (see PAD_ACTIVITIES); these are the attenuation tank
    // quantities that sit on the same tab.
    key: "tsl",
    label: "TSL Swords",
    title: "TSL Swords",
    pads: true,
    fields: [
      { key: "att_membrane_m2", label: "Attenuation membrane installed", unit: "m²", required: false },
      { key: "att_stone_m3", label: "Attenuation stone installed", unit: "m³", required: false },
    ],
  },
];

export const QUANTITY_FIELDS = QUANTITY_GROUPS.flatMap((g) => g.fields);

// Pad foundations on TSL Swords: each stage is ticked off pad by pad on the
// daily report, one pad_progress row per pad per stage per day.
export const PAD_COUNT = 50;
export const PAD_NUMBERS = Array.from({ length: PAD_COUNT }, (_, i) => i + 1);
export const PAD_ACTIVITIES = [
  { key: "excavate", label: "Excavate pad", done: "Excavated" },
  { key: "blinding", label: "Blinding", done: "Blinded" },
  { key: "rebar", label: "Rebar complete", done: "Rebar" },
  { key: "shutter", label: "Shutter complete", done: "Shuttered" },
  { key: "concrete", label: "Concrete poured", done: "Poured" },
];
export const emptyPads = () => Object.fromEntries(PAD_ACTIVITIES.map((a) => [a.key, []]));

export const MACHINE_OPTIONS = [
  "13T Hitachi",
  "Kubota",
  "Hitachi 225",
  "Kobelco 140",
  "Wacker Neuson Excavator",
  "Yanmar 0.8T",
  "Bobcat 1T",
  "Hyundai Duck",
  "10T Thwaites Dumper",
  "6T Thwaites Dumper",
  "Wacker Plate",
];

export const VEHICLE_MODEL_OPTIONS = [
  "Berlingo",
  "Caddy",
  "Ranger",
  "Volvo XC60",
  "Tiguan",
  "Ford Focus",
  "Opel Movano",
  "Fastrac",
  "Ford Tipper",
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