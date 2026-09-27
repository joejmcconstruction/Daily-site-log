// Shared by api/hours-weekly.js and api/hours-reminder.js: reads staff hours
// with the service-role key (these run from a Vercel cron, no user session),
// works out the Thursday-to-Wednesday week in Irish time, builds the email
// tables and sends them over SMTP (Gmail app password by default).
//
// Files under api/_lib are helpers, not endpoints — Vercel skips underscore
// folders when it deploys functions.
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

export const REPORT_TO = process.env.HOURS_REPORT_TO || "kate@jmcconstruction.com";
export const REPORT_CC = process.env.HOURS_REPORT_CC ?? "joemccormack.jmc@gmail.com, joe@jmcconstruction.com";
export const REMINDER_TO = process.env.HOURS_REMINDER_TO || "joemccormack.jmc@gmail.com";
export const APP_URL = process.env.APP_URL || "https://daily-site-log.vercel.app";

const TZ = "Europe/Dublin";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in Vercel > Settings > Environment Variables.`);
  return v;
}

export function adminClient() {
  return createClient(requireEnv("VITE_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// A request is allowed if it comes from Vercel's cron (Bearer CRON_SECRET, or
// the vercel-cron user agent when no secret is configured) or from a signed-in
// admin of the app (Supabase JWT from the Hours tab's button).
export async function authorise(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() || "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return { ok: true, via: "cron" };
  if (!cronSecret && /vercel-cron/i.test(req.headers["user-agent"] || "")) return { ok: true, via: "cron" };
  if (!token) return { ok: false, status: 401, error: "Not signed in." };

  // The admin check runs as the caller (their token, normal row security):
  // admins can read their own admin_users row, crew get nothing. This way it
  // doesn't depend on the service key being right.
  const asUser = createClient(requireEnv("VITE_SUPABASE_URL"), requireEnv("VITE_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await asUser.auth.getUser(token);
  if (error || !data?.user) return { ok: false, status: 401, error: "Not signed in." };
  const { data: adminRow, error: adminError } = await asUser.from("admin_users").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (adminError) return { ok: false, status: 500, error: `Admin check failed: ${adminError.message}` };
  if (!adminRow) return { ok: false, status: 403, error: "Admins only." };
  return { ok: true, via: "admin", user: data.user };
}

// Which kind of Supabase key is in SUPABASE_SERVICE_ROLE_KEY, read from the
// key itself (it's a JWT with a "role" claim): "service_role" is right,
// "anon" means the wrong key was copied.
export function serviceKeyRole() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return "missing";
  try {
    const payload = key.split(".")[1];
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return json.role || "unknown";
  } catch {
    return key.startsWith("sb_secret_") ? "service_role" : "unknown";
  }
}

// ---------- dates (all as YYYY-MM-DD strings, Irish calendar days) ----------

export function todayInDublin() {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function dayOfWeek(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

// The Thursday-to-Wednesday week containing `date`.
export function weekRange(date) {
  const back = (dayOfWeek(date) - 4 + 7) % 7;
  const start = addDays(date, -back);
  return { start, end: addDays(start, 6), days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) };
}

export function isValidIso(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function shortDay(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${DAY_NAMES[dayOfWeek(iso)]} ${d} ${MONTHS[m - 1]}`;
}

