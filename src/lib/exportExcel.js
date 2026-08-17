import ExcelJS from "exceljs/dist/exceljs.min.js";
import { supabase } from "../supabaseClient";
import { PROJECT_OPTIONS, MACHINE_OPTIONS } from "./helpers";
import { renderPieChart, renderGroupedBarChart, renderStackedBarChart } from "./dashboardCharts";

const EXPORT_BUCKET = "reports-export";
const EXPORT_FILE = "site-daily-report.xlsx";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const KEY_SEP = "|||";

// Costing assumptions from Joe (2026-08-16, refined 2026-08-17) — see
// memory/project_costing_rules.md.
// Fuel: a machine run 6 hrs/day uses 1.2x its tank capacity -> 0.2x tank per hour.
// Labour: a driver's operating hours are costed as part of the machine (fuel +
// labour). The "Labour hours" field on a report is entered as everyone's GROSS
// total man-hours for the day (e.g. 3 staff x 7.75hrs), so before costing it as
// ground labour, that report's total machine hours are subtracted (floored at
// 0) — otherwise a driver's hours get paid once on the machine row and again
// inside the ground-labour total. Example: 7.75hrs entered, 6hrs of that spent
// driving the 13T Hitachi -> 1.75hrs costed as ground labour for that report.
const FUEL_PRICE_PER_LITRE = 1.44; // EUR — from an EUR1440/1000L delivery, ~Aug 2026. Update here when fuel is repriced.
const LABOUR_RATE_PER_HOUR = 30; // EUR/hour per man

// Tank capacity (litres) per machine. The first two are Joe's own figures
// (kept exactly as given); the rest were looked up online on 2026-08-17
// since he asked for a best-effort fill-in of the remaining machines to
// check over, rather than leaving them blank. Sources/confidence noted per
// machine — anything marked ASSUMPTION/AVERAGE is a judgment call (no exact
// spec found, or the model name in the app is ambiguous) and should be
// confirmed against the actual machine, not treated as verified.
const KNOWN_TANK_CAPACITY_L = {
  "13T Hitachi": 220, // Joe's own figure (he said "Hitachi 135")
  Kubota: 115, // Joe's own figure (he said "Kubota 8.5T")
  "Hitachi 225": 270, // Hitachi ZX225US spec sheet (~71.4 US gal) — confirm this is the right ZX225 variant
  "Kobelco 140": 271, // Kobelco SK140 spec sheet — confirm
  "Wacker Neuson Excavator": 44, // Joe confirmed ~3.5T -> Wacker Neuson EZ36/ET35 class spec sheet (11.62 US gal)
  "Yanmar 0.8T": 10, // ASSUMPTION/AVERAGE: no published tank spec found for this micro-class excavator — averaged from comparable sub-1T machines (e.g. Bobcat E10 below)
  "Bobcat 1T": 16, // Bobcat E10 spec sheet (4.2 US gal) — confirm
  "10T Thwaites Dumper": 72, // Thwaites MACH692 (10T) spec sheet — confirm
  "6T Thwaites Dumper": 70, // Thwaites 6T range spec sheet — confirm
  "Wacker Plate": 5, // ASSUMPTION/AVERAGE: diesel reversible plate compactors in this size range (e.g. DPU5545He) run ~5L — confirm which plate model this is
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

// Sums machine hours per report_id, so gross labour hours can be netted down
// to ground-only hours per report before costing (see costing assumptions above).
function machineHoursByReportId(machineHours) {
  const byReport = {};
  machineHours.forEach((m) => {
    if (!m.report_id) return;
    byReport[m.report_id] = (byReport[m.report_id] || 0) + (Number(m.hours) || 0);
  });
  return byReport;
}

function groundLabourHours(report, machineHoursByReport) {
  const gross = Number(report.labour_hours) || 0;
  const driven = machineHoursByReport[report.id] || 0;
  return Math.max(0, gross - driven);
}

function applyAutoFilterAndHeaderStyle(ws, colCount, lastRow) {
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(lastRow, 1), column: colCount } };
  ws.getRow(1).font = { bold: true };
}

