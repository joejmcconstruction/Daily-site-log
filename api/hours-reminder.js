// Wednesday-afternoon check: are there working days or people with no hours
// logged for the Thursday-to-Wednesday week? Emails Joe only if something is
// missing. Runs from the Vercel cron (see vercel.json); can also be called by
// an admin from the app for a manual check (force=1 sends even if nothing is
// missing, so the email route can be tested).
import { authorise, findGaps, buildReminderEmail, loadWeek, weekRange, todayInDublin, addDays, sendMail, readBody, REMINDER_TO } from "./_lib/hoursReport.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const auth = await authorise(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const body = readBody(req);
    const today = todayInDublin();
    const week = weekRange(today);
    const data = await loadWeek(week);
    // Today's hours usually go in at the end of the day, so only days before
    // today count as missing.
    const gaps = findGaps(week, data, addDays(today, -1));
    const force = String(body.force || req.query?.force || "") === "1";
    const nothingMissing = gaps.missingDays.length === 0 && gaps.missingPeople.length === 0;

    if (nothingMissing && !force) {
      console.log("hours-reminder: nothing missing", JSON.stringify({ week }));
      return res.status(200).json({ sent: false, reason: "nothing missing", week: { start: week.start, end: week.end } });
    }

    const mail = buildReminderEmail(week, gaps, today);
    const messageId = await sendMail({ to: REMINDER_TO, subject: mail.subject, html: mail.html, text: mail.text });
    console.log("hours-reminder:", JSON.stringify({ via: auth.via, week, to: REMINDER_TO, gaps, messageId }));
    return res.status(200).json({ sent: true, to: REMINDER_TO, week: { start: week.start, end: week.end }, missingDays: gaps.missingDays, missingPeople: gaps.missingPeople });
  } catch (err) {
    console.error("hours-reminder failed:", err);
    return res.status(500).json({ error: err.message || "Hours reminder failed." });
  }
}