export function longDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${DAY_NAMES[dayOfWeek(iso)]} ${d} ${MONTHS[m - 1]} ${y}`;
}

// ---------- data ----------

function toMinutes(t) {
  const [h, m] = String(t || "00:00").slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

export function entryHours(row) {
  let mins = toMinutes(row.clock_out) - toMinutes(row.clock_in);
  if (mins < 0) mins += 24 * 60;
  mins -= Number(row.break_minutes) || 0;
  return Math.max(0, Math.round((mins / 60) * 100) / 100);
}

export async function loadWeek(week) {
  const db = adminClient();
  const [empRes, hoursRes] = await Promise.all([
    db.from("employees").select("id, full_name").order("full_name"),
    db.from("staff_hours").select("*").gte("work_date", week.start).lte("work_date", week.end).order("work_date").order("clock_in"),
  ]);
  if (empRes.error) throw empRes.error;
  if (hoursRes.error) throw hoursRes.error;
  const employees = empRes.data || [];
  const nameById = Object.fromEntries(employees.map((e) => [e.id, e.full_name]));
  const entries = (hoursRes.data || []).map((r) => ({ ...r, name: nameById[r.employee_id] || "Unknown", hours: entryHours(r) }));
  return { employees, entries };
}

// ---------- email building ----------

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function fmtHours(n) {
  return n ? (Math.round(n * 100) / 100).toString() : "";
}

function hhmm(t) {
  return String(t || "").slice(0, 5);
}

// Email styling is all inline (mail clients strip stylesheets). Navy header
// rows, zebra striping, right-aligned numbers, weekend columns tinted.
const FONT = "font-family:Arial,Helvetica,sans-serif;";
const TD = "padding:8px 10px;border-bottom:1px solid #e2e6ee;font-size:13px;color:#131f3d;vertical-align:top;";
const TH = `padding:9px 10px;background:#16264d;color:#ffffff;font-size:12px;font-weight:700;text-align:left;letter-spacing:0.02em;`;
const NUM = `${TD}text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;`;
const WEEKEND_BG = "#f3f5f9";

function isWeekend(iso) {
  const d = dayOfWeek(iso);
  return d === 0 || d === 6;
}

function dayHeader(iso) {
  const [, , d] = iso.split("-").map(Number);
  return `${DAY_NAMES[dayOfWeek(iso)]}<br><span style="font-weight:400;opacity:0.85">${d}</span>`;
}

function sectionTitle(text, sub) {
  return `<h3 style="${FONT}font-size:15px;margin:26px 0 8px;color:#131f3d">${esc(text)}${
    sub ? ` <span style="font-weight:400;color:#5b6478;font-size:12.5px">${esc(sub)}</span>` : ""
  }</h3>`;
}

// A small copy of the logo is served by the app itself (public/logo-email.png,
// 320px wide). For the real email it's attached inline (cid) so it shows in
// every mail client; the preview just links to it.
export const LOGO_URL = `${APP_URL}/logo-email.png`;

