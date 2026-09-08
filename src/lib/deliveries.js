import { supabase } from "../supabaseClient";
import { compressImage, dateKey, uid } from "./helpers";

export const DOCKET_BUCKET = "dockets";

// Pick lists. Free text is always allowed — these just put the common ones a
// tap away and give the docket reader names to snap to. Edit to suit the job,
// the same way MACHINE_OPTIONS is edited in helpers.js.
export const DELIVERY_PRODUCT_OPTIONS = [
  "Clause 804",
  "Clause 808",
  "6F2 crushed concrete",
  "Drainage stone 20mm",
  "Pea gravel 10mm",
  "Pipe bedding",
  "Sand",
  "Blinding",
  "Stone dust",
  "Topsoil",
  "Muck away",
  "Concrete C20/25",
  "Concrete C25/30",
  "Concrete C30/37",
  "Concrete C35/45",
  "Lean mix",
  "150mm pipe",
  "225mm pipe",
  "300mm pipe",
  "Ducting",
  "Manhole rings",
  "Manhole covers & frames",
  "Gully pots",
  "Kerbs",
  "Geotextile",
  "Rebar / mesh",
  "Blocks",
  "Diesel",
];

export const SUPPLIER_OPTIONS = ["Roadstone", "Kilsaran", "Breedon", "Chadwicks", "Heiton Buckley", "Wavin"];

export const UNIT_OPTIONS = ["t", "m³", "m", "units", "loads", "L", "kg", "bags"];

export const DELIVERY_STATUS_OPTIONS = ["received", "queried", "rejected"];

// Below this the reader's own confidence flags the delivery for checking
// against the paper docket, on top of any warnings it raised.
export const REVIEW_CONFIDENCE_THRESHOLD = 0.75;

// Vercel serverless functions refuse request bodies over 4.5 MB, and base64
// adds a third, so anything bigger is stored but has to be typed in by hand.
export const MAX_DOCKET_READ_BYTES = 3.3 * 1024 * 1024;

// Dockets are photographed at arm's length with small print and handwritten
// tonnages, so keep more detail than the report photos get.
export async function prepareDocketFile(file) {
  if (!file.type.startsWith("image/")) return file;
  return compressImage(file, 2000, 0.8);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read the file."));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

// Sends the docket to /api/read-docket (see api/read-docket.js) and returns
// the fields the reader found. Throws with a plain-English message on failure
// so the card can show it and fall back to manual entry.
export async function readDocket(file) {
  if (file.size > MAX_DOCKET_READ_BYTES) {
    throw new Error("File is too big to read automatically (max 3 MB).");
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  const data = await blobToBase64(file);
  const res = await fetch("/api/read-docket", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      data,
      media_type: file.type,
      known_products: DELIVERY_PRODUCT_OPTIONS,
      known_suppliers: SUPPLIER_OPTIONS,
    }),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(json?.error || `Docket reader failed (${res.status}).`);
  }
  if (!json?.docket) throw new Error("Docket reader returned nothing.");
  return json.docket;
}

const UNIT_ALIASES = {
  t: "t",
  tonne: "t",
  tonnes: "t",
  ton: "t",
  tons: "t",
  tn: "t",
  tne: "t",
  m3: "m³",
  "m³": "m³",
  "cu m": "m³",
  "cubic metres": "m³",
  "cubic meters": "m³",
  m: "m",
  metre: "m",
  metres: "m",
  meter: "m",
  meters: "m",
  lm: "m",
  "l/m": "m",
  unit: "units",
  units: "units",
  each: "units",
  ea: "units",
  no: "units",
  nr: "units",
  pcs: "units",
  pieces: "units",
  load: "loads",
  loads: "loads",
  l: "L",
  litre: "L",
  litres: "L",
  liter: "L",
  liters: "L",
  ltr: "L",
  ltrs: "L",
  kg: "kg",
  kgs: "kg",
  bag: "bags",
  bags: "bags",
};

