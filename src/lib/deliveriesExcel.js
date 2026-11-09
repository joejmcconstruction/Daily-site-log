import ExcelJS from "exceljs/dist/exceljs.min.js";
import { dateKey } from "./helpers";
import { docketUrl, describeLine, documentKey, tidySupplier, DOC_TYPE_LABEL } from "./deliveries";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// The sheet people read: one row per docket, receipt or invoice.
const REGISTER_SHEET = "Docket Register";
// The sheet behind it: one row per material line. The summary sheets' formulas
// read from here.
const LINES_SHEET = "Docket Lines";

// Column order on the Docket Lines sheet. The summary sheets refer to these by
// letter (COL below), so keep the two in step if you reorder.
export const DELIVERY_COLUMNS = [
  { header: "Date", key: "delivery_date", width: 12 },
  { header: "Type", key: "doc_type", width: 9 },
  { header: "Doc no", key: "docket_no", width: 14 },
  { header: "Supplier", key: "supplier", width: 20 },
  { header: "Product", key: "product", width: 28 },
  { header: "Qty", key: "quantity", width: 9 },
  { header: "Unit", key: "unit", width: 7 },
  { header: "Category", key: "cost_category", width: 20 },
  { header: "Unit price", key: "unit_price", width: 11 },
  { header: "Line total (ex VAT)", key: "line_total", width: 14 },
  { header: "VAT %", key: "vat_rate", width: 7 },
  { header: "Doc total (inc VAT)", key: "doc_total", width: 14 },
  { header: "Paid", key: "paid", width: 7 },
  { header: "Payment", key: "payment_method", width: 11 },
  { header: "Project", key: "project_name", width: 18 },
  { header: "Location on site", key: "location", width: 18 },
  { header: "Description", key: "description", width: 48 },
  { header: "Vehicle reg", key: "vehicle_reg", width: 13 },
  { header: "Haulier", key: "haulier", width: 16 },
  { header: "PO no", key: "po_number", width: 12 },
  { header: "Invoice ref", key: "invoice_ref", width: 14 },
  { header: "Status", key: "status", width: 11 },
  { header: "Check", key: "needs_review", width: 8 },
  { header: "Notes", key: "notes", width: 30 },
  { header: "File", key: "docket", width: 8 },
  { header: "Logged", key: "created_at", width: 18 },
];

const COL = {
  date: "A",
  type: "B",
  docket: "C",
  supplier: "D",
  product: "E",
  qty: "F",
  unit: "G",
  category: "H",
  unitPrice: "I",
  lineTotal: "J",
  vat: "K",
  docTotal: "L",
  paid: "M",
  project: "O",
  invoice: "U",
  status: "V",
  check: "W",
  file: "Y",
};

const MONEY_FMT = '"€"#,##0.00';
const QTY_FMT = "#,##0.00";

// Excel stores dates as serial days from the date's UTC clock, so a local
// midnight in Irish summer time would land on the previous day. Build the
// date in UTC to keep it on the day the docket says.
function excelDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function num(v) {
  return v === null || v === undefined || v === "" ? null : Number(v);
}

function rowValues(d) {
  const cost = d.cost || {};
  return [
    excelDate(d.delivery_date),
    DOC_TYPE_LABEL[d.doc_type] || "Docket",
    d.docket_no || "",
    d.supplier || "",
    d.product || "",
    num(d.quantity),
    d.unit || "",
    d.cost_category || "",
    num(cost.unit_price),
    num(cost.line_total),
    num(cost.vat_rate),
    num(cost.doc_total),
    cost.paid === true ? "Yes" : cost.paid === false ? "No" : "",
    cost.payment_method || "",
    d.project_name || "",
    d.location || "",
    describeLine(d),
    d.vehicle_reg || "",
    d.haulier || "",
    d.po_number || "",
    d.invoice_ref || "",
    d.status || "received",
    d.needs_review ? "CHECK" : "",
    d.notes || "",
    d.docket_path ? "Open" : "",
    d.created_at ? new Date(d.created_at).toLocaleString("en-IE") : "",
  ];
}