export async function fetchLogo() {
  try {
    const res = await fetch(LOGO_URL);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export function buildWeeklyEmail(week, { employees, entries }, { logoSrc = LOGO_URL } = {}) {
  const range = `${shortDay(week.start)} – ${longDay(week.end)}`;
  const title = `JMC Wage List Week (${range})`;
  const people = Array.from(new Set(entries.map((e) => e.name))).sort((a, b) => a.localeCompare(b));

  // Summary: person x day. Most of the crew are paid by the day, so a cell
  // is "Day" for a full-day entry and hours for clocked entries; totals are
  // "N days" plus any hourly time.
  const tally = () => ({ days: 0, hours: 0 });
  const cell = {};
  const personTotal = {};
  const dayTotal = Object.fromEntries(week.days.map((d) => [d, tally()]));
  const grand = tally();
  entries.forEach((e) => {
    const k = `${e.name}|${e.work_date}`;
    cell[k] = cell[k] || tally();
    personTotal[e.name] = personTotal[e.name] || tally();
    const buckets = [cell[k], personTotal[e.name], dayTotal[e.work_date], grand].filter(Boolean);
    if (e.entry_type === "full_day") buckets.forEach((b) => (b.days += 1));
    else buckets.forEach((b) => (b.hours += e.hours));
  });
  const daysWorked = week.days.filter((d) => dayTotal[d].days > 0 || dayTotal[d].hours > 0).length;

  const describe = (t, short = false) => {
    if (!t || (t.days === 0 && t.hours === 0)) return "";
    const parts = [];
    if (t.days) parts.push(short && t.days === 1 ? "Day" : `${t.days} ${t.days === 1 ? "day" : "days"}`);
    if (t.hours) parts.push(`${fmtHours(t.hours)}h`);
    return parts.join(" + ");
  };
  const dash = `<span style="color:#c5cad6">–</span>`;

  const summaryRows = people
    .map((name, i) => {
      const cells = week.days
        .map((d) => {
          const t = cell[`${name}|${d}`];
          const isDay = t && t.days > 0 && t.hours === 0;
          return `<td style="${NUM}${isWeekend(d) ? `background:${WEEKEND_BG};` : ""}${isDay ? "color:#1f9d63;font-weight:700;" : ""}">${describe(t, true) || dash}</td>`;
        })
        .join("");
      const bg = i % 2 ? "#fafbfd" : "#ffffff";
      return `<tr style="background:${bg}"><td style="${TD}font-weight:700;white-space:nowrap">${esc(name)}</td>${cells}<td style="${NUM}font-weight:700;background:#eef1f7">${describe(personTotal[name])}</td></tr>`;
    })
    .join("");
  const totalsRow = `<tr style="background:#e6eaf3"><td style="${TD}font-weight:700;border-bottom:none">Total</td>${week.days
    .map((d) => `<td style="${NUM}font-weight:700;border-bottom:none">${describe(dayTotal[d]) || "–"}</td>`)
    .join("")}<td style="${NUM}font-weight:700;border-bottom:none;background:#16264d;color:#fff">${describe(grand)}</td></tr>`;

  const summaryTable = `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;border:1px solid #d9dee8;border-radius:8px;overflow:hidden">
<tr><th style="${TH}">Name</th>${week.days.map((d) => `<th style="${TH}text-align:right">${dayHeader(d)}</th>`).join("")}<th style="${TH}text-align:right">Total</th></tr>
${summaryRows}${totalsRow}</table>`;

  // Notes: one row each, in a table with an amber accent so they can't be missed.
  const noted = entries
    .filter((e) => e.notes && e.notes.trim())
    .sort((a, b) => (a.work_date === b.work_date ? a.name.localeCompare(b.name) : a.work_date < b.work_date ? -1 : 1));
  const notesTable = noted.length
    ? `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;border:1px solid #e8d9b0;border-left:5px solid #b8862c;background:#fffaf0">
<tr><th style="${TH}background:#b8862c">Day</th><th style="${TH}background:#b8862c">Name</th><th style="${TH}background:#b8862c">Note</th></tr>
${noted
  .map(
    (e, i) =>
      `<tr style="background:${i % 2 ? "#fff6e3" : "#fffaf0"}"><td style="${TD}white-space:nowrap;border-color:#f0e4c8">${esc(shortDay(e.work_date))}</td><td style="${TD}font-weight:700;white-space:nowrap;border-color:#f0e4c8">${esc(e.name)}</td><td style="${TD}border-color:#f0e4c8">${esc(e.notes.trim())}</td></tr>`
  )
  .join("")}</table>`
    : `<p style="${FONT}font-size:13px;color:#5b6478;margin:0">No notes this week.</p>`;

  // Detail: every entry, at the bottom, for anyone who needs to check a day.
  const detailRows = entries
    .slice()
    .sort((a, b) => (a.work_date === b.work_date ? a.name.localeCompare(b.name) : a.work_date < b.work_date ? -1 : 1))
    .map(
      (e, i) =>
        `<tr style="background:${i % 2 ? "#fafbfd" : "#ffffff"}"><td style="${TD}font-size:12px;white-space:nowrap">${esc(shortDay(e.work_date))}</td><td style="${TD}font-size:12px;white-space:nowrap">${esc(e.name)}</td><td style="${TD}font-size:12px;white-space:nowrap">${
          e.entry_type === "full_day" ? `<span style="color:#1f9d63;font-weight:700">Full day</span>` : `${hhmm(e.clock_in)} – ${hhmm(e.clock_out)}`
        }</td><td style="${NUM}font-size:12px">${e.entry_type === "full_day" ? "" : e.break_minutes || 0}</td><td style="${NUM}font-size:12px;font-weight:700">${e.entry_type === "full_day" ? "1 day" : `${fmtHours(e.hours)}h`}</td><td style="${TD}font-size:12px">${esc(e.project_name || "")}</td></tr>`
    )
    .join("");
  const detailTable = `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;border:1px solid #e2e6ee">
