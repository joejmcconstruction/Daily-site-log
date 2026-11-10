// Morning check for certs and staff tickets that have expired or run out
// within the next few days. Emails Joe over the same Gmail route as the weekly
// hours report. Runs from the Vercel cron every day (see vercel.json) and from
// the "Email me the expiry list" button on the Certs tab.
//
// When it sends (so the inbox isn't filled with the same list every day):
//   - anything due within ALERT_DAYS: every morning until it's renewed
//   - only already-expired items left: Mondays only, as a weekly reminder
//   - nothing to report: no email
//
// Body / query options: force=1 (send today whatever the day, even if the list
// is empty; used by the button), preview=1 (return the email instead of
// sending; admins only).
import { authorise, adminClient, todayInDublin, addDays, longDay, shortDay, sendMail, readBody, REMINDER_TO, APP_URL } from "./_lib/hoursReport.js";

// Same notice window as the in-app badges (EXPIRY_WARNING_DAYS in adminHelpers.js).
const ALERT_DAYS = 5;
const ALERT_TO = process.env.CERT_ALERT_TO || REMINDER_TO;

const STAFF_CERT_LABEL = { safe_pass: "Safe Pass", manual_handling: "Manual Handling", cscs: "CSCS", first_aid: "First Aid" };

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

function staffCertName(row) {
  const label = STAFF_CERT_LABEL[row.cert_type];
  if (!label) return row.training_name || "Training";
  return row.cert_detail ? `${label} (${row.cert_detail})` : label;
}

// Only the newest cert of each kind counts: a renewed GA1 means last year's
// expired GA1 for the same machine is no longer a problem.
function latestPerKind(items) {
  const best = new Map();
  items.forEach((item) => {
    const key = `${item.group}|${item.who.toLowerCase()}|${item.what.toLowerCase()}`;
    const current = best.get(key);
    if (!current || item.expiry > current.expiry) best.set(key, item);
  });
  return Array.from(best.values());
}

export async function loadExpiring(today) {
  const db = adminClient();
  const [certRes, trainRes, empRes, plantRes] = await Promise.all([
    db.from("compliance_certs").select("category, subject_name, cert_type, expiry_date"),
    db.from("employee_training").select("*").not("expiry_date", "is", null),
    db.from("employees").select("*"),
    db.from("plant").select("*"),
  ]);
  if (certRes.error) throw certRes.error;
  if (trainRes.error) throw trainRes.error;
  if (empRes.error) throw empRes.error;
  // The plant table arrived with a later SQL block; without it nothing is
  // treated as removed.
  if (plantRes.error) console.warn("cert-alerts: plant not readable:", plantRes.error.message);

  const employees = Object.fromEntries((empRes.data || []).map((e) => [e.id, e]));
  const removedPlant = new Set((plantRes.data || []).filter((p) => p.archived_at).map((p) => String(p.name || "").toLowerCase()));

  const items = [];
  (certRes.data || []).forEach((c) => {
    if (!c.expiry_date) return;
    if (c.category === "machine" && removedPlant.has(String(c.subject_name || "").toLowerCase())) return;
    items.push({ group: c.category === "vehicle" ? "Road vehicles" : "Plant machinery", who: c.subject_name || "", what: c.cert_type || "Cert", expiry: c.expiry_date });
  });
  (trainRes.data || []).forEach((t) => {
    const person = employees[t.employee_id];
    // Staff who have been removed from the app don't need chasing.
    if (!person || person.archived_at) return;
    items.push({ group: "Staff", who: person.full_name || "", what: staffCertName(t), expiry: t.expiry_date });
  });

  const limit = addDays(today, ALERT_DAYS);
  return latestPerKind(items)
    .filter((i) => i.expiry <= limit)
    .map((i) => ({ ...i, daysLeft: daysBetween(today, i.expiry) }))
    .sort((a, b) => (a.expiry === b.expiry ? a.who.localeCompare(b.who) : a.expiry < b.expiry ? -1 : 1));
}

function whenText(item) {
  if (item.daysLeft < 0) return `Expired ${shortDay(item.expiry)} (${-item.daysLeft} ${item.daysLeft === -1 ? "day" : "days"} ago)`;
  if (item.daysLeft === 0) return "Expires today";
  if (item.daysLeft === 1) return "Expires tomorrow";
  return `Expires ${shortDay(item.expiry)} (in ${item.daysLeft} days)`;
}