function buildReportsSheet(wb, reports) {
  const ws = wb.addWorksheet("Daily Reports");
  ws.columns = REPORT_HEADER.map((h, i) => ({ header: h, width: REPORT_COL_WIDTHS[i] }));
  const rows = reports
    .slice()
    .sort((a, b) => (a.report_date < b.report_date ? 1 : -1))
    .map((r) => [
      r.report_date,
      r.project_name || "Unassigned",
      r.weather,
      r.staff_on_site,
      r.labour_hours ?? "",
      r.trench_excavated ?? "",
      r.trench_backfilled ?? "",
      r.esb_5inch ?? "",
      r.esb_50mm ?? "",
      r.public_lighting ?? "",
      r.virgin_duct ?? "",
      r.eir_duct ?? "",
      r.siro_duct ?? "",
      r.ev_charger_duct ?? "",
      r.chambers_fitted ?? "",
      r.description,
      r.cause_of_delays || "",
      r.additional_work || "",
    ]);
  ws.addRows(rows);
  applyAutoFilterAndHeaderStyle(ws, REPORT_HEADER.length, rows.length + 1);
  return ws;
}

function buildMachineSheet(wb, machineHours, reportById) {
  const ws = wb.addWorksheet("Machine Hours");
  ws.columns = MACHINE_HEADER.map((h, i) => ({ header: h, width: MACHINE_COL_WIDTHS[i] }));
  const rows = machineHours
    .slice()
    .sort((a, b) => (a.log_date < b.log_date ? 1 : -1))
    .map((m) => {
      const report = m.report_id ? reportById[m.report_id] : null;
      return [m.log_date, report ? report.project_name || "Unassigned" : "Unassigned", m.machine_name, m.hours, m.driver_name];
    });
  ws.addRows(rows);
  applyAutoFilterAndHeaderStyle(ws, MACHINE_HEADER.length, rows.length + 1);
  return ws;
}

function buildRatesSheet(wb) {
  const ws = wb.addWorksheet("Rates");
  ws.columns = [{ width: 26 }, { width: 16 }];
  ws.addRow(["Fuel price (€/litre)", FUEL_PRICE_PER_LITRE]);
  ws.addRow(["Labour rate (€/hour)", LABOUR_RATE_PER_HOUR]);
  ws.addRow([]);
  ws.addRow(["Machine", "Tank capacity (L)"]);
  MACHINE_OPTIONS.forEach((m) => {
    ws.addRow([m, m in KNOWN_TANK_CAPACITY_L ? KNOWN_TANK_CAPACITY_L[m] : null]);
  });
  ws.getRow(1).font = { bold: true };
  ws.getRow(2).font = { bold: true };
  ws.getRow(4).font = { bold: true };
  const tankTableStartRow = 5; // first machine row (row 4 is the "Machine"/"Tank capacity" header)
  const tankTableEndRow = tankTableStartRow + MACHINE_OPTIONS.length - 1;
  return { ws, tankTableStartRow, tankTableEndRow };
}