<tr><th style="${TH}background:#5b6478">Day</th><th style="${TH}background:#5b6478">Name</th><th style="${TH}background:#5b6478">In – out</th><th style="${TH}background:#5b6478;text-align:right">Break (min)</th><th style="${TH}background:#5b6478;text-align:right">Hours</th><th style="${TH}background:#5b6478">Project</th></tr>${detailRows}</table>`;

  const stat = (label, value) =>
    `<td style="padding:0 18px 0 0"><div style="${FONT}font-size:22px;font-weight:800;color:#131f3d">${value}</div><div style="${FONT}font-size:11px;color:#5b6478;text-transform:uppercase;letter-spacing:0.05em">${label}</div></td>`;

  const empty = entries.length === 0;
  const html = `<div style="background:#eef1f7;padding:20px 12px;${FONT}">
<div style="max-width:760px;margin:0 auto;background:#ffffff;border-radius:12px;padding:22px 24px 26px;border:1px solid #d9dee8">
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:16px;width:100%"><tr>
<td style="vertical-align:middle;padding:0 16px 0 0;width:120px"><img src="${esc(logoSrc)}" alt="JMC Construction" width="120" style="display:block;width:120px;height:auto;border:0"></td>
<td style="vertical-align:middle">
<div style="${FONT}font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#b8862c;margin-bottom:2px">JMC Construction</div>
<h2 style="${FONT}margin:0;font-size:21px;color:#131f3d;line-height:1.2">JMC Wage List</h2>
<div style="${FONT}font-size:14px;color:#5b6478;margin-top:2px">Week ${esc(range)}</div>
</td></tr></table>
${
  empty
    ? `<p style="font-size:14px;margin:0"><b>No hours were logged this week.</b></p>`
    : `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:6px"><tr>${grand.days ? stat("Full days", grand.days) : ""}${grand.hours ? stat("Hours", fmtHours(grand.hours)) : ""}${stat(people.length === 1 ? "Person" : "People", people.length)}${stat(daysWorked === 1 ? "Day worked" : "Days worked", daysWorked)}</tr></table>
<p style="margin:0 0 4px;color:#5b6478;font-size:12px">Thursday to Wednesday. "Day" is a full day; hours are clocked time net of breaks.</p>
${sectionTitle("Hours per person")}${summaryTable}
${sectionTitle("Notes", noted.length ? `${noted.length} this week` : "")}${notesTable}
${sectionTitle("Every entry", "for checking a day, if needed")}${detailTable}`
}
<p style="margin:22px 0 0;color:#8b93a5;font-size:11.5px">Sent automatically from the JMC site app every Wednesday at 8pm · <a href="${esc(APP_URL)}" style="color:#16264d">${esc(APP_URL)}</a></p>
</div></div>`;

  const text = [
    title,
    "",
    "PER PERSON",
    ...people.map((name) => `${name}: ${describe(personTotal[name]) || "0"}`),
    `Total: ${describe(grand) || "0"}`,
    "",
    "NOTES",
    ...(noted.length ? noted.map((e) => `${shortDay(e.work_date)}  ${e.name}: ${e.notes.trim()}`) : ["No notes this week."]),
    "",
    "EVERY ENTRY",
    ...entries.map(
      (e) =>
        `${shortDay(e.work_date)}  ${e.name}  ${e.entry_type === "full_day" ? "Full day" : `${hhmm(e.clock_in)}-${hhmm(e.clock_out)}  ${e.hours} h`}${e.project_name ? `  ${e.project_name}` : ""}`
    ),
  ].join("\n");

  return { subject: title, html, text, people: people.length, entries: entries.length, days: grand.days, hours: Math.round(grand.hours * 100) / 100 };
}

// What's missing so far this week: working days with nothing logged, and
// people with nothing logged. `upTo` is the last day to check (yesterday, when
// this runs mid-afternoon on Wednesday).
export function findGaps(week, { employees, entries }, upTo) {
  const daysToCheck = week.days.filter((d) => d <= upTo && dayOfWeek(d) >= 1 && dayOfWeek(d) <= 5);
  const missingDays = daysToCheck.filter((d) => !entries.some((e) => e.work_date === d));
  const withHours = new Set(entries.map((e) => e.employee_id));
  const missingPeople = employees.filter((e) => !withHours.has(e.id)).map((e) => e.full_name);
  return { missingDays, missingPeople, daysChecked: daysToCheck };
}

export function buildReminderEmail(week, gaps, today) {
  const subject = `Hours check: ${gaps.missingDays.length ? `${gaps.missingDays.length} day${gaps.missingDays.length === 1 ? "" : "s"} missing` : "all days in"}${gaps.missingPeople.length ? `, ${gaps.missingPeople.length} ${gaps.missingPeople.length === 1 ? "person" : "people"} with no hours` : ""}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#131f3d;max-width:640px">
