import ExcelJS from "exceljs/dist/exceljs.min.js";
import { supabase } from "../supabaseClient";
import { PROJECT_OPTIONS, MACHINE_OPTIONS } from "./helpers";
import { renderPieChart, renderGroupedBarChart, renderStackedBarChart } from "./dashboardCharts";

const EXPORT_BUCKET = "reports-export";
const EXPORT_FILE = "site-daily-report.xlsx";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const KEY_SEP = "|||";

// Costing assumptions from Joe (2026-08-16, refined 2026-08-17, fuel rate
// corrected 2026-08-26) — see memory/project_costing_rules.md.
// Fuel: a machine run 5 hrs/day empties a full tank every 5 days -> 25 hours
// of running time uses one full tank -> 1/25 tank per hour.
// Labour: a driver's operating hours are costed as part of the machine (fuel +
// labour). The "Labour hours" field on a report is entered as everyone's GROSS
// total man-hours for the day (e.g. 3 staff x 7.75hrs), so before costing it as
// ground labour, that report's total machine hours are subtracted (floored at
// 0) — otherwise a driver's hours get paid once on the machine row and again
// inside the ground-labour total. Example: 7.75hrs entered, 6hrs of that spent
// driving the 13T Hitachi -> 1.75hrs costed as ground labour for that report.
// Dayworks (added 2026-09-03) extend the same idea: they're a subset of the day
// entered on top of the gross totals, and are netted out of contract hours
// before being costed separately. costingBuckets() below carries the full rule.
const FUEL_PRICE_PER_LITRE = 1.44; // EUR — from an EUR1440/1000L delivery, ~Aug 2026. Update here when fuel is repriced.
const FUEL_TANKS_PER_HOUR = 1 / 25; // a full tank lasts 25 hours of machine running time
const LABOUR_RATE_PER_HOUR = 35; // EUR/hour per man

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
  "Wacker Neuson Excavator": 35, // Joe confirmed EZ28 model — spec sheet (9.3 US gal)
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
  "ESB 50mm duct (m)",
  "Public lighting duct (m)",
  "Virgin duct (m)",
  "Virgin duct 32mm (m)",
  "Eir duct (m)",
  "Eir duct 32mm (m)",
  "Siro duct (m)",
  "EV charger duct (m)",
  "Chambers fitted",
  "Water main trench (m)",
  "Storm pipework 150mm (m)",
  "Gully pots fitted",
  "Tree pits excavated",
  "Kerb base prepped (m)",
  "Road base prepped (m2)",
  "Description",
  "Cause of delays",
  "Additional work",
];
const REPORT_COL_WIDTHS = [12, 18, 12, 30, 12, 16, 16, 14, 14, 18, 14, 16, 14, 16, 14, 16, 14, 18, 22, 16, 16, 18, 20, 40, 30, 30];

const MACHINE_HEADER = ["Date", "Project", "Machine", "Hours", "Driver"];
const MACHINE_COL_WIDTHS = [12, 18, 24, 10, 20];

const DAYWORK_HEADER = ["Date", "Project", "Man", "Machine", "Hours", "Description of activity"];
const DAYWORK_COL_WIDTHS = [12, 18, 20, 22, 10, 50];

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