// Cost Report: hours are pulled in automatically per project/machine (and labour).
// Fuel cost = hours x 0.2 x tank capacity x fuel price. Labour cost = hours x
// labour rate. A machine's Total Cost is fuel + labour for the hours it ran; a
// "Labour" row is ground-staff hours only (no fuel) — netted down per report
// via groundLabourHours() so a driver's operating hours aren't double-counted.
function buildCostReportSheet(wb, reports, machineHours, reportById, ratesRange) {
  const machineAgg = {};
  const machineProjects = new Set();
  machineHours.forEach((m) => {
    const report = m.report_id ? reportById[m.report_id] : null;
    const project = report ? report.project_name || "Unassigned" : "Unassigned";
    machineProjects.add(project);
    const key = project + KEY_SEP + m.machine_name;
    machineAgg[key] = (machineAgg[key] || 0) + (Number(m.hours) || 0);
  });

  const machineHoursByReport = machineHoursByReportId(machineHours);
  const labourAgg = {};
  reports.forEach((r) => {
    const project = r.project_name || "Unassigned";
    labourAgg[project] = (labourAgg[project] || 0) + groundLabourHours(r, machineHoursByReport);
  });

  const projectOrder = [...PROJECT_OPTIONS];
  const seen = new Set(projectOrder);
  [...Object.keys(labourAgg), ...machineProjects].forEach((p) => {
    if (!seen.has(p)) {
      seen.add(p);
      projectOrder.push(p);
    }
  });

  const costRows = [];
  projectOrder.forEach((project) => {
    MACHINE_OPTIONS.forEach((machine) => {
      const hrs = machineAgg[project + KEY_SEP + machine];
      if (hrs) costRows.push({ project, item: machine, hours: Number(hrs.toFixed(2)) });
    });
    const labHrs = labourAgg[project];
    if (labHrs) costRows.push({ project, item: "Labour", hours: Number(labHrs.toFixed(2)) });
  });

  const ws = wb.addWorksheet("Cost Report");
  ws.columns = [
    { header: "Project", width: 20 },
    { header: "Item", width: 22 },
    { header: "Hours", width: 10 },
    { header: "Fuel Cost (€)", width: 14 },
    { header: "Labour Cost (€)", width: 15 },
    { header: "Total Cost (€)", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };

  const dataStartRow = 2;
  costRows.forEach((row, i) => {
    const excelRow = dataStartRow + i;
    const isLabour = row.item === "Labour";
    const r = ws.getRow(excelRow);
    r.getCell(1).value = row.project;
    r.getCell(2).value = row.item;
    r.getCell(3).value = row.hours;
    r.getCell(4).value = isLabour
      ? 0
      : {
          formula: `C${excelRow}*0.2*VLOOKUP(B${excelRow},Rates!$A$${ratesRange.tankTableStartRow}:$B$${ratesRange.tankTableEndRow},2,FALSE)*Rates!$B$1`,
        };
    r.getCell(5).value = { formula: `C${excelRow}*Rates!$B$2` };
    r.getCell(6).value = { formula: `D${excelRow}+E${excelRow}` };
  });
  const dataEndRow = dataStartRow + costRows.length - 1;
  const hasData = costRows.length > 0;

  const totalsLabelRow = dataEndRow + 2;
  ws.getCell(`A${totalsLabelRow}`).value = "Project Totals";
  ws.getCell(`A${totalsLabelRow}`).font = { bold: true };
  const totalsStartRow = totalsLabelRow + 1;
  projectOrder.forEach((project, i) => {
    const excelRow = totalsStartRow + i;
    ws.getCell(`A${excelRow}`).value = project;
    ws.getCell(`F${excelRow}`).value = hasData
      ? { formula: `SUMIF($A$${dataStartRow}:$A$${dataEndRow},A${excelRow},$F$${dataStartRow}:$F$${dataEndRow})` }
      : 0;
  });
  const totalsEndRow = totalsStartRow + projectOrder.length - 1;

  const grandTotalRow = totalsEndRow + 2;
  ws.getCell(`A${grandTotalRow}`).value = "Grand Total";
  ws.getCell(`A${grandTotalRow}`).font = { bold: true };
  ws.getCell(`F${grandTotalRow}`).value = { formula: `SUM($F$${totalsStartRow}:$F$${totalsEndRow})` };
  ws.getCell(`F${grandTotalRow}`).font = { bold: true };

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(dataEndRow, 1), column: 6 } };
  return ws;
}