<h2 style="margin:0 0 6px;font-size:18px">Hours check before tonight's report</h2>
<p style="margin:0 0 12px;font-size:13px;color:#5b6478">Week ${esc(shortDay(week.start))} – ${esc(longDay(week.end))}. The weekly hours go to Kate at 8pm.</p>
${gaps.missingDays.length ? `<p style="font-size:14px;margin:10px 0 4px"><b>Days with no hours logged</b></p><ul style="margin:0 0 10px 18px">${gaps.missingDays.map((d) => `<li>${esc(longDay(d))}</li>`).join("")}</ul>` : `<p style="font-size:14px">Every working day up to ${esc(shortDay(gaps.daysChecked[gaps.daysChecked.length - 1] || today))} has hours logged.</p>`}
${gaps.missingPeople.length ? `<p style="font-size:14px;margin:10px 0 4px"><b>No hours this week for</b></p><ul style="margin:0 0 10px 18px">${gaps.missingPeople.map((n) => `<li>${esc(n)}</li>`).join("")}</ul><p style="font-size:12px;color:#5b6478">Fine if they weren't working, this is just a check.</p>` : ""}
<p style="font-size:14px">Today's (${esc(shortDay(today))}) hours still need to go in before 8pm.</p>
<p style="margin:16px 0 0"><a href="${esc(APP_URL)}" style="display:inline-block;background:#16264d;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700">Open the app</a></p>
</div>`;
  const text = [
    "Hours check before tonight's report",
    `Week ${shortDay(week.start)} - ${longDay(week.end)}`,
    gaps.missingDays.length ? `Days with no hours: ${gaps.missingDays.map(longDay).join(", ")}` : "All working days so far have hours.",
    gaps.missingPeople.length ? `No hours this week for: ${gaps.missingPeople.join(", ")}` : "",
    `Today's hours still to go in before 8pm. ${APP_URL}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { subject, html, text };
}

// ---------- sending ----------

function transport() {
  const user = requireEnv("SMTP_USER");
  // Gmail shows app passwords in four groups; spaces are not part of the password.
  const pass = requireEnv("SMTP_PASS").replace(/\s+/g, "");
  return {
    user,
    transporter: nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 465),
      secure: (process.env.SMTP_SECURE || "true") !== "false",
      auth: { user, pass },
    }),
  };
}

export async function verifySmtp() {
  const { transporter } = transport();
  await transporter.verify();
}

export async function sendMail({ to, cc, subject, html, text, attachments }) {
  const { user, transporter } = transport();
  const from = process.env.MAIL_FROM || `JMC Construction <${user}>`;
  const info = await transporter.sendMail({ from, to, cc: cc || undefined, subject, html, text, attachments: attachments || undefined });
  return info.messageId;
}

export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}
