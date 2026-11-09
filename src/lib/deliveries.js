import { supabase } from "../supabaseClient";
import { compressImage, dateKey, uid } from "./helpers";
import { COST_CATEGORY_OPTIONS, DOC_TYPE_LABEL } from "./costCategories";

export { COST_CATEGORY_OPTIONS, DOC_TYPE_LABEL };

export const DOCKET_BUCKET = "dockets";

// Pick lists. Free text is always allowed — these just put the common ones a
// tap away and give the document reader names to snap to. Edit to suit the
// job, the same way MACHINE_OPTIONS is edited in helpers.js.
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

export const SUPPLIER_OPTIONS = ["Roadstone", "Kilsaran", "Breedon", "Chadwicks", "Heiton Buckley", "Brooks", "Wavin", "Screwfix"];

export const UNIT_OPTIONS = ["t", "m³", "m", "units", "loads", "L", "kg", "bags"];

export const DELIVERY_STATUS_OPTIONS = ["received", "queried", "rejected"];

export const PAYMENT_OPTIONS = ["Card", "Cash", "Account", "Bank transfer", "Other"];

// Value stored in a draft/form for the paid state, and its label.
export const PAID_OPTIONS = [
  ["", "Not stated"],
  ["yes", "Paid"],
  ["no", "Unpaid"],
];

// Below this the reader's own confidence flags the record for checking
// against the paper, on top of any warnings it raised.
export const REVIEW_CONFIDENCE_THRESHOLD = 0.75;

// Vercel serverless functions refuse request bodies over 4.5 MB, and base64
// adds a third, so anything bigger is stored but has to be typed in by hand.
export const MAX_DOCKET_READ_BYTES = 3 * 1024 * 1024;

// Dockets are photographed at arm's length with small print and handwritten
// tonnages, so keep more detail than the report photos get.
export async function prepareDocketFile(file) {
  if (!file.type.startsWith("image/")) return file;
  return compressImage(file, 2000, 0.8);
}

// Most photographed pages that can be joined into one document. Beyond this
// the joined file can't stay under the reader's size limit and still be legible.
export const MAX_DOCKET_PAGES = 8;

// Tried in order until the joined pages fit under MAX_DOCKET_READ_BYTES:
// [longest edge in px, JPEG quality].
const PAGE_ENCODINGS = [
  [1800, 0.8],
  [1600, 0.72],
  [1400, 0.62],
  [1200, 0.5],
];

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't open one of the pages."));
    };
    img.src = url;
  });
}

function pageToJpeg(img, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  // JPEG has no transparency, so a see-through PNG page would come out black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Couldn't prepare one of the pages."));
          return;
        }
        blob
          .arrayBuffer()
          .then((buffer) => resolve({ bytes: new Uint8Array(buffer), width: canvas.width, height: canvas.height }))
          .catch(reject);
      },
      "image/jpeg",
      quality
    );
  });
}