function sortRows(deliveries) {
  return [...deliveries].sort((a, b) => {
    if (a.delivery_date !== b.delivery_date) return a.delivery_date < b.delivery_date ? 1 : -1;
    return (a.created_at || "") < (b.created_at || "") ? 1 : -1;
  });
}

function round(value, places) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

// "27/09" from a timestamp, for notes that point at another scan.
function shortDate(timestamp) {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Rolls the line rows up into documents: every line saved from one scan
// shares a docket_group. Each document gets the figures its register row shows.
function groupDocuments(rows) {
  const groups = new Map();
  rows.forEach((r) => {
    const key = r.docket_group || `row:${r.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  return Array.from(groups.values()).map((lines) => {
    const first = lines[0];
    const names = [];
    lines.forEach((l) => {
      const name = (l.product || "").trim();
      if (name && !names.includes(name)) names.push(name);
    });
    const units = Array.from(new Set(lines.map((l) => l.unit || "")));
    const quantities = lines.map((l) => num(l.quantity));
    // A quantity only means something when the document is all one product in
    // one unit (three loads of concrete, say), not pipes plus gaskets.
    const oneProduct = names.length === 1 && units.length === 1;
    const lineTotals = lines.map((l) => num(l.cost ? l.cost.line_total : null)).filter((v) => v !== null);
    const docTotals = lines.map((l) => num(l.cost ? l.cost.doc_total : null)).filter((v) => v !== null);
    const paidFlags = lines.map((l) => (l.cost ? l.cost.paid : null));
    const projects = Array.from(new Set(lines.map((l) => l.project_name).filter(Boolean)));
    const statuses = lines.map((l) => l.status);
    const withFile = lines.find((l) => l.docket_path);
    const withInvoice = lines.find((l) => l.invoice_ref);

    let what = names[0] || "";
    if (names.length > 1) {
      const more = names.length - 3;
      what = `${lines.length} items: ${names.slice(0, 3).join(", ")}${more > 0 ? ` + ${more} more` : ""}`;
    }

    return {
      lines,
      date: first.delivery_date,
      supplier: first.supplier || "",
      type: DOC_TYPE_LABEL[first.doc_type] || "Docket",
      docketNo: first.docket_no || "",
      what,
      quantity: oneProduct && quantities.every((q) => q !== null) ? round(quantities.reduce((s, q) => s + q, 0), 3) : null,
      unit: oneProduct ? units[0] : "",
      costTotal: lineTotals.length ? round(lineTotals.reduce((s, v) => s + v, 0), 2) : null,
      incVat: docTotals.length ? docTotals[0] : null,
      paid: paidFlags.includes(false) ? "No" : paidFlags.includes(true) ? "Yes" : "",
      project: projects.length > 1 ? "Mixed" : projects[0] || "",
      status: statuses.includes("rejected") ? "rejected" : statuses.includes("queried") ? "queried" : "received",
      invoiceRef: withInvoice ? withInvoice.invoice_ref : "",
      path: withFile ? withFile.docket_path : null,
      loggedAt: lines.reduce((latest, l) => ((l.created_at || "") > latest ? l.created_at : latest), ""),
      pricedLines: lineTotals.length,
      key: documentKey(first.supplier, first.docket_no),
      // Same number of lines carrying the same quantities = the same paper.
      signature: `${lines.length}:${quantities
        .map((q) => (q === null ? "" : q.toFixed(3)))
        .sort()
        .join(",")}`,
      copies: 1,
      repeatOf: null,
      alsoLogged: [],
    };
  });
}

// Finds papers that were scanned and saved more than once. Scans with the same
// supplier, document number and line quantities are the same paper: the one
// with the most prices (then the newest) is kept and the rest are marked as
// repeats, so they're counted once. Scans that share a number but differ (page
// two saved on its own, say) are all kept and just point at each other.
function markRepeatScans(docs) {
  const byKey = new Map();
  docs.forEach((d) => {
    if (!d.key) return;
    if (!byKey.has(d.key)) byKey.set(d.key, []);
    byKey.get(d.key).push(d);
  });

  byKey.forEach((same) => {
    if (same.length < 2) return;
    const bySignature = new Map();
    same.forEach((d) => {
      if (!bySignature.has(d.signature)) bySignature.set(d.signature, []);
      bySignature.get(d.signature).push(d);
    });
    bySignature.forEach((copies) => {
      if (copies.length < 2) return;
      copies.sort((a, b) => b.pricedLines - a.pricedLines || (a.loggedAt < b.loggedAt ? 1 : -1));
      copies[0].copies = copies.length;
      copies.slice(1).forEach((d) => {
        d.repeatOf = copies[0];
      });
    });
    const kept = same.filter((d) => !d.repeatOf);
    if (kept.length > 1) {
      kept.forEach((d) => {
        d.alsoLogged = kept.filter((other) => other !== d).map((other) => shortDate(other.loggedAt));
      });
    }
  });
  return docs;
}

function documentNote(d) {
  const bits = [];
  if (d.copies === 2) bits.push("Scanned twice, counted once");
  if (d.copies > 2) bits.push(`Scanned ${d.copies} times, counted once`);
  if (d.alsoLogged.length) {
    const when = d.alsoLogged.filter(Boolean).join(", ");
    bits.push(`Same docket no also logged${when ? ` ${when}` : ""}: check it isn't entered twice`);
  }
  if (d.status === "queried") bits.push("Queried");
  if (d.status === "rejected") bits.push("Rejected");
  if (d.invoiceRef) bits.push(`Invoice ${d.invoiceRef}`);
  return bits.join(" · ");
}

const REGISTER_COLUMNS = [
  { header: "Date", width: 12 },
  { header: "Supplier", width: 26 },
  { header: "Type", width: 9 },
  { header: "Docket no", width: 16 },
  { header: "What", width: 46 },
  { header: "Qty", width: 9 },
  { header: "Unit", width: 6 },
  { header: "Docket total (ex VAT)", width: 20 },
  { header: "Inc VAT", width: 13 },
  { header: "Paid", width: 7 },
  { header: "Project", width: 18 },
  { header: "Note", width: 44 },
  { header: "File", width: 7 },
];

const REG = { date: 1, supplier: 2, type: 3, docketNo: 4, what: 5, qty: 6, unit: 7, total: 8, incVat: 9, paid: 10, project: 11, note: 12, file: 13 };
const REGISTER_HEADER_ROW = 5;
const TYPE_COLOUR = { Docket: "FF3D4A5C", Receipt: "FF1E7B4B", Invoice: "FFB8862C" };
const MUTED = "FF5B6478";

// The sheet people actually read: one row per docket, receipt or invoice, with
// the docket number and one total for the whole document. Plain cells with a
// filter on the headings; the two figures above the headings follow the filter.
function buildRegisterSheet(wb, docs, repeatCount) {
  const ws = wb.addWorksheet(REGISTER_SHEET, { views: [{ state: "frozen", ySplit: REGISTER_HEADER_ROW }] });
  REGISTER_COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });
  const firstRow = REGISTER_HEADER_ROW + 1;
  const lastRow = Math.max(firstRow, REGISTER_HEADER_ROW + docs.length);
  const totalCol = colLetter(REG.total);

  ws.getCell("A1").value = "Docket register";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = `One row per docket, receipt or invoice. Filter with the arrows on the headings. Every line of every docket is on the ${LINES_SHEET} sheet.`;
  ws.getCell("A2").font = { italic: true, color: { argb: MUTED } };

  ws.getCell("A3").value = "Dockets shown";
  ws.getCell("B3").value = { formula: `SUBTOTAL(103,A${firstRow}:A${lastRow})` };
  ws.getCell("B3").font = { bold: true };
  ws.getCell("B3").alignment = { horizontal: "left" };
  const totalLabel = ws.getCell(3, REG.total - 1);
  totalLabel.value = "Total of dockets shown (ex VAT)";
  totalLabel.alignment = { horizontal: "right" };
  const total = ws.getCell(3, REG.total);
  total.value = { formula: `SUBTOTAL(109,${totalCol}${firstRow}:${totalCol}${lastRow})` };
  total.numFmt = MONEY_FMT;
  total.font = { bold: true, size: 12 };

  if (repeatCount > 0) {
    ws.getCell("A4").value = `${repeatCount} ${repeatCount === 1 ? "docket was" : "dockets were"} scanned more than once and ${repeatCount === 1 ? "is" : "are"} counted once. See the Note column.`;
    ws.getCell("A4").font = { italic: true, color: { argb: TYPE_COLOUR.Invoice } };
  }

  const head = ws.getRow(REGISTER_HEADER_ROW);
  head.values = REGISTER_COLUMNS.map((c) => c.header);
  head.font = { bold: true };
  for (let c = 1; c <= REGISTER_COLUMNS.length; c += 1) {
    head.getCell(c).fill = HEADER_FILL;
    head.getCell(c).border = { bottom: { style: "thin", color: { argb: "FF9AA3B5" } } };
  }

  docs.forEach((d, i) => {
    const row = ws.getRow(firstRow + i);
    row.values = [
      excelDate(d.date),
      d.supplier,
      d.type,
      d.docketNo,
      d.what,
      d.quantity,
      d.unit,
      d.costTotal,
      d.incVat,
      d.paid,
      d.project,
      documentNote(d),
      d.path ? "Open" : "",
    ];
    row.getCell(REG.date).numFmt = "dd/mm/yyyy";
    row.getCell(REG.date).alignment = { horizontal: "left" };
    row.getCell(REG.type).font = { bold: true, color: { argb: TYPE_COLOUR[d.type] || TYPE_COLOUR.Docket } };
    row.getCell(REG.docketNo).font = { bold: true };
    row.getCell(REG.qty).numFmt = QTY_FMT;
    row.getCell(REG.total).numFmt = MONEY_FMT;
    row.getCell(REG.total).font = { bold: true };
    row.getCell(REG.incVat).numFmt = MONEY_FMT;
    row.getCell(REG.incVat).font = { color: { argb: MUTED } };
    row.getCell(REG.note).font = { color: { argb: TYPE_COLOUR.Invoice } };
    if (d.path) {
      const cell = row.getCell(REG.file);
      cell.value = { text: "Open", hyperlink: docketUrl(d.path) };
      cell.font = { color: { argb: "FF1F5FBF" }, underline: true };
    }
  });

  ws.autoFilter = {
    from: { row: REGISTER_HEADER_ROW, column: 1 },
    to: { row: lastRow, column: REGISTER_COLUMNS.length },
  };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

// Adds four sheets to any workbook: the "Docket Register" (one row per
// document), "Costs by Project", "Delivery Summary", and "Docket Lines" (every
// material line, as a real Excel table the two summaries read from).
export function buildDeliveriesSheets(wb, deliveries) {
  const all = sortRows(deliveries).map((r) => ({ ...r, supplier: tidySupplier(r.supplier) }));
  const docs = markRepeatScans(groupDocuments(all));
  const kept = docs
    .filter((d) => !d.repeatOf)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.supplier !== b.supplier) return a.supplier.localeCompare(b.supplier);
      return a.loggedAt < b.loggedAt ? 1 : -1;
    });
  // A repeat scan's lines are left off the lines sheet too, so the totals and
  // the summaries count that paper once.
  const repeated = new Set();
  docs.forEach((d) => {
    if (d.repeatOf) d.lines.forEach((l) => repeated.add(l));
  });
  const rows = all.filter((r) => !repeated.has(r));

  buildRegisterSheet(wb, kept, docs.length - kept.length);
  buildCostsSheet(wb, rows);
  buildDeliverySummarySheet(wb, rows);
  return buildLinesSheet(wb, rows);
}

