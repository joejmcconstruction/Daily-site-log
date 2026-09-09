import ExcelJS from "exceljs/dist/exceljs.min.js";
import { dateKey } from "./helpers";
import { docketUrl, describeLine, DOC_TYPE_LABEL } from "./deliveries";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Column order on the Deliveries sheet. The summary sheets refer to these by
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

// Adds the "Deliveries" register (a real Excel table with filters and a totals
// row), the "Delivery Summary" sheet and the "Costs by Project" sheet to any
// workbook.
export function buildDeliveriesSheets(wb, deliveries) {
  const rows = sortRows(deliveries);
  const ws = wb.addWorksheet("Deliveries", { views: [{ state: "frozen", ySplit: 1 }] });
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

  buildDeliverySummarySheet(wb, rows);
  buildCostsSheet(wb, rows);
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

function monthRange(rows) {
  const keys = rows.map((r) => r.delivery_date).filter(Boolean).sort();
  const first = keys.length ? keys[0] : dateKey(new Date());
  const last = keys.length ? keys[keys.length - 1] : first;
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  const months = [];
  while ((y < ly || (y === ly && m <= lm)) && months.length < 36) {
    months.push({
      y,
      m,
      label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IE", { month: "short", year: "numeric", timeZone: "UTC" }),
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
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
const D = "Deliveries!";
const rng = (col) => `${D}$${col}$2:$${col}$1048576`;

function monthCriteria(m) {
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
      if (numFmt) cell.numFmt = numFmt;
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
  ws.getColumn(2).width = 10;
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
// the Deliveries sheet, so a correction typed into the register in Excel
// flows through without regenerating the file.
function buildDeliverySummarySheet(wb, rows) {
  const ws = wb.addWorksheet("Delivery Summary", { views: [{ showGridLines: false }] });
  const months = monthRange(rows);
  setupSummaryColumns(ws, months);

  ws.getCell("A1").value = "Delivery summary";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = "Live formulas over the Deliveries sheet — edit there and these update.";
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
  ws.getCell("A2").value = "Ex-VAT line totals from the Deliveries sheet. Give every line a Project there and it lands in the right row here.";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF5B6478" } };

  let r = kpiBlock(
    ws,
    4,
    [
      ["Total cost logged (ex VAT)", `SUM(${rng(COL.lineTotal)})`],
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