// The single source of truth for how one day's hours split into cost buckets —
// used both by the Cost Report sheet (which turns them into live formulas) and
// by the Dashboard aggregate (which needs plain numbers to draw charts from).
//
// Everything on a report is entered GROSS and dayworks are a subset of the day,
// not extra on top of it: labour_hours is everyone's full day (driving and
// dayworks included), each machine row is that machine's full running time
// (daywork running included), and the daywork rows say how much of that day was
// spent on daywork. Per report, with
//   G  = labour_hours            (all man-hours)
//   M  = machine row hours       (per machine; driver man-hours, included in G)
//   Dm = daywork hours on a machine   (included in that machine's M)
//   Dh = daywork hand-work hours      (included in G, not in any M)
// the buckets are
//   dayworks         = Dm (fuel + labour) + Dh (labour)
//   contract machine = M - Dm    per machine, floored at 0
//   contract labour  = G - M - Dh          floored at 0
// which add back up to exactly G man-hours and M machine hours. So a crew member
// enters the day the obvious way — full totals everywhere — and nothing is
// charged twice or dropped.
function costingBuckets(reports, machineHours, dayworks, reportById) {
  function projectOf(reportId) {
    const r = reportId ? reportById[reportId] : null;
    return r ? r.project_name || "Unassigned" : "Unassigned";
  }

  const dwMachineByReportMachine = {};
  const dwHandByReport = {};
  dayworks.forEach((d) => {
    const hrs = Number(d.hours) || 0;
    if (d.machine_name) {
      const key = d.report_id + KEY_SEP + d.machine_name;
      dwMachineByReportMachine[key] = (dwMachineByReportMachine[key] || 0) + hrs;
    } else {
      dwHandByReport[d.report_id] = (dwHandByReport[d.report_id] || 0) + hrs;
    }
  });

  // Keyed per report AND machine, so daywork time comes off the same machine on
  // the same day rather than off the project's total.
  const machineByReportMachine = {};
  machineHours.forEach((m) => {
    const key = m.report_id + KEY_SEP + m.machine_name;
    machineByReportMachine[key] = (machineByReportMachine[key] || 0) + (Number(m.hours) || 0);
  });

  const projects = new Set();
  const contractMachineAgg = {};
  const dayworkMachineAgg = {};
  const contractLabourAgg = {};
  const dayworkLabourAgg = {};

  function add(agg, key, hrs) {
    if (hrs > 0) agg[key] = (agg[key] || 0) + hrs;
  }

  Object.entries(machineByReportMachine).forEach(([key, hrs]) => {
    const sep = key.indexOf(KEY_SEP);
    const reportId = key.slice(0, sep);
    const machine = key.slice(sep + KEY_SEP.length);
    const project = projectOf(reportId);
    projects.add(project);
    add(contractMachineAgg, project + KEY_SEP + machine, Math.max(0, hrs - (dwMachineByReportMachine[key] || 0)));
  });

  // Daywork machine hours are costed whether or not the crew also logged a
  // machine row for that day — the daywork sheet is the authority for them.
  Object.entries(dwMachineByReportMachine).forEach(([key, hrs]) => {
    const sep = key.indexOf(KEY_SEP);
    const project = projectOf(key.slice(0, sep));
    projects.add(project);
    add(dayworkMachineAgg, project + KEY_SEP + key.slice(sep + KEY_SEP.length), hrs);
  });

  Object.entries(dwHandByReport).forEach(([reportId, hrs]) => {
    const project = projectOf(reportId);
    projects.add(project);
    add(dayworkLabourAgg, project, hrs);
  });

  const machineHoursByReport = machineHoursByReportId(machineHours);
  reports.forEach((r) => {
    const project = r.project_name || "Unassigned";
    projects.add(project);
    const gross = Number(r.labour_hours) || 0;
    const driven = machineHoursByReport[r.id] || 0;
    const dwHand = dwHandByReport[r.id] || 0;
    add(contractLabourAgg, project, Math.max(0, gross - driven - dwHand));
  });

  return { projects, contractMachineAgg, dayworkMachineAgg, contractLabourAgg, dayworkLabourAgg };
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
      r.virgin_duct_32mm ?? "",
      r.eir_duct ?? "",
      r.eir_duct_32mm ?? "",
      r.siro_duct ?? "",
      r.ev_charger_duct ?? "",
      r.chambers_fitted ?? "",
      r.water_main_trench ?? "",
      r.storm_pipework_150mm ?? "",
      r.gully_pots_fitted ?? "",
      r.tree_pits_excavated ?? "",
      r.kerb_base_prepped ?? "",
      r.road_base_prepped ?? "",
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

// The line-by-line record behind the Dayworks rows on the Cost Report — one row
// per man and activity, so a charge can be traced back to the day and the
// signed sheet it came off.
function buildDayworksSheet(wb, dayworks, reportById) {
  const ws = wb.addWorksheet("Dayworks");
  ws.columns = DAYWORK_HEADER.map((h, i) => ({ header: h, width: DAYWORK_COL_WIDTHS[i] }));
  const rows = dayworks
    .slice()
    .sort((a, b) => (a.log_date < b.log_date ? 1 : -1))
    .map((d) => {
      const report = d.report_id ? reportById[d.report_id] : null;
      return [
        d.log_date,
        report ? report.project_name || "Unassigned" : "Unassigned",
        d.man_name,
        d.machine_name || "Hand work",
        d.hours,
        d.activity,
      ];
    });
  ws.addRows(rows);
  if (rows.length > 0) {
    const totalRow = rows.length + 3;
    ws.getCell(`D${totalRow}`).value = "Total daywork hours";
    ws.getCell(`D${totalRow}`).font = { bold: true };
    ws.getCell(`E${totalRow}`).value = { formula: `SUM(E2:E${rows.length + 1})` };
    ws.getCell(`E${totalRow}`).font = { bold: true };
  }
  applyAutoFilterAndHeaderStyle(ws, DAYWORK_HEADER.length, rows.length + 1);
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
// Fuel cost = hours x (1/25) x tank capacity x fuel price (25 hours of running
// time uses one full tank). Labour cost = hours x labour rate. A machine's
// Total Cost is fuel + labour for the hours it ran; a "Labour" row is
// ground-staff hours only (no fuel). Every row is tagged Contract or Dayworks in
// the Type column so the two can be filtered apart and are totalled separately
// per project. All the netting that keeps an hour from being charged twice —
// driving time out of ground labour, daywork time out of contract — happens in
// costingBuckets().
function buildCostReportSheet(wb, reports, machineHours, dayworks, reportById, ratesRange) {
  const buckets = costingBuckets(reports, machineHours, dayworks, reportById);

  const projectOrder = [...PROJECT_OPTIONS];
  const seen = new Set(projectOrder);
  buckets.projects.forEach((p) => {
    if (!seen.has(p)) {
      seen.add(p);
      projectOrder.push(p);
    }
  });

  const costRows = [];
  projectOrder.forEach((project) => {
    MACHINE_OPTIONS.forEach((machine) => {
      const hrs = buckets.contractMachineAgg[project + KEY_SEP + machine];
      if (hrs) costRows.push({ project, type: "Contract", item: machine, hours: Number(hrs.toFixed(2)) });
    });
    const labHrs = buckets.contractLabourAgg[project];
    if (labHrs) costRows.push({ project, type: "Contract", item: "Labour", hours: Number(labHrs.toFixed(2)) });

    MACHINE_OPTIONS.forEach((machine) => {
      const hrs = buckets.dayworkMachineAgg[project + KEY_SEP + machine];
      if (hrs) costRows.push({ project, type: "Dayworks", item: machine, hours: Number(hrs.toFixed(2)) });
    });
    const dwLabHrs = buckets.dayworkLabourAgg[project];
    if (dwLabHrs) costRows.push({ project, type: "Dayworks", item: "Labour", hours: Number(dwLabHrs.toFixed(2)) });
  });

  const ws = wb.addWorksheet("Cost Report");
  ws.columns = [
    { header: "Project", width: 20 },
    { header: "Type", width: 12 },
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
    r.getCell(2).value = row.type;
    r.getCell(3).value = row.item;
    r.getCell(4).value = row.hours;
    r.getCell(5).value = isLabour
      ? 0
      : {
          formula: `D${excelRow}*${FUEL_TANKS_PER_HOUR}*VLOOKUP(C${excelRow},Rates!$A$${ratesRange.tankTableStartRow}:$B$${ratesRange.tankTableEndRow},2,FALSE)*Rates!$B$1`,
        };
    r.getCell(6).value = { formula: `D${excelRow}*Rates!$B$2` };
    r.getCell(7).value = { formula: `E${excelRow}+F${excelRow}` };
  });
  const dataEndRow = dataStartRow + costRows.length - 1;
  const hasData = costRows.length > 0;

  const totalsLabelRow = dataEndRow + 2;
  ws.getCell(`A${totalsLabelRow}`).value = "Project Totals";
  ws.getCell(`A${totalsLabelRow}`).font = { bold: true };
  ws.getCell(`E${totalsLabelRow}`).value = "Contract (€)";
  ws.getCell(`F${totalsLabelRow}`).value = "Dayworks (€)";
  ws.getCell(`G${totalsLabelRow}`).value = "Total (€)";
  ["E", "F", "G"].forEach((col) => {
    ws.getCell(`${col}${totalsLabelRow}`).font = { bold: true };
  });

  const totalsStartRow = totalsLabelRow + 1;
  projectOrder.forEach((project, i) => {
    const excelRow = totalsStartRow + i;
    ws.getCell(`A${excelRow}`).value = project;
    const sumifs = (type) =>
      `SUMIFS($G$${dataStartRow}:$G$${dataEndRow},$A$${dataStartRow}:$A$${dataEndRow},A${excelRow},$B$${dataStartRow}:$B$${dataEndRow},"${type}")`;
    ws.getCell(`E${excelRow}`).value = hasData ? { formula: sumifs("Contract") } : 0;
    ws.getCell(`F${excelRow}`).value = hasData ? { formula: sumifs("Dayworks") } : 0;
    ws.getCell(`G${excelRow}`).value = { formula: `E${excelRow}+F${excelRow}` };
  });
  const totalsEndRow = totalsStartRow + projectOrder.length - 1;

  const grandTotalRow = totalsEndRow + 2;
  ws.getCell(`A${grandTotalRow}`).value = "Grand Total";
  ws.getCell(`A${grandTotalRow}`).font = { bold: true };
  ["E", "F", "G"].forEach((col) => {
    const cell = ws.getCell(`${col}${grandTotalRow}`);
    cell.value = { formula: `SUM(${col}${totalsStartRow}:${col}${totalsEndRow})` };
    cell.font = { bold: true };
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(dataEndRow, 1), column: 7 } };
  return ws;
}

// Single pass over reports + machine_hours producing one totals record per
// project — reused by the Dashboard sheet's KPI tiles and chart images.
// Unlike buildCostReportSheet (which writes live formulas), this returns
// plain numbers because a chart image has to be drawn from real values.
function aggregateForDashboard(reports, machineHours, dayworks, reportById) {
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
        dayworkHours: 0,
        fuelCost: 0,
        labourCost: 0,
        dayworksCost: 0,
        totalCost: 0,
      };
    }
    return byProject[p];
  }

  reports.forEach((r) => {
    const b = bucket(r.project_name || "Unassigned");
    b.reportCount += 1;
    b.trenchExcavated += Number(r.trench_excavated) || 0;
    b.trenchBackfilled += Number(r.trench_backfilled) || 0;
  });

  // Same buckets the Cost Report sheet is built from, so the two can't drift.
  const buckets = costingBuckets(reports, machineHours, dayworks, reportById);
  buckets.projects.forEach((p) => bucket(p));

  projectOrder.forEach((p) => {
    const b = bucket(p);
    b.labourHoursGround = buckets.contractLabourAgg[p] || 0;
    MACHINE_OPTIONS.forEach((machine) => {
      const tank = machine in KNOWN_TANK_CAPACITY_L ? KNOWN_TANK_CAPACITY_L[machine] : 0;

      const hrs = buckets.contractMachineAgg[p + KEY_SEP + machine] || 0;
      b.machineHours += hrs;
      b.fuelCost += hrs * FUEL_TANKS_PER_HOUR * tank * FUEL_PRICE_PER_LITRE;

      const dwHrs = buckets.dayworkMachineAgg[p + KEY_SEP + machine] || 0;
      b.dayworkHours += dwHrs;
      b.dayworksCost += dwHrs * FUEL_TANKS_PER_HOUR * tank * FUEL_PRICE_PER_LITRE + dwHrs * LABOUR_RATE_PER_HOUR;
    });
    const dwHandHrs = buckets.dayworkLabourAgg[p] || 0;
    b.dayworkHours += dwHandHrs;
    b.dayworksCost += dwHandHrs * LABOUR_RATE_PER_HOUR;

    b.labourCost = (b.machineHours + b.labourHoursGround) * LABOUR_RATE_PER_HOUR;
    b.totalCost = b.fuelCost + b.labourCost + b.dayworksCost;
  });

  return { projectOrder, perProject: projectOrder.map((p) => byProject[p]) };
}