export function buildCertEmail(items, today) {
  const expired = items.filter((i) => i.daysLeft < 0);
  const due = items.filter((i) => i.daysLeft >= 0);
  const bits = [];
  if (due.length) bits.push(`${due.length} due within ${ALERT_DAYS} days`);
  if (expired.length) bits.push(`${expired.length} expired`);
  const subject = items.length ? `Certs: ${bits.join(", ")}` : "Certs: nothing expired or due";

  const FONT = "font-family:Arial,Helvetica,sans-serif;";
  const TD = "padding:8px 10px;border-bottom:1px solid #e2e6ee;font-size:13px;color:#131f3d;vertical-align:top;";
  const TH = "padding:9px 10px;color:#ffffff;font-size:12px;font-weight:700;text-align:left;";
  const table = (title, colour, rows) =>
    rows.length
      ? `<h3 style="${FONT}font-size:15px;margin:22px 0 8px;color:#131f3d">${esc(title)}</h3>
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;border:1px solid #d9dee8">
<tr><th style="${TH}background:${colour}">Who / what</th><th style="${TH}background:${colour}">Cert</th><th style="${TH}background:${colour}">When</th><th style="${TH}background:${colour}">Type</th></tr>
${rows
  .map(
    (i, n) =>
      `<tr style="background:${n % 2 ? "#fafbfd" : "#ffffff"}"><td style="${TD}font-weight:700">${esc(i.who)}</td><td style="${TD}">${esc(i.what)}</td><td style="${TD}white-space:nowrap">${esc(whenText(i))}</td><td style="${TD}color:#5b6478">${esc(i.group)}</td></tr>`
  )
  .join("")}</table>`
      : "";

  const html = `<div style="background:#eef1f7;padding:20px 12px;${FONT}">
<div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;padding:22px 24px 26px;border:1px solid #d9dee8">
<div style="${FONT}font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#b8862c;margin-bottom:2px">JMC Construction</div>
<h2 style="${FONT}margin:0;font-size:21px;color:#131f3d">Certs check</h2>
<div style="${FONT}font-size:14px;color:#5b6478;margin-top:2px">${esc(longDay(today))}</div>
${items.length ? "" : `<p style="${FONT}font-size:14px;margin:18px 0 0"><b>Nothing has expired and nothing is due in the next ${ALERT_DAYS} days.</b></p>`}
${table(`Due in the next ${ALERT_DAYS} days`, "#b8862c", due)}
${table("Already expired", "#b3261e", expired)}
<p style="margin:20px 0 0"><a href="${esc(APP_URL)}" style="display:inline-block;background:#16264d;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;${FONT}font-size:14px">Open the app</a></p>
<p style="${FONT}margin:18px 0 0;color:#8b93a5;font-size:11.5px">Sent by the JMC site app. Items due soon are sent every morning until renewed; expired ones once a week on Monday. Update the cert in the app to stop the reminder.</p>
</div></div>`;

  const line = (i) => `- ${i.who}: ${i.what}. ${whenText(i)} [${i.group}]`;
  const text = [
    `Certs check, ${longDay(today)}`,
    "",
    ...(items.length ? [] : [`Nothing has expired and nothing is due in the next ${ALERT_DAYS} days.`]),
    ...(due.length ? [`DUE IN THE NEXT ${ALERT_DAYS} DAYS`, ...due.map(line), ""] : []),
    ...(expired.length ? ["ALREADY EXPIRED", ...expired.map(line), ""] : []),
    APP_URL,
  ].join("\n");

  return { subject, html, text, due: due.length, expired: expired.length };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const auth = await authorise(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const body = readBody(req);
    const flag = (name) => String(body[name] || req.query?.[name] || "") === "1";
    const today = todayInDublin();
    const items = await loadExpiring(today);
    const mail = buildCertEmail(items, today);

    if (flag("preview") && auth.via === "admin") {
      return res.status(200).json({ preview: true, subject: mail.subject, html: mail.html, due: mail.due, expired: mail.expired });
    }

    const isMonday = new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
    const worthSending = mail.due > 0 || (mail.expired > 0 && isMonday);
    if (!worthSending && !flag("force")) {
      const reason = items.length ? "only expired items, which go out on Mondays" : "nothing expired or due";
      console.log("cert-alerts: not sent,", reason);
      return res.status(200).json({ sent: false, reason, due: mail.due, expired: mail.expired });
    }

    const messageId = await sendMail({ to: ALERT_TO, subject: mail.subject, html: mail.html, text: mail.text });
    console.log("cert-alerts:", JSON.stringify({ via: auth.via, to: ALERT_TO, due: mail.due, expired: mail.expired, messageId }));
    return res.status(200).json({ sent: true, to: ALERT_TO, due: mail.due, expired: mail.expired });
  } catch (err) {
    console.error("cert-alerts failed:", err);
    return res.status(500).json({ error: err.message || "Cert alert failed." });
  }
}