export function normaliseUnit(raw) {
  if (!raw) return "";
  const key = String(raw).trim().toLowerCase();
  return UNIT_ALIASES[key] || "";
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function emptyItem() {
  return { id: uid(), product: "", quantity: "", unit: "t", raw_description: "" };
}

// A draft is one docket (or one manual entry) sitting on screen waiting to be
// checked and saved. status: reading | review | saving.
export function emptyDraft({ file = null, fileName = "" } = {}) {
  const isImage = !!file && file.type.startsWith("image/");
  return {
    id: uid(),
    file,
    fileName: fileName || file?.name || "",
    previewUrl: file && isImage ? URL.createObjectURL(file) : null,
    isImage,
    status: "review",
    docket: null,
    confidence: null,
    warnings: [],
    error: "",
    errors: {},
    flag: false,
    header: {
      delivery_date: dateKey(new Date()),
      docket_no: "",
      supplier: "",
      haulier: "",
      vehicle_reg: "",
      po_number: "",
      project_name: "",
      location: "",
      notes: "",
    },
    items: [emptyItem()],
  };
}

// Fills a draft from what the reader returned. Anything it couldn't read stays
// blank, and the draft is flagged for checking when the reader was unsure,
// raised a warning, or missed a date or quantity.
export function applyDocketToDraft(draft, docket) {
  const warnings = Array.isArray(docket.warnings) ? docket.warnings.filter(Boolean) : [];
  if (docket.is_docket === false) {
    warnings.unshift(docket.notes || "This doesn't look like a delivery docket.");
  } else if (docket.notes) {
    warnings.push(docket.notes);
  }

  const items = (Array.isArray(docket.items) ? docket.items : [])
    .filter((i) => i && i.product)
    .map((i) => ({
      id: uid(),
      product: String(i.product).trim(),
      quantity: typeof i.quantity === "number" ? i.quantity : "",
      unit: normaliseUnit(i.unit),
      raw_description: i.raw_description || "",
    }));

  const confidence = typeof docket.confidence === "number" ? Math.max(0, Math.min(1, docket.confidence)) : null;
  const missingCore = !isIsoDate(docket.delivery_date) || items.length === 0 || items.some((i) => i.quantity === "");
  const flag =
    docket.is_docket === false || missingCore || warnings.length > 0 || confidence === null || confidence < REVIEW_CONFIDENCE_THRESHOLD;

  const noteBits = [];
  if (docket.delivery_time) noteBits.push(`Delivered ${docket.delivery_time}`);

  return {
    ...draft,
    status: "review",
    docket,
    confidence,
    warnings,
    flag,
    header: {
      ...draft.header,
      delivery_date: isIsoDate(docket.delivery_date) ? docket.delivery_date : draft.header.delivery_date,
      docket_no: docket.docket_no || "",
      supplier: docket.supplier || "",
      haulier: docket.haulier || "",
      vehicle_reg: docket.vehicle_reg || "",
      po_number: docket.po_number || "",
      notes: noteBits.join(" · "),
    },
    items: items.length ? items : draft.items,
  };
}

export function validateDraft(draft) {
  const errors = {};
  if (!draft.header.delivery_date) errors.delivery_date = true;
  draft.items.forEach((item) => {
    if (!item.product.trim()) errors[`item_${item.id}`] = true;
  });
  return errors;
}

function clean(value) {
  const s = (value ?? "").toString().trim();
  return s ? s : null;
}

function toQuantity(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function uploadDocketFile(draft) {
  if (!draft.file) return { docket_path: null, docket_file_name: null };
  const ext = (draft.file.name.split(".").pop() || "jpg").toLowerCase();
  const docket_path = `dockets/${uid()}.${ext}`;
  const { error } = await supabase.storage.from(DOCKET_BUCKET).upload(docket_path, draft.file, {
    contentType: draft.file.type,
    upsert: false,
  });
  if (error) throw error;
  return { docket_path, docket_file_name: draft.fileName || draft.file.name };
}

// Uploads the docket once and inserts one deliveries row per material line.
export async function saveDraft(draft) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id || null;
  const { docket_path, docket_file_name } = await uploadDocketFile(draft);
  const docket_group = uid();
  const h = draft.header;

  const rows = draft.items.map((item) => ({
    created_by: userId,
    delivery_date: h.delivery_date,
    docket_no: clean(h.docket_no),
    supplier: clean(h.supplier),
    haulier: clean(h.haulier),
    vehicle_reg: clean(h.vehicle_reg)?.toUpperCase() || null,
    po_number: clean(h.po_number),
    project_name: clean(h.project_name),
    location: clean(h.location),
    notes: clean(h.notes),
    product: item.product.trim(),
    quantity: toQuantity(item.quantity),
    unit: clean(item.unit),
    needs_review: !!draft.flag,
    status: "received",
    docket_path,
    docket_file_name,
    docket_group,
    extraction: draft.docket || null,
  }));

  const { error } = await supabase.from("deliveries").insert(rows);
  if (error) throw error;
  return rows.length;
}

export function docketUrl(path) {
  if (!path) return null;
  return supabase.storage.from(DOCKET_BUCKET).getPublicUrl(path).data?.publicUrl || null;
}

export async function fetchDeliveries() {
  const { data, error } = await supabase
    .from("deliveries")
    .select("*")
    .order("delivery_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Builds the update payload for an existing row from the row-edit form.
export function rowPatchFromForm(form) {
  const h = form.header;
  return {
    delivery_date: h.delivery_date,
    docket_no: clean(h.docket_no),
    supplier: clean(h.supplier),
    haulier: clean(h.haulier),
    vehicle_reg: clean(h.vehicle_reg)?.toUpperCase() || null,
    po_number: clean(h.po_number),
    project_name: clean(h.project_name),
    location: clean(h.location),
    notes: clean(h.notes),
    product: form.item.product.trim(),
    quantity: toQuantity(form.item.quantity),
    unit: clean(form.item.unit),
    invoice_ref: clean(form.invoice_ref),
    status: form.status || "received",
    needs_review: !!form.flag,
  };
}

export async function updateDelivery(id, patch) {
  const { error } = await supabase.from("deliveries").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteDelivery(row) {
  const { error } = await supabase.from("deliveries").delete().eq("id", row.id);
  if (error) throw error;
  // Only remove the photo once no other line still points at it.
  if (row.docket_path) {
    const { count } = await supabase
      .from("deliveries")
      .select("id", { count: "exact", head: true })
      .eq("docket_path", row.docket_path);
    if (!count) {
      await supabase.storage.from(DOCKET_BUCKET).remove([row.docket_path]);
    }
  }
}

export function formatQuantity(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