// Dashboard sheet: KPI tiles + chart images, all computed fresh from the same
// live data as the other sheets. See dashboardCharts.js for why these are
// embedded pictures rather than native Excel chart objects.
function buildDashboardSheet(wb, reports, machineHours, dayworks, reportById) {
  const ws = wb.addWorksheet("Dashboard", { views: [{ showGridLines: false }] });
  ws.columns = [
    { width: 3 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 3 },
  ];

  const totalReports = reports.length;
  const trenchExcavatedTotal = reports.reduce((s, r) => s + (Number(r.trench_excavated) || 0), 0);
  const trenchBackfilledTotal = reports.reduce((s, r) => s + (Number(r.trench_backfilled) || 0), 0);
  const chambersFittedTotal = reports.reduce((s, r) => s + (Number(r.chambers_fitted) || 0), 0);
  const machineHoursTotal = machineHours.reduce((s, m) => s + (Number(m.hours) || 0), 0);

  const { projectOrder, perProject } = aggregateForDashboard(reports, machineHours, dayworks, reportById);
  const grandTotalCost = perProject.reduce((s, p) => s + p.totalCost, 0);
  const grandDayworksCost = perProject.reduce((s, p) => s + p.dayworksCost, 0);

  ws.mergeCells("B2:H2");
  ws.getCell("B2").value = "Project Progress & Cost Dashboard";
  ws.getCell("B2").font = { bold: true, size: 18, color: { argb: "FF211F1A" } };

  ws.mergeCells("B3:H3");
  ws.getCell("B3").value = `Generated ${new Date().toLocaleString()} — ${totalReports} reports across ${projectOrder.length} projects`;
  ws.getCell("B3").font = { size: 11, color: { argb: "FF6B6459" } };

  const kpis = [
    ["Reports logged", String(totalReports)],
    ["Trench excavated", `${trenchExcavatedTotal} m`],
    ["Trench backfilled", `${trenchBackfilledTotal} m`],
    ["Chambers fitted", String(chambersFittedTotal)],
    ["Machine hours", `${machineHoursTotal} h`],
    ["Dayworks cost", `€${grandDayworksCost.toFixed(0)}`],
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

  ws.getCell(23, 2).value = "Operating cost by project (contract fuel + labour, plus dayworks)";
  ws.getCell(23, 2).font = { bold: true, size: 12 };

  const costImg = renderStackedBarChart({
    categories: perProject.map((p) => p.project),
    segments: [
      { label: "Fuel", values: perProject.map((p) => Number(p.fuelCost.toFixed(2))) },
      { label: "Labour", values: perProject.map((p) => Number(p.labourCost.toFixed(2))) },
      { label: "Dayworks", values: perProject.map((p) => Number(p.dayworksCost.toFixed(2))) },
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
    "Fuel rule: a machine run 5 hrs/day empties a full tank every 5 days -> 25 hours of running time uses one full tank -> 1/25 tank per hour, at the price on the Rates sheet.",
    "Labour rate is on the Rates sheet. \"Labour hours\" on a report is everyone's gross total for the day — that report's machine hours are automatically subtracted before it's costed as ground labour, so a driver's hours aren't paid twice (e.g. 7.75hrs entered, 6hrs driving -> 1.75hrs costed as ground labour).",
    "Dayworks are costed on the same fuel and labour rules as contract work, but tagged separately: the Cost Report's Type column splits Contract from Dayworks and totals each per project, and the cost chart shows Dayworks as its own band. A daywork line with a machine carries fuel + labour for those hours; a hand-work line is labour only. Daywork hours are treated as a subset of the day, not extra on top — the crew enter full totals in Labour hours and the machine rows as normal, and daywork time is subtracted from those before the contract side is costed, so an hour is never charged twice. Contract + Dayworks hours always add back up to the day's gross. The line-by-line detail behind each charge is on the Dayworks sheet, and the signed sheet is attached to its report in the app.",
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
  const dayworks = data.dayworks || [];
  const wb = new ExcelJS.Workbook();
  const reportById = {};
  reports.forEach((r) => {
    reportById[r.id] = r;
  });

  buildDashboardSheet(wb, reports, machineHours, dayworks, reportById);
  buildReportsSheet(wb, reports);
  buildMachineSheet(wb, machineHours, reportById);
  buildDayworksSheet(wb, dayworks, reportById);
  const ratesResult = buildRatesSheet(wb);
  buildCostReportSheet(wb, reports, machineHours, dayworks, reportById, ratesResult);

  return wb;
}

// Regenerates the full workbook from the live data and overwrites the one
// private file in Supabase Storage. Called automatically after a report is
// submitted or deleted — there's no export button in the app.
async function currentUserIsAdmin() {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return false;
  // Same check the app uses for its admin tabs: admin_users is readable only by
  // admins, so a crew account gets an empty result rather than an error.
  const { data } = await supabase.from("admin_users").select("user_id").eq("user_id", uid).maybeSingle();
  return !!data;
}

export async function syncExcelExport() {
  // Non-admins skip the sync entirely, for two reasons. The workbook is rebuilt
  // from whatever the caller can read, and RLS limits a crew account to its own
  // reports — so a crew-triggered sync would overwrite the complete workbook
  // with a partial one. And since the export bucket is admin-only, the upload
  // would be refused anyway. Consequence: the file refreshes when an admin uses
  // the app (App.jsx syncs on load), not the moment a foreman files a report.
  if (!(await currentUserIsAdmin())) return;

  const [reportsRes, machineRes, dayworksRes] = await Promise.all([
    supabase.from("reports").select("*"),
    supabase.from("machine_hours").select("*"),
    supabase.from("dayworks").select("*"),
  ]);
  if (reportsRes.error) throw reportsRes.error;
  if (machineRes.error) throw machineRes.error;
  if (dayworksRes.error) throw dayworksRes.error;

  const wb = buildWorkbook({
    reports: reportsRes.data || [],
    machineHours: machineRes.data || [],
    dayworks: dayworksRes.data || [],
  });
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME });

  const { error: uploadError } = await supabase.storage.from(EXPORT_BUCKET).upload(EXPORT_FILE, blob, {
    upsert: true,
    contentType: XLSX_MIME,
  });
  if (uploadError) throw uploadError;
}