// Single pass over reports + machine_hours producing one totals record per
// project — reused by the Dashboard sheet's KPI tiles and chart images.
// Unlike buildCostReportSheet (which writes live formulas), this returns
// plain numbers because a chart image has to be drawn from real values.
function aggregateForDashboard(reports, machineHours, reportById) {
  const projectOrder = [...PROJECT_OPTIONS];
  const seen = new Set(projectOrder);
  const byProject = {};

  function bucket(p) {
    if (!seen.has(p)) {
      seen.add(p);
      projectOrder.push(p);
    }
    if (!byProject[p]) {
      byProject[p] = {
        project: p,
        reportCount: 0,
        trenchExcavated: 0,
        trenchBackfilled: 0,
        labourHoursGround: 0,
        machineHours: 0,
        fuelCost: 0,
        labourCost: 0,
        totalCost: 0,
      };
    }
    return byProject[p];
  }

  const machineHoursByReport = machineHoursByReportId(machineHours);
  reports.forEach((r) => {
    const b = bucket(r.project_name || "Unassigned");
    b.reportCount += 1;
    b.trenchExcavated += Number(r.trench_excavated) || 0;
    b.trenchBackfilled += Number(r.trench_backfilled) || 0;
    b.labourHoursGround += groundLabourHours(r, machineHoursByReport);
  });

  const machineHoursByProjectMachine = {};
  machineHours.forEach((m) => {
    const report = m.report_id ? reportById[m.report_id] : null;
    const p = report ? report.project_name || "Unassigned" : "Unassigned";
    bucket(p);
    const key = p + KEY_SEP + m.machine_name;
    machineHoursByProjectMachine[key] = (machineHoursByProjectMachine[key] || 0) + (Number(m.hours) || 0);
  });

  projectOrder.forEach((p) => {
    const b = bucket(p);
    MACHINE_OPTIONS.forEach((machine) => {
      const hrs = machineHoursByProjectMachine[p + KEY_SEP + machine] || 0;
      b.machineHours += hrs;
      const tank = machine in KNOWN_TANK_CAPACITY_L ? KNOWN_TANK_CAPACITY_L[machine] : 0;
      b.fuelCost += hrs * 0.2 * tank * FUEL_PRICE_PER_LITRE;
    });
    b.labourCost = (b.machineHours + b.labourHoursGround) * LABOUR_RATE_PER_HOUR;
    b.totalCost = b.fuelCost + b.labourCost;
  });

  return { projectOrder, perProject: projectOrder.map((p) => byProject[p]) };
}

