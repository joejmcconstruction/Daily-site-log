// Weekly staff-hours report, Thursday to Wednesday, emailed to Kate.
// Runs from the Vercel cron on Wednesday evening (see vercel.json) and from
// the "Email week to Kate" button on the Staff > Hours tab.
//
// Query / body options: week=YYYY-MM-DD (any date inside the week wanted,
// default today), preview=1 (return the HTML instead of sending; admins only).
import {
  authorise,
  buildWeeklyEmail,
  loadWeek,
  weekRange,
  todayInDublin,
  isValidIso,
  sendMail,
  verifySmtp,
  readBody,
  REPORT_TO,
  REPORT_CC,
} from "./_lib/hoursReport.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const auth = await authorise(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const body = readBody(req);

    // Setup check from the app: which env vars are present, and can we log in
    // to the mail server. Reports true/false only, never the values.
    if (String(body.check || req.query?.check || "") === "1" && auth.via === "admin") {
      const env = Object.fromEntries(["SUPABASE_SERVICE_ROLE_KEY", "SMTP_USER", "SMTP_PASS", "CRON_SECRET"].map((k) => [k, !!process.env[k]]));
      let smtp = "not tried";
      if (env.SMTP_USER && env.SMTP_PASS) {
        try {
          await verifySmtp();
          smtp = "ok";
        } catch (e) {
          smtp = `failed: ${e.message}`;
        }
      }
      let database = "not tried";
      if (env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          await loadWeek(weekRange(todayInDublin()));
          database = "ok";
        } catch (e) {
          database = `failed: ${e.message}`;
        }
      }
      return res.status(200).json({ env, smtp, database, to: REPORT_TO, cc: REPORT_CC });
    }

    const anchor = body.week || req.query?.week;
    const week = weekRange(isValidIso(anchor) ? anchor : todayInDublin());
    const data = await loadWeek(week);
    const mail = buildWeeklyEmail(week, data);

    const preview = String(body.preview || req.query?.preview || "") === "1";
    if (preview && auth.via === "admin") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(mail.html);
    }

    const messageId = await sendMail({ to: REPORT_TO, cc: REPORT_CC, subject: mail.subject, html: mail.html, text: mail.text });
    console.log("hours-weekly:", JSON.stringify({ via: auth.via, week, to: REPORT_TO, people: mail.people, entries: mail.entries, hours: mail.hours, messageId }));
    return res.status(200).json({ sent: true, to: REPORT_TO, cc: REPORT_CC, week: { start: week.start, end: week.end }, people: mail.people, entries: mail.entries, hours: mail.hours });
  } catch (err) {
    console.error("hours-weekly failed:", err);
    return res.status(500).json({ error: err.message || "Weekly hours email failed." });
  }
}
