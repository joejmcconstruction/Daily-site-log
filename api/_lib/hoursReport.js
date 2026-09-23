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
export const REPORT_CC = process.env.HOURS_REPORT_CC ?? "joemccormack.jmc@gmail.com";
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

  const anon = createClient(requireEnv("VITE_SUPABASE_URL"), requireEnv("VITE_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user) return { ok: false, status: 401, error: "Not signed in." };
  const { data: adminRow } = await adminClient().from("admin_users").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!adminRow) return { ok: false, status: 403, error: "Admins only." };
  return { ok: true, via: "admin", user: data.user };
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

const CELL = "padding:6px 8px;border:1px solid #d9dee8;font-size:13px;";
const HEAD = `${CELL}background:#16264d;color:#fff;font-weight:700;text-align:left;`;
const NUM = `${CELL}text-align:right;font-variant-numeric:tabular-nums;`;

export function buildWeeklyEmail(week, { employees, entries }) {
  const title = `Staff hours · ${shortDay(week.start)} – ${longDay(week.end)}`;
  const people = Array.from(new Set(entries.map((e) => e.name))).sort((a, b) => a.localeCompare(b));

  // Summary: person x day.
  const cell = {};
  entries.forEach((e) => {
    const k = `${e.name}|${e.work_date}`;
    cell[k] = (cell[k] || 0) + e.hours;
  });
  const dayTotals = week.days.map((d) => entries.filter((e) => e.work_date === d).reduce((s, e) => s + e.hours, 0));
  const grand = dayTotals.reduce((s, v) => s + v, 0);

  const summaryRows = people
    .map((name, i) => {
      const cells = week.days.map((d) => `<td style="${NUM}">${fmtHours(cell[`${name}|${d}`])}</td>`).join("");
      const total = week.days.reduce((s, d) => s + (cell[`${name}|${d}`] || 0), 0);
      const bg = i % 2 ? "#f5f7fb" : "#ffffff";
      return `<tr style="background:${bg}"><td style="${CELL}font-weight:600">${esc(name)}</td>${cells}<td style="${NUM}font-weight:700">${fmtHours(total)}</td></tr>`;
    })
    .join("");
  const totalsRow = `<tr style="background:#eef1f7"><td style="${CELL}font-weight:700">Total</td>${dayTotals
    .map((v) => `<td style="${NUM}font-weight:700">${fmtHours(v)}</td>`)
    .join("")}<td style="${NUM}font-weight:700">${fmtHours(grand)}</td></tr>`;

  const summaryTable = `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:720px">
<tr><th style="${HEAD}">Name</th>${week.days.map((d) => `<th style="${HEAD}text-align:right">${esc(shortDay(d).slice(0, 6))}</th>`).join("")}<th style="${HEAD}text-align:right">Total</th></tr>
${summaryRows}${totalsRow}</table>`;

  // Detail: every entry.
  const detailRows = entries
    .slice()
    .sort((a, b) => (a.work_date === b.work_date ? a.name.localeCompare(b.name) : a.work_date < b.work_date ? -1 : 1))
    .map(
      (e, i) =>
        `<tr style="background:${i % 2 ? "#f5f7fb" : "#ffffff"}"><td style="${CELL}">${esc(shortDay(e.work_date))}</td><td style="${CELL}">${esc(e.name)}</td><td style="${CELL}">${hhmm(e.clock_in)}–${hhmm(e.clock_out)}</td><td style="${NUM}">${e.break_minutes || 0}</td><td style="${NUM}">${fmtHours(e.hours)}</td><td style="${CELL}">${esc(e.project_name || "")}</td><td style="${CELL}">${esc(e.notes || "")}</td></tr>`
    )
    .join("");
  const detailTable = `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:720px">
<tr><th style="${HEAD}">Day</th><th style="${HEAD}">Name</th><th style="${HEAD}">In–out</th><th style="${HEAD}text-align:right">Break</th><th style="${HEAD}text-align:right">Hours</th><th style="${HEAD}">Project</th><th style="${HEAD}">Notes</th></tr>${detailRows}</table>`;

  // Notes by day.
  const noted = entries.filter((e) => e.notes && e.notes.trim());
  const notesByDay = week.days
    .map((d) => {
      const list = noted.filter((e) => e.work_date === d);
      if (!list.length) return "";
      return `<p style="margin:8px 0 2px;font-weight:700">${esc(shortDay(d))}</p><ul style="margin:0 0 6px 18px;padding:0">${list
        .map((e) => `<li style="font-size:13px;margin:2px 0"><b>${esc(e.name)}:</b> ${esc(e.notes.trim())}</li>`)
        .join("")}</ul>`;
    })
    .join("");

  const empty = entries.length === 0;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#131f3d;max-width:760px">
<h2 style="margin:0 0 4px;font-size:18px">${esc(title)}</h2>
<p style="margin:0 0 14px;color:#5b6478;font-size:13px">${people.length} ${people.length === 1 ? "person" : "people"} · ${entries.length} ${entries.length === 1 ? "entry" : "entries"} · ${fmtHours(grand) || 0} hours in total. Hours are net of breaks.</p>
${empty ? `<p style="font-size:14px"><b>No hours were logged this week.</b></p>` : `<h3 style="font-size:14px;margin:16px 0 6px">Hours per person</h3>${summaryTable}
<h3 style="font-size:14px;margin:20px 0 6px">Every entry</h3>${detailTable}
${notesByDay ? `<h3 style="font-size:14px;margin:20px 0 4px">Notes</h3>${notesByDay}` : ""}`}
<p style="margin:20px 0 0;color:#5b6478;font-size:12px">Sent automatically from the JMC site app · <a href="${esc(APP_URL)}" style="color:#16264d">${esc(APP_URL)}</a></p>
</div>`;

  const text = [
    title,
    "",
    ...people.map((name) => `${name}: ${fmtHours(week.days.reduce((s, d) => s + (cell[`${name}|${d}`] || 0), 0)) || 0} h`),
    `Total: ${fmtHours(grand) || 0} h`,
    "",
    ...entries.map((e) => `${shortDay(e.work_date)}  ${e.name}  ${hhmm(e.clock_in)}-${hhmm(e.clock_out)}  ${e.hours} h${e.project_name ? `  ${e.project_name}` : ""}${e.notes ? `  (${e.notes})` : ""}`),
  ].join("\n");

  return { subject: title, html, text, people: people.length, entries: entries.length, hours: Math.round(grand * 100) / 100 };
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

export async function sendMail({ to, cc, subject, html, text }) {
  const user = requireEnv("SMTP_USER");
  const pass = requireEnv("SMTP_PASS");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: (process.env.SMTP_SECURE || "true") !== "false",
    auth: { user, pass },
  });
  const from = process.env.MAIL_FROM || `JMC Site App <${user}>`;
  const info = await transporter.sendMail({ from, to, cc: cc || undefined, subject, html, text });
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
