import * as XLSX from "xlsx";

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

const COST_HEADER = ["Project", "Machine hours", "Machine cost (€)", "Labour hours", "Labour cost (€)", "Total cost (€)"];
const COST_COL_WIDTHS = [20, 14, 16, 14, 16, 16];

function applySheetFormatting(ws, colWidths) {
  const lastCol = colWidths.length - 1;
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } }) };
  ws["!cols"] = colWidths.map((w) => ({ wch: w }));
}

export function exportToExcel({ reports, machineHours, projectRows }) {
  const wb = XLSX.utils.book_new();

  const reportRows = (reports || [])
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
  const reportsSheet = XLSX.utils.json_to_sheet(reportRows, { header: REPORT_HEADER });
  applySheetFormatting(reportsSheet, REPORT_COL_WIDTHS);
  XLSX.utils.book_append_sheet(wb, reportsSheet, "Daily Reports");

  const reportById = {};
  (reports || []).forEach((r) => {
    reportById[r.id] = r;
  });

  const machineRows = (machineHours || [])
    .slice()
    .sort((a, b) => (a.log_date < b.log_date ? 1 : -1))
    .map((m) => {
      const report = m.report_id ? reportById[m.report_id] : null;
      return {
        Date: m.log_date,
        Project: report?.project_name || "Unassigned",
        Machine: m.machine_name,
        Hours: m.hours,
        Driver: m.driver_name,
      };
    });
  const machineSheet = XLSX.utils.json_to_sheet(machineRows, { header: MACHINE_HEADER });
  applySheetFormatting(machineSheet, MACHINE_COL_WIDTHS);
  XLSX.utils.book_append_sheet(wb, machineSheet, "Machine Hours");

  const costRows = (projectRows || []).map((p) => ({
    Project: p.project,
    "Machine hours": Number(p.machineHours.toFixed(2)),
    "Machine cost (€)": Number(p.machineCost.toFixed(2)),
    "Labour hours": Number(p.labourHours.toFixed(2)),
    "Labour cost (€)": Number(p.labourCost.toFixed(2)),
    "Total cost (€)": Number(p.totalCost.toFixed(2)),
  }));
  const costSheet = XLSX.utils.json_to_sheet(costRows, { header: COST_HEADER });
  applySheetFormatting(costSheet, COST_COL_WIDTHS);
  XLSX.utils.book_append_sheet(wb, costSheet, "Project Costs");

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `site-daily-report-${stamp}.xlsx`);
}