// Dashboard sheet: KPI tiles + chart images, all computed fresh from the same
// live data as the other sheets. See dashboardCharts.js for why these are
// embedded pictures rather than native Excel chart objects.
function buildDashboardSheet(wb, reports, machineHours, reportById) {
  const ws = wb.addWorksheet("Dashboard", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 3 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 3 }];

  const totalReports = reports.length;
  const trenchExcavatedTotal = reports.reduce((s, r) => s + (Number(r.trench_excavated) || 0), 0);
  const trenchBackfilledTotal = reports.reduce((s, r) => s + (Number(r.trench_backfilled) || 0), 0);
  const chambersFittedTotal = reports.reduce((s, r) => s + (Number(r.chambers_fitted) || 0), 0);
  const machineHoursTotal = machineHours.reduce((s, m) => s + (Number(m.hours) || 0), 0);

  const { projectOrder, perProject } = aggregateForDashboard(reports, machineHours, reportById);
  const grandTotalCost = perProject.reduce((s, p) => s + p.totalCost, 0);

  ws.mergeCells("B2:G2");
  ws.getCell("B2").value = "Project Progress & Cost Dashboard";
  ws.getCell("B2").font = { bold: true, size: 18, color: { argb: "FF211F1A" } };

  ws.mergeCells("B3:G3");
  ws.getCell("B3").value = `Generated ${new Date().toLocaleString()} — ${totalReports} reports across ${projectOrder.length} projects`;
  ws.getCell("B3").font = { size: 11, color: { argb: "FF6B6459" } };

  const kpis = [
    ["Reports logged", String(totalReports)],
    ["Trench excavated", `${trenchExcavatedTotal} m`],
    ["Trench backfilled", `${trenchBackfilledTotal} m`],
    ["Chambers fitted", String(chambersFittedTotal)],
    ["Machine hours", `${machineHoursTotal} h`],
    ["Total cost", `€${grandTotalCost.toFixed(0)}`],
  ];
  kpis.forEach((kpi, i) => {
    const col = 2 + i;
    const labelCell = ws.getCell(5, col);
    labelCell.value = kpi[0];
    labelCell.font = { size: 9, bold: true, color: { argb: "FF8A8578" } };
    const valueCell = ws.getCell(6, col);
    valueCell.value = kpi[1];
    valueCell.font = { size: 16, bold: true, color: { argb: "FF211F1A" } };
  });

  ws.getCell(8, 2).value = "Reports by project";
  ws.getCell(8, 2).font = { bold: true, size: 12 };
  ws.getCell(8, 5).value = "Trench progress by project";
  ws.getCell(8, 5).font = { bold: true, size: 12 };

  const pieImg = renderPieChart({ data: perProject.map((p) => ({ label: p.project, value: p.reportCount })), width: 460, height: 280 });
  const pieId = wb.addImage({ base64: pieImg, extension: "png" });
  ws.addImage(pieId, { tl: { col: 1, row: 8 }, ext: { width: 460, height: 280 } });

  const trenchImg = renderGroupedBarChart({
    categories: perProject.map((p) => p.project),
    series: [
      { label: "Excavated", values: perProject.map((p) => Number(p.trenchExcavated.toFixed(1))) },
      { label: "Backfilled", values: perProject.map((p) => Number(p.trenchBackfilled.toFixed(1))) },
    ],
    width: 460,
    height: 280,
    unit: "m",
  });
  const trenchId = wb.addImage({ base64: trenchImg, extension: "png" });
  ws.addImage(trenchId, { tl: { col: 4, row: 8 }, ext: { width: 460, height: 280 } });

  ws.getCell(23, 2).value = "Operating cost by project (fuel + labour)";
  ws.getCell(23, 2).font = { bold: true, size: 12 };

  const costImg = renderStackedBarChart({
    categories: perProject.map((p) => p.project),
    segments: [
      { label: "Fuel", values: perProject.map((p) => Number(p.fuelCost.toFixed(2))) },
      { label: "Labour", values: perProject.map((p) => Number(p.labourCost.toFixed(2))) },
    ],
    width: 700,
    height: 300,
    prefix: "€",
  });
  const costId = wb.addImage({ base64: costImg, extension: "png" });
  ws.addImage(costId, { tl: { col: 1, row: 23 }, ext: { width: 700, height: 300 } });

  const notesStartRow = 42;
  ws.getCell(notesStartRow, 2).value = "How this was built";
  ws.getCell(notesStartRow, 2).font = { bold: true, size: 11 };
  const notes = [
    "Regenerated automatically every time a report is submitted or deleted — always current with live data. Charts are pictures, redrawn on every regeneration, not native Excel charts reactive to manual cell edits.",
    "Fuel rule: a machine run 6 hrs/day uses 1.2x its tank capacity -> 0.2x tank per hour, at the price on the Rates sheet.",
    "Labour rate is on the Rates sheet. \"Labour hours\" on a report is everyone's gross total for the day — that report's machine hours are automatically subtracted before it's costed as ground labour, so a driver's hours aren't paid twice (e.g. 7.75hrs entered, 6hrs driving -> 1.75hrs costed as ground labour).",
    'Machine tank capacities on the Rates sheet: "13T Hitachi" and Kubota are Joe\'s own figures; the rest were looked up online on 2026-08-17. Several are marked ASSUMPTION/AVERAGE in code comments (src/lib/exportExcel.js) where no exact spec was found or the model name was ambiguous — check those against the real machines and let me know any corrections.',
  ];
  notes.forEach((note, i) => {
    const row = notesStartRow + 1 + i;
    ws.mergeCells(row, 2, row, 7);
    const cell = ws.getCell(row, 2);
    cell.value = `• ${note}`;
    cell.font = { size: 10, color: { argb: "FF6B6459" } };
    cell.alignment = { wrapText: true };
  });

  return ws;
}

export function buildWorkbook(data) {
  const reports = data.reports;
  const machineHours = data.machineHours;
  const wb = new ExcelJS.Workbook();
  const reportById = {};
  reports.forEach((r) => {
    reportById[r.id] = r;
  });

  buildDashboardSheet(wb, reports, machineHours, reportById);
  buildReportsSheet(wb, reports);
  buildMachineSheet(wb, machineHours, reportById);
  const ratesResult = buildRatesSheet(wb);
  buildCostReportSheet(wb, reports, machineHours, reportById, ratesResult);

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
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME });

  const { error: uploadError } = await supabase.storage.from(EXPORT_BUCKET).upload(EXPORT_FILE, blob, {
    upsert: true,
    contentType: XLSX_MIME,
  });
  if (uploadError) throw uploadError;
}
