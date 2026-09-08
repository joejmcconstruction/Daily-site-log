import ExcelJS from "exceljs/dist/exceljs.min.js";
import { dateKey } from "./helpers";
import { docketUrl } from "./deliveries";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Column order on the Deliveries sheet. The Delivery Summary formulas refer to
// these by letter (COL below), so keep the two in step if you reorder.
export const DELIVERY_COLUMNS = [
  { header: "Date", key: "delivery_date", width: 12 },
  { header: "Docket no", key: "docket_no", width: 14 },
  { header: "Supplier", key: "supplier", width: 18 },
  { header: "Product", key: "product", width: 26 },
  { header: "Qty", key: "quantity", width: 10 },
  { header: "Unit", key: "unit", width: 7 },
  { header: "Vehicle reg", key: "vehicle_reg", width: 13 },
  { header: "Haulier", key: "haulier", width: 16 },
  { header: "PO no", key: "po_number", width: 12 },
  { header: "Project", key: "project_name", width: 18 },
  { header: "Location on site", key: "location", width: 20 },
  { header: "Invoice ref", key: "invoice_ref", width: 14 },
  { header: "Status", key: "status", width: 11 },
  { header: "Check", key: "needs_review", width: 8 },
  { header: "Notes", key: "notes", width: 30 },
  { header: "Docket", key: "docket", width: 9 },
  { header: "Logged", key: "created_at", width: 18 },
];

const COL = { date: "A", supplier: "C", product: "D", qty: "E", invoice: "L", status: "M", check: "N", docket: "P" };

// Excel stores dates as serial days from the date's UTC clock, so a local
// midnight in Irish summer time would land on the previous day. Build the
// date in UTC to keep it on the day the docket says.
function excelDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function rowValues(d) {
  return [
    excelDate(d.delivery_date),
    d.docket_no || "",
    d.supplier || "",
    d.product || "",
    d.quantity === null || d.quantity === undefined ? null : Number(d.quantity),
    d.unit || "",
    d.vehicle_reg || "",
    d.haulier || "",
    d.po_number || "",
    d.project_name || "",
    d.location || "",
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
// row) and the "Delivery Summary" sheet to any workbook.
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
        if (c.key === "quantity") col.totalsRowFunction = "sum";
        return col;
      }),
      rows: rows.map(rowValues),
    });

    rows.forEach((d, i) => {
      const r = i + 2;
      ws.getCell(`${COL.date}${r}`).numFmt = "dd/mm/yyyy";
      ws.getCell(`${COL.qty}${r}`).numFmt = "#,##0.##";
      if (d.docket_path) {
        const cell = ws.getCell(`${COL.docket}${r}`);
        cell.value = { text: "Open", hyperlink: docketUrl(d.docket_path) };
        cell.font = { color: { argb: "FF1F5FBF" }, underline: true };
      }
      if (d.needs_review) {
        ws.getCell(`${COL.check}${r}`).font = { bold: true, color: { argb: "FFB8862C" } };
      }
    });
    ws.getCell(`${COL.qty}${rows.length + 2}`).numFmt = "#,##0.##";
  }

  buildDeliverySummarySheet(wb, rows);
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
  return Array.from(new Set(values.filter((v) => v !== null && v !== undefined))).sort((a, b) => String(a).localeCompare(String(b)));
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

function monthCriteria(D, m) {
  return `${D}$${COL.date}:$${COL.date},">="&DATE(${m.y},${m.m},1),${D}$${COL.date}:$${COL.date},"<"&DATE(${m.y},${m.m + 1},1)`;
}

