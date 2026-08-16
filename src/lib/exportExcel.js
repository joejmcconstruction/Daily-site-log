import * as XLSX from "xlsx";
import { supabase } from "../supabaseClient";
import { PROJECT_OPTIONS, MACHINE_OPTIONS } from "./helpers";

const EXPORT_BUCKET = "reports-export";
const EXPORT_FILE = "site-daily-report.xlsx";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const KEY_SEP = "|||";

// Costing assumptions from Joe (2026-08-16) — see memory/project_costing_rules.md.
// Fuel: a machine run 6 hrs/day uses 1.2x its tank capacity -> 0.2x tank per hour.
// Labour: a driver's operating hours are costed as part of the machine (fuel +
// labour), not counted again under ground-staff Labour hours.
const FUEL_PRICE_PER_LITRE = 1.44; // EUR — from an EUR1440/1000L delivery, ~Aug 2026. Update here when fuel is repriced.
const LABOUR_RATE_PER_HOUR = 30; // EUR/hour per man

// Tank capacity (litres) per machine — only what Joe has given so far.
// ASSUMPTION (flagged for Joe): he said "Hitachi 135" — no exact match in
// MACHINE_OPTIONS, so this is mapped to "13T Hitachi" (a ~13T-class Hitachi,
// closest fit to a "135" model designation). Confirm this is correct.
// Remaining machines are left blank in the Rates sheet for Joe to fill in.
const KNOWN_TANK_CAPACITY_L = {
  "13T Hitachi": 220, // ASSUMPTION: Joe said "Hitachi 135" — confirm this is the right machine
  Kubota: 115, // Joe said "Kubota 8.5T" — only one Kubota in the list, assumed same machine
};

const REPORT_HEADER = [
  "Date",
  "Project",
  "Weather",
  "Staff on site",
  "Labour hours",
  "Trench excavated (m)",
  "Trench backfilled (m)",
  'ESB 5" duct (m)',
  "ESB 50mm duct",
  "Public lighting duct (m)",
  "Virgin duct (m)",
  "Eir duct (m)",
  "Siro duct (m)",
  "EV charger duct (m)",
  "Chambers fitted",
  "Description",
  "Cause of delays",
  "Additional work",
];
const REPORT_COL_WIDTHS = [12, 18, 12, 30, 12, 16, 16, 14, 14, 18, 14, 14, 14, 16, 14, 40, 30, 30];

const MACHINE_HEADER = ["Date", "Project", "Machine", "Hours", "Driver"];
const MACHINE_COL_WIDTHS = [12, 18, 24, 10, 20];

const RATES_COL_WIDTHS = [26, 16];

function applySheetFormatting(ws, colWidths, lastRow) {
  const lastCol = colWidths.length - 1;
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow - 1, c: lastCol } }) };
  ws["!cols"] = colWidths.map((w) => ({ wch: w }));
}

function buildReportsSheet(reports) {
  const rows = reports
    .slice()
    .sort((a, b) => (a.report_date < b.report_date ? 1 : -1))
    .map((r) => ({
      Date: r.report_date,
      Project: r.project_name || "Unassigned",
      Weather: r.weather,
      "Staff on site": r.staff_on_site,
      "Labour hours": r.labour_hours ?? "",
      "Trench excavated (m)": r.trench_excavated ?? "",
      "Trench backfilled (m)": r.trench_backfilled ?? "",
      'ESB 5" duct (m)': r.esb_5inch ?? "",
      "ESB 50mm duct": r.esb_50mm ?? "",
      "Public lighting duct (m)": r.public_lighting ?? "",
      "Virgin duct (m)": r.virgin_duct ?? "",
      "Eir duct (m)": r.eir_duct ?? "",
      "Siro duct (m)": r.siro_duct ?? "",
      "EV charger duct (m)": r.ev_charger_duct ?? "",
      "Chambers fitted": r.chambers_fitted ?? "",
      Description: r.description,
      "Cause of delays": r.cause_of_delays || "",
      "Additional work": r.additional_work || "",
    }));
  const ws = XLSX.utils.json_to_sheet(rows, { header: REPORT_HEADER });
  applySheetFormatting(ws, REPORT_COL_WIDTHS, rows.length + 1);
  return ws;
}