// A PDF whose pages are the given JPEGs, one per page. PDF stores JPEG data
// as-is (the DCTDecode filter), so this needs no PDF library: three objects
// per page (page, image, drawing instruction) plus the byte-offset table.
function buildPdfFromJpegs(pages) {
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const startObject = (n) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
  };
  const pageObject = (i) => 3 + i * 3;

  push("%PDF-1.4\n");
  // Four high bytes in a comment mark the file as binary for anything sniffing it.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  startObject(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  startObject(2);
  push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObject(i)} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    const pageNo = pageObject(i);
    const imageNo = pageNo + 1;
    const contentNo = pageNo + 2;
    // A4 width in points; height follows the photo's own shape.
    const w = 595;
    const h = Math.round(((w * page.height) / page.width) * 100) / 100;

    startObject(pageNo);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageNo} 0 R >> >> /Contents ${contentNo} 0 R >>\nendobj\n`
    );

    startObject(imageNo);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`
    );
    push(page.bytes);
    push("\nendstream\nendobj\n");

    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    startObject(contentNo);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });

  const objectCount = 3 + pages.length * 3; // object 0 plus catalog, page list and three per page
  const xrefAt = length;
  push(`xref\n0 ${objectCount}\n0000000000 65535 f \n`);
  for (let n = 1; n < objectCount; n += 1) {
    push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

// Joins photographed pages of one docket into a single PDF, so a multi-page
// docket is read, stored and opened as one document. Pages are shrunk step by
// step until the whole file fits what the reader accepts.
export async function combinePagesToPdf(files, fileName = "docket.pdf") {
  const images = [];
  for (const file of files) images.push(await loadImage(file));
  const budget = MAX_DOCKET_READ_BYTES - 16 * 1024;
  for (const [maxEdge, quality] of PAGE_ENCODINGS) {
    const pages = [];
    for (const img of images) pages.push(await pageToJpeg(img, maxEdge, quality));
    const total = pages.reduce((sum, p) => sum + p.bytes.length, 0);
    if (total <= budget) {
      return new File([buildPdfFromJpegs(pages)], fileName, { type: "application/pdf" });
    }
  }
  throw new Error("These pages are too big to read as one document. Try fewer pages.");
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

// Sends the document to /api/read-docket (see api/read-docket.js) and returns
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
    throw new Error(json?.error || `Document reader failed (${res.status}).`);
  }
  if (!json?.docket) throw new Error("Document reader returned nothing.");
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

function numOrBlank(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

const DOC_TYPE_FROM_MODEL = {
  delivery_docket: "docket",
  receipt: "receipt",
  invoice: "invoice",
  other: "other",
};

export function emptyItem() {
  return { id: uid(), product: "", quantity: "", unit: "units", raw_description: "", unit_price: "", line_total: "", vat_rate: "", category: "" };
}

export function emptyCost() {
  return { subtotal: "", vat_amount: "", total: "", currency: "EUR", paid: "", payment_method: "" };
}

// A draft is one document (or one manual entry) sitting on screen waiting to
// be checked and saved. status: reading | review | saving.
export function emptyDraft({ file = null, fileName = "" } = {}) {
  const isImage = !!file && file.type.startsWith("image/");
  return {
    id: uid(),
    file,
    // The photographed pages behind `file`. One photo is sent as it is; once a
    // second page is added, `file` becomes a PDF joining them (combinePagesToPdf).
    pages: isImage ? [file] : [],
    fileName: fileName || file?.name || "",
    previewUrl: file && isImage ? URL.createObjectURL(file) : null,
    isImage,
    status: "review",
    mode: "edit",
    docket: null,
    docType: "docket",
    showCost: false,
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
    cost: emptyCost(),
  };
}

// Fills a draft from what the reader returned. Anything it couldn't read stays
// blank, and the draft is flagged for checking when the reader was unsure,
// raised a warning, or missed a date or quantity.
export function applyDocketToDraft(draft, docket) {
  const warnings = Array.isArray(docket.warnings) ? docket.warnings.filter(Boolean) : [];
  const docType = DOC_TYPE_FROM_MODEL[docket.document_type] || "other";
  if (docType === "other") {
    warnings.unshift(docket.notes || "This doesn't look like a docket, receipt or invoice.");
  } else if (docket.notes) {
    warnings.push(docket.notes);
  }

  const items = (Array.isArray(docket.items) ? docket.items : [])
    .filter((i) => i && i.product)
    .map((i) => {
      const quantity = numOrBlank(i.quantity);
      const unitPrice = numOrBlank(i.unit_price);
      let lineTotal = numOrBlank(i.line_total);
      if (lineTotal === "" && quantity !== "" && unitPrice !== "") {
        lineTotal = Math.round(quantity * unitPrice * 100) / 100;
      }
      return {
        id: uid(),
        product: String(i.product).trim(),
        quantity,
        unit: normaliseUnit(i.unit) || (docType === "docket" ? "" : "units"),
        raw_description: i.raw_description || "",
        unit_price: unitPrice,
        line_total: lineTotal,
        vat_rate: numOrBlank(i.vat_rate),
        category: COST_CATEGORY_OPTIONS.includes(i.category) ? i.category : "",
      };
    });

  // Till receipts print inc-VAT prices per line. Costs are tracked ex VAT, so
  // scale them back using the document's own subtotal/total when both are
  // printed, otherwise the line's VAT rate. Left as printed if neither exists.
  const subtotal = numOrBlank(docket.subtotal_ex_vat);
  const totalInc = numOrBlank(docket.total_inc_vat);
  const anyPrice = items.some((i) => i.unit_price !== "" || i.line_total !== "");
  if (docket.prices_include_vat === true && anyPrice) {
    const docFactor = subtotal !== "" && totalInc !== "" && subtotal > 0 && totalInc > 0 && subtotal <= totalInc ? subtotal / totalInc : null;
    let converted = 0;
    items.forEach((i) => {
      const factor = docFactor ?? (i.vat_rate !== "" && i.vat_rate >= 0 ? 1 / (1 + i.vat_rate / 100) : null);
      if (factor === null) return;
      if (i.unit_price !== "") i.unit_price = Math.round(i.unit_price * factor * 100) / 100;
      if (i.line_total !== "") i.line_total = Math.round(i.line_total * factor * 100) / 100;
      converted += 1;
    });
    if (converted > 0) warnings.push("Receipt prices include VAT; converted to ex VAT for costing.");
    else warnings.push("Receipt prices include VAT and no VAT rate was printed; entered as printed.");
  }

  const confidence = typeof docket.confidence === "number" ? Math.max(0, Math.min(1, docket.confidence)) : null;
  const missingCore = !isIsoDate(docket.delivery_date) || items.length === 0 || items.some((i) => i.quantity === "");
  const flag = docType === "other" || missingCore || warnings.length > 0 || confidence === null || confidence < REVIEW_CONFIDENCE_THRESHOLD;

  const noteBits = [];
  if (docket.delivery_time) noteBits.push(`Time ${docket.delivery_time}`);
  if (docket.customer_name) noteBits.push(`Customer: ${docket.customer_name}`);

  const cost = {
    subtotal: numOrBlank(docket.subtotal_ex_vat),
    vat_amount: numOrBlank(docket.vat_amount),
    total: numOrBlank(docket.total_inc_vat),
    currency: docket.currency || "EUR",
    paid: docket.paid === true ? "yes" : docket.paid === false ? "no" : "",
    payment_method: docket.payment_method || "",
  };

  return {
    ...draft,
    status: "review",
    // Straight to the one-glance summary when the read is usable; open the
    // full form only when something the save needs is missing.
    mode: docType === "other" || missingCore ? "edit" : "summary",
    docket,
    docType: docType === "other" ? "docket" : docType,
    showCost: draft.showCost || items.some((i) => i.unit_price !== "" || i.line_total !== "") || cost.total !== "",
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
    cost,
  };
}

export function validateDraft(draft) {
  const errors = {};
  if (!draft.header.delivery_date) errors.delivery_date = true;
  // Every line is filed under a project so its cost lands somewhere.
  if (!draft.header.project_name) errors.project_name = true;
  draft.items.forEach((item) => {
    if (!item.product.trim()) errors[`item_${item.id}`] = true;
  });
  return errors;
}

export function draftHasCost(draft) {
  return draft.items.some((i) => i.unit_price !== "" || i.line_total !== "") || draft.cost.total !== "";
}

function clean(value) {
  const s = (value ?? "").toString().trim();
  return s ? s : null;
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function paidToBool(value) {
  if (value === "yes" || value === true) return true;
  if (value === "no" || value === false) return false;
  return null;
}

// The copy of the reader's output stored on the crew-visible deliveries row:
// prices, totals and the transcript (which quotes prices) are stripped. The
// full output goes on the admin-only delivery_costs row.
function redactExtraction(docket) {
  if (!docket) return null;
  const { transcript, subtotal_ex_vat, vat_amount, total_inc_vat, currency, paid, payment_method, ...rest } = docket;
  return {
    ...rest,
    items: (Array.isArray(docket.items) ? docket.items : []).map(({ unit_price, line_total, vat_rate, ...item }) => item),
    redacted: true,
  };
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

// Uploads the document once and inserts one deliveries row per material
// line; admins also get a delivery_costs row per line when there are prices.
export async function saveDraft(draft, { isAdmin = false } = {}) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id || null;
  const { docket_path, docket_file_name } = await uploadDocketFile(draft);
  const docket_group = uid();
  const h = draft.header;

  const rows = draft.items.map((item) => ({
    created_by: userId,
    delivery_date: h.delivery_date,
    doc_type: draft.docType || "docket",
    docket_no: clean(h.docket_no),
    supplier: clean(h.supplier),
    haulier: clean(h.haulier),
    vehicle_reg: clean(h.vehicle_reg)?.toUpperCase() || null,
    po_number: clean(h.po_number),
    project_name: clean(h.project_name),
    location: clean(h.location),
    notes: clean(h.notes),
    product: item.product.trim(),
    quantity: toNumber(item.quantity),
    unit: clean(item.unit),
    cost_category: clean(item.category),
    needs_review: !!draft.flag,
    status: "received",
    docket_path,
    docket_file_name,
    docket_group,
    extraction: redactExtraction(draft.docket),
  }));

  const { data: inserted, error } = await supabase.from("deliveries").insert(rows).select("id, product");
  if (error) throw error;

  if (isAdmin && inserted && inserted.length === rows.length) {
    // Returned rows normally come back in insert order; fall back to matching
    // by product name if they don't, so a price never lands on the wrong line.
    const remaining = [...inserted];
    const idFor = (i) => {
      let idx = remaining.findIndex((r) => r.product === rows[i].product);
      if (idx === -1) idx = 0;
      return remaining.splice(idx, 1)[0].id;
    };
    const costRows = draft.items.map((item, i) => ({
      delivery_id: idFor(i),
      created_by: userId,
      unit_price: toNumber(item.unit_price),
      line_total: toNumber(item.line_total),
      vat_rate: toNumber(item.vat_rate),
      doc_total: toNumber(draft.cost.total),
      currency: clean(draft.cost.currency) || "EUR",
      paid: paidToBool(draft.cost.paid),
      payment_method: clean(draft.cost.payment_method),
      extraction: i === 0 ? draft.docket || null : null,
    }));
    const hasAny = costRows.some((c) =>
      [c.unit_price, c.line_total, c.vat_rate, c.doc_total, c.paid, c.payment_method].some((v) => v !== null && v !== undefined)
    );
    if (hasAny) {
      const { error: costError } = await supabase.from("delivery_costs").insert(costRows);
      if (costError) throw new Error(`Lines saved, but the prices couldn't be saved: ${costError.message}`);
    }
  }
  return rows.length;
}

export function docketUrl(path) {
  if (!path) return null;
  return supabase.storage.from(DOCKET_BUCKET).getPublicUrl(path).data?.publicUrl || null;
}

// Register rows with, for admins, a `cost` object merged in from
// delivery_costs. RLS returns no cost rows to crew accounts, so the same
// query serves everyone.
export async function fetchDeliveries() {
  const [dRes, cRes] = await Promise.all([
    supabase.from("deliveries").select("*").order("delivery_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("delivery_costs").select("*"),
  ]);
  if (dRes.error) throw dRes.error;
  if (cRes.error) console.warn("delivery_costs not readable:", cRes.error.message);
  const costById = {};
  (cRes.data || []).forEach((c) => {
    costById[c.delivery_id] = c;
  });
  return (dRes.data || []).map((r) => ({ ...r, cost: costById[r.id] || null }));
}

// Builds the update payloads for an existing row from the row-edit form.
export function rowPatchFromForm(form) {
  const h = form.header;
  return {
    delivery: {
      delivery_date: h.delivery_date,
      doc_type: form.docType || "docket",
      docket_no: clean(h.docket_no),
      supplier: clean(h.supplier),
      haulier: clean(h.haulier),
      vehicle_reg: clean(h.vehicle_reg)?.toUpperCase() || null,
      po_number: clean(h.po_number),
      project_name: clean(h.project_name),
      location: clean(h.location),
      notes: clean(h.notes),
      product: form.item.product.trim(),
      quantity: toNumber(form.item.quantity),
      unit: clean(form.item.unit),
      cost_category: clean(form.item.category),
      invoice_ref: clean(form.invoice_ref),
      status: form.status || "received",
      needs_review: !!form.flag,
    },
    cost: {
      unit_price: toNumber(form.item.unit_price),
      line_total: toNumber(form.item.line_total),
      vat_rate: toNumber(form.item.vat_rate),
      doc_total: toNumber(form.cost.total),
      currency: clean(form.cost.currency) || "EUR",
      paid: paidToBool(form.cost.paid),
      payment_method: clean(form.cost.payment_method),
    },
  };
}

// RLS silently filters out rows the caller may not touch (no error, zero rows
// affected), so the update selects the affected id back and treats an empty
// result as a refusal rather than reporting success.
export async function updateDelivery(id, patch, { cost = null, isAdmin = false } = {}) {
  const { data, error } = await supabase.from("deliveries").update(patch).eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("You can only change lines you logged yourself. Ask an admin to change this one.");
  }
  if (!isAdmin || !cost) return;

  const hasAny = [cost.unit_price, cost.line_total, cost.vat_rate, cost.doc_total, cost.paid, cost.payment_method].some(
    (v) => v !== null && v !== undefined
  );
  if (!hasAny) {
    const { error: delError } = await supabase.from("delivery_costs").delete().eq("delivery_id", id);
    if (delError) throw delError;
    return;
  }
  const { data: userData } = await supabase.auth.getUser();
  const { error: costError } = await supabase
    .from("delivery_costs")
    .upsert({ delivery_id: id, created_by: userData?.user?.id || null, ...cost }, { onConflict: "delivery_id" });
  if (costError) throw new Error(`Line saved, but the prices couldn't be saved: ${costError.message}`);
}

export async function deleteDelivery(row) {
  const { data, error } = await supabase.from("deliveries").delete().eq("id", row.id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("You can only delete lines you logged yourself. Ask an admin to delete this one.");
  }
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

export function formatMoney(n) {
  if (n === null || n === undefined || n === "") return "";
  return `€${Number(n).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// One-line description of a register row, for the Excel "Description" column
// and anywhere a cost needs to say where it came from.
export function describeLine(d) {
  const type = DOC_TYPE_LABEL[d.doc_type] || "Docket";
  const ref = d.docket_no ? ` #${d.docket_no}` : "";
  const qty = d.quantity === null || d.quantity === undefined ? "" : `${formatQuantity(d.quantity)} ${d.unit || ""}`.trim();
  const what = [qty, d.product].filter(Boolean).join(" ");
  const where = d.location ? ` – ${d.location}` : "";
  return `${d.supplier || "Unknown supplier"} ${type.toLowerCase()}${ref}: ${what}${where}`;
}

// The reader copies supplier names as printed, so one supplier turns up as
// "Keegan Quarries", "Keegan Quarries Ltd" and "Keegan Quarries Ltd (Ballycoolin
// plant)". Dropping the bracketed part and the company suffix files them together.
export function tidySupplier(name) {
  return String(name || "")
    .replace(/\s*\([^)]*\)/g, " ")
    .replace(/ +,/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s,]+(ltd|limited|teo|plc|dac|uc)\.?$/i, "")
    .trim();
}

// Identifies a document by who issued it and its number, so the same paper
// logged twice can be spotted. Empty when either part is missing: without
// both there is nothing safe to match on.
export function documentKey(supplier, docNo) {
  const no = String(docNo || "").toUpperCase().replace(/\s+/g, "");
  const who = tidySupplier(supplier)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  return no && who ? `${who}|${no}` : "";
}

// The most recent scan already on the register with this supplier and document
// number, or null. Used to warn before the same paper is saved a second time.
export function findSameDocument(deliveries, supplier, docNo) {
  const key = documentKey(supplier, docNo);
  if (!key || !Array.isArray(deliveries)) return null;
  const lines = deliveries.filter((d) => documentKey(d.supplier, d.docket_no) === key);
  if (!lines.length) return null;
  const latest = lines.reduce((a, b) => ((a.created_at || "") >= (b.created_at || "") ? a : b));
  const sameScan = latest.docket_group ? lines.filter((d) => d.docket_group === latest.docket_group) : [latest];
  return {
    doc_type: latest.doc_type || "docket",
    docket_no: latest.docket_no,
    supplier: latest.supplier,
    logged: latest.created_at,
    lines: sameScan.length,
  };
}