// Live SUMIFS/COUNTIFS over the Deliveries sheet, so a correction typed into
// the register in Excel flows through without regenerating the file.
function buildDeliverySummarySheet(wb, rows) {
  const ws = wb.addWorksheet("Delivery Summary", { views: [{ showGridLines: false }] });
  const D = "Deliveries!";
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 10;

  ws.getCell("A1").value = "Delivery summary";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = "Live formulas over the Deliveries sheet — edit there and these update.";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF5B6478" } };

  const kpis = [
    ["Delivery lines logged", `COUNTIF(${D}$${COL.product}:$${COL.product},"?*")`],
    ["Flagged for checking", `COUNTIF(${D}$${COL.check}:$${COL.check},"CHECK")`],
    ["Not yet matched to an invoice", `COUNTIFS(${D}$${COL.product}:$${COL.product},"?*",${D}$${COL.invoice}:$${COL.invoice},"")`],
    ["Queried or rejected", `COUNTIF(${D}$${COL.status}:$${COL.status},"queried")+COUNTIF(${D}$${COL.status}:$${COL.status},"rejected")`],
  ];
  kpis.forEach(([label, formula], i) => {
    const r = 4 + i;
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`B${r}`).value = { formula };
    ws.getCell(`B${r}`).font = { bold: true };
  });

  const months = monthRange(rows);
  const firstMonthCol = 3;
  const lastMonthCol = firstMonthCol + months.length - 1;
  const totalCol = lastMonthCol + 1;
  months.forEach((_, i) => {
    ws.getColumn(firstMonthCol + i).width = 11;
  });
  ws.getColumn(totalCol).width = 11;

  function writeHeader(r, first, second) {
    const row = ws.getRow(r);
    row.values = [first, second, ...months.map((m) => m.label), "Total"];
    row.font = { bold: true };
    for (let c = 1; c <= totalCol; c += 1) {
      row.getCell(c).fill = HEADER_FILL;
    }
  }

  let r = 10;
  ws.getCell(`A${r}`).value = "Quantity delivered by product";
  ws.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  writeHeader(r, "Product", "Unit");
  r += 1;

  const products = uniqueSorted(rows.map((x) => x.product));
  products.forEach((p) => {
    ws.getCell(`A${r}`).value = p;
    ws.getCell(`B${r}`).value = commonUnit(rows, p);
    months.forEach((m, i) => {
      const cell = ws.getCell(`${colLetter(firstMonthCol + i)}${r}`);
      cell.value = {
        formula: `SUMIFS(${D}$${COL.qty}:$${COL.qty},${D}$${COL.product}:$${COL.product},$A${r},${monthCriteria(D, m)})`,
      };
      cell.numFmt = "#,##0.##";
    });
    const total = ws.getCell(`${colLetter(totalCol)}${r}`);
    total.value = { formula: `SUM(${colLetter(firstMonthCol)}${r}:${colLetter(lastMonthCol)}${r})` };
    total.numFmt = "#,##0.##";
    total.font = { bold: true };
    r += 1;
  });
  if (!products.length) {
    ws.getCell(`A${r}`).value = "No deliveries yet.";
    r += 1;
  }

  r += 1;
  ws.getCell(`A${r}`).value = "Delivery lines by supplier";
  ws.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  writeHeader(r, "Supplier", "");
  r += 1;

  const suppliers = uniqueSorted(rows.map((x) => x.supplier || ""));
  suppliers.forEach((s) => {
    ws.getCell(`A${r}`).value = s || "(no supplier)";
    const criteria = s ? `$A${r}` : `""`;
    months.forEach((m, i) => {
      ws.getCell(`${colLetter(firstMonthCol + i)}${r}`).value = {
        formula: `COUNTIFS(${D}$${COL.supplier}:$${COL.supplier},${criteria},${monthCriteria(D, m)})`,
      };
    });
    const total = ws.getCell(`${colLetter(totalCol)}${r}`);
    total.value = { formula: `SUM(${colLetter(firstMonthCol)}${r}:${colLetter(lastMonthCol)}${r})` };
    total.font = { bold: true };
    r += 1;
  });
  if (!suppliers.length) {
    ws.getCell(`A${r}`).value = "No deliveries yet.";
  }

  return ws;
}

// Standalone deliveries workbook, downloaded straight from the browser — for
// sending the register to a QS or supplier without the costed main workbook.
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