function buildLinesSheet(wb, rows) {
  const ws = wb.addWorksheet(LINES_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  DELIVERY_COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  if (rows.length === 0) {
    ws.addRow(DELIVERY_COLUMNS.map((c) => c.header));
    ws.getRow(1).font = { bold: true };
  } else {
    ws.addTable({
      name: "DeliveryRegister",
      ref: "A1",
      headerRow: true,
      totalsRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: DELIVERY_COLUMNS.map((c, i) => {
        const col = { name: c.header, filterButton: true };
        if (i === 0) col.totalsRowLabel = "Total";
        if (c.key === "product") col.totalsRowFunction = "count";
        if (c.key === "quantity" || c.key === "line_total") col.totalsRowFunction = "sum";
        return col;
      }),
      rows: rows.map(rowValues),
    });

    rows.forEach((d, i) => {
      const r = i + 2;
      ws.getCell(`${COL.date}${r}`).numFmt = "dd/mm/yyyy";
      ws.getCell(`${COL.qty}${r}`).numFmt = QTY_FMT;
      ws.getCell(`${COL.unitPrice}${r}`).numFmt = MONEY_FMT;
      ws.getCell(`${COL.lineTotal}${r}`).numFmt = MONEY_FMT;
      ws.getCell(`${COL.docTotal}${r}`).numFmt = MONEY_FMT;
      ws.getCell(`${COL.vat}${r}`).numFmt = "0.0";
      if (d.docket_path) {
        const cell = ws.getCell(`${COL.file}${r}`);
        cell.value = { text: "Open", hyperlink: docketUrl(d.docket_path) };
        cell.font = { color: { argb: "FF1F5FBF" }, underline: true };
      }
      if (d.needs_review) {
        ws.getCell(`${COL.check}${r}`).font = { bold: true, color: { argb: "FFB8862C" } };
      }
    });
    const totalsRow = rows.length + 2;
    ws.getCell(`${COL.qty}${totalsRow}`).numFmt = QTY_FMT;
    ws.getCell(`${COL.lineTotal}${totalsRow}`).numFmt = MONEY_FMT;
  }
  return ws;
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const MAX_MONTH_COLUMNS = 12;

// The month columns for the summary tables: only months that have something
// logged, newest twelve at most, with everything older gathered into one
// "Earlier" column. A single misread date (a docket dated years back) used to
// start the run of months there and push every real month off the sheet.
function monthRange(rows) {
  const present = Array.from(new Set(rows.map((r) => (r.delivery_date || "").slice(0, 7)).filter(Boolean))).sort();
  if (!present.length) present.push(dateKey(new Date()).slice(0, 7));
  const shown = present.slice(-MAX_MONTH_COLUMNS);
  const months = shown.map((key) => {
    const [y, m] = key.split("-").map(Number);
    return {
      y,
      m,
      label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IE", { month: "short", year: "numeric", timeZone: "UTC" }),
    };
  });
  if (present.length > shown.length) {
    months.unshift({ y: months[0].y, m: months[0].m, label: "Earlier", before: true });
  }
  return months;
}

// Shows a zero as an empty cell, so a table of months reads as the figures
// that matter rather than a wall of 0.00.
function blankZeros(fmt) {
  return `${fmt};-${fmt};`;
}

function uniqueSorted(values) {
  return Array.from(new Set(values.map((v) => v ?? ""))).sort((a, b) => String(a).localeCompare(String(b)));
}

// The unit most often logged against a product — for the summary's Unit column.
function commonUnit(rows, product) {
  const counts = {};
  rows.forEach((r) => {
    if (r.product === product && r.unit) counts[r.unit] = (counts[r.unit] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1F7" } };

// Formula ranges start at row 2 so the header row is never counted: a whole-
// column COUNTIF(...,"?*") would count the "Product" header, and COUNTIF is
// case-insensitive so "Check" would match "CHECK".
const D = `'${LINES_SHEET}'!`;
const rng = (col) => `${D}$${col}$2:$${col}$1048576`;

function monthCriteria(m) {
  if (m.before) return `${rng(COL.date)},"<"&DATE(${m.y},${m.m},1)`;
  return `${rng(COL.date)},">="&DATE(${m.y},${m.m},1),${rng(COL.date)},"<"&DATE(${m.y},${m.m + 1},1)`;
}

function sheetHeading(ws, r, text) {
  ws.getCell(`A${r}`).value = text;
  ws.getCell(`A${r}`).font = { bold: true, size: 12 };
}

// Writes one "keys down the side, months across the top" block of live
// SUMIFS/COUNTIFS formulas. Returns the next free row.
function writeMatrix(ws, startRow, { title, firstHeader, secondHeader, keys, secondValue, criteriaCol, valueCol, months, mode, numFmt }) {
  const firstMonthCol = 3;
  const lastMonthCol = firstMonthCol + months.length - 1;
  const totalCol = lastMonthCol + 1;
  let r = startRow;

  sheetHeading(ws, r, title);
  r += 1;

  const head = ws.getRow(r);
  head.values = [firstHeader, secondHeader, ...months.map((m) => m.label), "Total"];
  head.font = { bold: true };
  for (let c = 1; c <= totalCol; c += 1) head.getCell(c).fill = HEADER_FILL;
  r += 1;

  if (!keys.length) {
    ws.getCell(`A${r}`).value = "Nothing logged yet.";
    return r + 2;
  }

  keys.forEach((key) => {
    ws.getCell(`A${r}`).value = key || "(none)";
    ws.getCell(`B${r}`).value = secondValue ? secondValue(key) : "";
    const criteria = key ? `$A${r}` : `""`;
    months.forEach((m, i) => {
      const cell = ws.getCell(`${colLetter(firstMonthCol + i)}${r}`);
      cell.value = {
        formula:
          mode === "sum"
            ? `SUMIFS(${rng(valueCol)},${rng(criteriaCol)},${criteria},${monthCriteria(m)})`
            : `COUNTIFS(${rng(criteriaCol)},${criteria},${monthCriteria(m)})`,
      };
      cell.numFmt = blankZeros(numFmt || "0");
    });
    const total = ws.getCell(`${colLetter(totalCol)}${r}`);
    total.value = { formula: `SUM(${colLetter(firstMonthCol)}${r}:${colLetter(lastMonthCol)}${r})` };
    total.font = { bold: true };
    if (numFmt) total.numFmt = numFmt;
    r += 1;
  });

  // Column total under the block.
  ws.getCell(`A${r}`).value = "Total";
  ws.getCell(`A${r}`).font = { bold: true };
  for (let c = firstMonthCol; c <= totalCol; c += 1) {
    const cell = ws.getCell(`${colLetter(c)}${r}`);
    cell.value = { formula: `SUM(${colLetter(c)}${startRow + 2}:${colLetter(c)}${r - 1})` };
    cell.font = { bold: true };
    if (numFmt) cell.numFmt = numFmt;
  }
  return r + 2;
}

function setupSummaryColumns(ws, months) {
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 16;
  months.forEach((_, i) => {
    ws.getColumn(3 + i).width = 12;
  });
  ws.getColumn(3 + months.length).width = 13;
}

function kpiBlock(ws, startRow, kpis, numFmt) {
  kpis.forEach(([label, formula], i) => {
    const r = startRow + i;
    ws.getCell(`A${r}`).value = label;
    const cell = ws.getCell(`B${r}`);
    cell.value = { formula };
    cell.font = { bold: true };
    if (numFmt && numFmt[i]) cell.numFmt = numFmt[i];
  });
  return startRow + kpis.length + 1;
}

// Quantities: what came in, by product and by supplier. Live formulas over
// the Docket Lines sheet, so a correction typed into it in Excel
// flows through without regenerating the file.
function buildDeliverySummarySheet(wb, rows) {
  const ws = wb.addWorksheet("Delivery Summary", { views: [{ showGridLines: false }] });
  const months = monthRange(rows);
  setupSummaryColumns(ws, months);

  ws.getCell("A1").value = "Delivery summary";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = "Live formulas over the Docket Lines sheet. Edit there and these update.";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF5B6478" } };

  let r = kpiBlock(ws, 4, [
    ["Lines logged", `COUNTIF(${rng(COL.product)},"?*")`],
    ["Flagged for checking", `COUNTIF(${rng(COL.check)},"CHECK")`],
    ["Dockets not yet matched to an invoice", `COUNTIFS(${rng(COL.type)},"Docket",${rng(COL.product)},"?*",${rng(COL.invoice)},"")`],
    ["Queried or rejected", `COUNTIF(${rng(COL.status)},"queried")+COUNTIF(${rng(COL.status)},"rejected")`],
  ]);

  r = writeMatrix(ws, r, {
    title: "Quantity by product",
    firstHeader: "Product",
    secondHeader: "Unit",
    keys: uniqueSorted(rows.map((x) => x.product)),
    secondValue: (p) => commonUnit(rows, p),
    criteriaCol: COL.product,
    valueCol: COL.qty,
    months,
    mode: "sum",
    numFmt: QTY_FMT,
  });

  writeMatrix(ws, r, {
    title: "Lines by supplier",
    firstHeader: "Supplier",
    secondHeader: "",
    keys: uniqueSorted(rows.map((x) => x.supplier)),
    criteriaCol: COL.supplier,
    valueCol: null,
    months,
    mode: "count",
  });

  return ws;
}

// Costs: ex-VAT line totals by project, category and supplier, plus what is
// still unpaid. Empty for crew downloads, since RLS gives them no prices.
function buildCostsSheet(wb, rows) {
  const ws = wb.addWorksheet("Costs by Project", { views: [{ showGridLines: false }] });
  const months = monthRange(rows);
  setupSummaryColumns(ws, months);

  ws.getCell("A1").value = "Costs by project";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = "Ex-VAT line totals from the Docket Lines sheet. Give every line a Project there and it lands in the right row here.";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF5B6478" } };

  let r = kpiBlock(
    ws,
    4,
    [
      // Only rows with a product: a plain SUM of the column would also add the
      // table's own total row at the bottom and report double.
      ["Total cost logged (ex VAT)", `SUMIFS(${rng(COL.lineTotal)},${rng(COL.product)},"?*")`],
      ["Lines with no price", `COUNTIFS(${rng(COL.product)},"?*",${rng(COL.lineTotal)},"")`],
      ["Lines marked unpaid", `COUNTIF(${rng(COL.paid)},"No")`],
      ["Unpaid amount (ex VAT)", `SUMIFS(${rng(COL.lineTotal)},${rng(COL.paid)},"No")`],
    ],
    [MONEY_FMT, null, null, MONEY_FMT]
  );

  const withCost = rows.filter((x) => x.cost && x.cost.line_total !== null && x.cost.line_total !== undefined);

  r = writeMatrix(ws, r, {
    title: "Cost by project (ex VAT)",
    firstHeader: "Project",
    secondHeader: "",
    keys: uniqueSorted(withCost.map((x) => x.project_name)),
    criteriaCol: COL.project,
    valueCol: COL.lineTotal,
    months,
    mode: "sum",
    numFmt: MONEY_FMT,
  });

  r = writeMatrix(ws, r, {
    title: "Cost by category (ex VAT)",
    firstHeader: "Category",
    secondHeader: "",
    keys: uniqueSorted(withCost.map((x) => x.cost_category)),
    criteriaCol: COL.category,
    valueCol: COL.lineTotal,
    months,
    mode: "sum",
    numFmt: MONEY_FMT,
  });

  writeMatrix(ws, r, {
    title: "Cost by supplier (ex VAT)",
    firstHeader: "Supplier",
    secondHeader: "",
    keys: uniqueSorted(withCost.map((x) => x.supplier)),
    criteriaCol: COL.supplier,
    valueCol: COL.lineTotal,
    months,
    mode: "sum",
    numFmt: MONEY_FMT,
  });

  return ws;
}

// Standalone workbook, downloaded straight from the browser — for sending the
// register to a QS or supplier without the costed main workbook.
export async function downloadDeliveriesWorkbook(deliveries, fileName) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  buildDeliveriesSheets(wb, deliveries);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