function buildMachineSheet(machineHours, reportById) {
  const rows = machineHours
    .slice()
    .sort((a, b) => (a.log_date < b.log_date ? 1 : -1))
    .map((m) => {
      const report = m.report_id ? reportById[m.report_id] : null;
      return {
        Date: m.log_date,
        Project: report ? report.project_name || "Unassigned" : "Unassigned",
        Machine: m.machine_name,
        Hours: m.hours,
        Driver: m.driver_name,
      };
    });
  const ws = XLSX.utils.json_to_sheet(rows, { header: MACHINE_HEADER });
  applySheetFormatting(ws, MACHINE_COL_WIDTHS, rows.length + 1);
  return ws;
}

function buildRatesSheet() {
  const aoa = [
    ["Fuel price (€/litre)", FUEL_PRICE_PER_LITRE],
    ["Labour rate (€/hour)", LABOUR_RATE_PER_HOUR],
    [],
    ["Machine", "Tank capacity (L)"],
  ];
  MACHINE_OPTIONS.forEach((m) => {
    aoa.push([m, m in KNOWN_TANK_CAPACITY_L ? KNOWN_TANK_CAPACITY_L[m] : null]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = RATES_COL_WIDTHS.map((w) => ({ wch: w }));
  const tankTableStartRow = 5; // first machine row (row 4 is the "Machine"/"Tank capacity" header)
  const tankTableEndRow = tankTableStartRow + MACHINE_OPTIONS.length - 1;
  return { ws: ws, tankTableStartRow: tankTableStartRow, tankTableEndRow: tankTableEndRow };
}

// Cost Report: hours are pulled in automatically per project/machine (and labour).
// Fuel cost = hours x 0.2 x tank capacity x fuel price (see FUEL_PRICE_PER_LITRE
// comment above). Labour cost = hours x labour rate. A machine's Total Cost is
// fuel + labour for the hours it ran; a "Labour" row is ground-staff hours only
// (no fuel), so a driver's operating hours aren't double-counted.
function buildCostReportSheet(reports, machineHours, reportById, ratesRange) {
  var machineAgg = {};
  var machineProjects = {};
  machineHours.forEach(function (m) {
    var report = m.report_id ? reportById[m.report_id] : null;
    var project = report ? report.project_name || "Unassigned" : "Unassigned";
    machineProjects[project] = true;
    var key = project + KEY_SEP + m.machine_name;
    machineAgg[key] = (machineAgg[key] || 0) + (Number(m.hours) || 0);
  });

  var labourAgg = {};
  reports.forEach(function (r) {
    var project = r.project_name || "Unassigned";
    labourAgg[project] = (labourAgg[project] || 0) + (Number(r.labour_hours) || 0);
  });

  var projectOrder = PROJECT_OPTIONS.slice();
  var seen = {};
  projectOrder.forEach(function (p) {
    seen[p] = true;
  });
  Object.keys(labourAgg)
    .concat(Object.keys(machineProjects))
    .forEach(function (p) {
      if (!seen[p]) {
        seen[p] = true;
        projectOrder.push(p);
      }
    });

  var costRows = [];
  projectOrder.forEach(function (project) {
    MACHINE_OPTIONS.forEach(function (machine) {
      var hrs = machineAgg[project + KEY_SEP + machine];
      if (hrs) costRows.push({ project: project, item: machine, hours: Number(hrs.toFixed(2)) });
    });
    var labHrs = labourAgg[project];
    if (labHrs) costRows.push({ project: project, item: "Labour", hours: Number(labHrs.toFixed(2)) });
  });

  var header = ["Project", "Item", "Hours", "Fuel Cost (€)", "Labour Cost (€)", "Total Cost (€)"];
  var aoa = [header];
  var formulas = [];

  var dataStartRow = 2;
  costRows.forEach(function (row, i) {
    var excelRow = dataStartRow + i;
    var isLabour = row.item === "Labour";
    aoa.push([row.project, row.item, row.hours, isLabour ? 0 : null, null, null]);
    if (!isLabour) {
      formulas.push({
        r: excelRow,
        c: 3,
        f:
          "C" +
          excelRow +
          "*0.2*VLOOKUP(B" +
          excelRow +
          ",Rates!$A$" +
          ratesRange.tankTableStartRow +
          ":$B$" +
          ratesRange.tankTableEndRow +
          ",2,FALSE)*Rates!$B$1",
      });
    }
    formulas.push({ r: excelRow, c: 4, f: "C" + excelRow + "*Rates!$B$2" });
    formulas.push({ r: excelRow, c: 5, f: "D" + excelRow + "+E" + excelRow });
  });
  var dataEndRow = dataStartRow + costRows.length - 1;
  var hasData = costRows.length > 0;

  aoa.push([]);
  aoa.push(["Project Totals"]);
  var totalsStartRow = dataEndRow + 3;
  projectOrder.forEach(function (project, i) {
    var excelRow = totalsStartRow + i;
    aoa.push([project, null, null, null, null, null]);
    if (hasData) {
      formulas.push({
        r: excelRow,
        c: 5,
        f: "SUMIF($A$" + dataStartRow + ":$A$" + dataEndRow + ",A" + excelRow + ",$F$" + dataStartRow + ":$F$" + dataEndRow + ")",
      });
    } else {
      aoa[excelRow - 1][5] = 0;
    }
  });
  var totalsEndRow = totalsStartRow + projectOrder.length - 1;

  aoa.push([]);
  var grandTotalRow = totalsEndRow + 2;
  aoa.push(["Grand Total", null, null, null, null, null]);
  formulas.push({ r: grandTotalRow, c: 5, f: "SUM($F$" + totalsStartRow + ":$F$" + totalsEndRow + ")" });

  var ws = XLSX.utils.aoa_to_sheet(aoa);
  formulas.forEach(function (cell) {
    ws[XLSX.utils.encode_cell({ r: cell.r - 1, c: cell.c })] = { t: "n", f: cell.f };
  });

  ws["!autofilter"] = { ref: "A1:F" + Math.max(dataEndRow, 1) };
  ws["!cols"] = [{ wch: 20 }, { wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 15 }, { wch: 14 }];
  return ws;
}

export function buildWorkbook(data) {
  var reports = data.reports;
  var machineHours = data.machineHours;
  var wb = XLSX.utils.book_new();
  var reportById = {};
  reports.forEach(function (r) {
    reportById[r.id] = r;
  });

  XLSX.utils.book_append_sheet(wb, buildReportsSheet(reports), "Daily Reports");
  XLSX.utils.book_append_sheet(wb, buildMachineSheet(machineHours, reportById), "Machine Hours");
  var ratesResult = buildRatesSheet();
  XLSX.utils.book_append_sheet(wb, ratesResult.ws, "Rates");
  XLSX.utils.book_append_sheet(wb, buildCostReportSheet(reports, machineHours, reportById, ratesResult), "Cost Report");

  return wb;
}

// Regenerates the full workbook from the live data and overwrites the one
// private file in Supabase Storage. Called automatically after a report is
// submitted or deleted — there's no export button in the app.
export async function syncExcelExport() {
  const [reportsRes, machineRes] = await Promise.all([supabase.from("reports").select("*"), supabase.from("machine_hours").select("*")]);
  if (reportsRes.error) throw reportsRes.error;
  if (machineRes.error) throw machineRes.error;

  const wb = buildWorkbook({ reports: reportsRes.data || [], machineHours: machineRes.data || [] });
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], { type: XLSX_MIME });

  const { error: uploadError } = await supabase.storage.from(EXPORT_BUCKET).upload(EXPORT_FILE, blob, {
    upsert: true,
    contentType: XLSX_MIME,
  });
  if (uploadError) throw uploadError;
}
