# Site Daily Report

A standalone daily report app for construction sites — weather, staff, work completed,
ducting/trenching quantities, delays, and photo/file uploads. Works on any phone via
the browser, saved to the home screen like a normal app. No Claude account needed.

Runs on:
- **Frontend:** React (Vite), hosted free on Vercel
- **Backend:** Supabase (Postgres database + file storage + login), free tier

Total cost to run this for one crew: **€0–15/year** (only cost is an optional custom domain).

---

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free).
2. Click **New project**. Pick a name, a database password (save it somewhere), and a region close to your site.
3. Wait ~2 minutes for it to finish provisioning.

## 2. Set up the database and file storage

1. In your Supabase project, open **SQL Editor** (left sidebar) → **New query**.
2. Open `supabase/schema.sql` from this project, copy all of it, paste it in, and click **Run**.
3. This creates the `reports` and `report_files` tables, locks them down so only signed-in
   users can read/write them, and creates a `site-reports` storage bucket for photos and files.

## 3. Add your foreman's login

By design, there's no public sign-up page — only people you add can log in.

1. In Supabase, go to **Authentication → Users → Add user**.
2. Enter an email and a password for your foreman (or yourself). Tick **Auto Confirm User**.
3. Repeat for anyone else who needs access. Everyone shares the same log — one project, one crew.

## 4. Get your API keys

1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key.
3. In this project folder, copy `.env.example` to a new file named `.env`:
   ```
   cp .env.example .env
   ```
4. Paste your values in:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   VITE_PROJECT_NAME=Your Project Name
   ```

## 5. Run it locally (optional, to test first)

You'll need [Node.js](https://nodejs.org) installed (v18+).

```
npm install
npm run dev
```

Open the local URL it prints (usually `http://localhost:5173`). Sign in with the login
you created in step 3 and try submitting a report.

## 6. Deploy it so it's live on the internet

The easiest free option is **Vercel**:

1. Push this project folder to a new GitHub repository (or use Vercel's CLI to deploy
   directly without GitHub — `npx vercel` from this folder works too).
2. Go to [vercel.com](https://vercel.com), sign up free, click **Add New → Project**,
   and import your repository.
3. Vercel auto-detects it's a Vite project — leave the build settings as default.
4. Before deploying, add your environment variables under **Settings → Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_PROJECT_NAME`
5. Click **Deploy**. In a minute or two you'll get a live URL like
   `site-daily-report.vercel.app`.

## 7. Put it on your foreman's phone

1. Open the live Vercel URL in the phone's browser (Safari on iPhone, Chrome on Android).
2. **iPhone (Safari):** tap Share → **Add to Home Screen**.
3. **Android (Chrome):** tap the menu (⋮) → **Add to Home screen**.
4. It'll now sit on the home screen with its own icon and open full-screen, no browser bar.

## 8. Optional: a custom domain

If you'd rather have `sitelog.yourcompany.com` than the free `.vercel.app` address:

1. Buy a domain (~€10–15/year) from any registrar (Namecheap, GoDaddy, etc.) — or use a
   subdomain of one you already own, which is free.
2. In Vercel, go to **Settings → Domains**, add your domain, and follow the DNS
   instructions it gives you.

---

## 9. Dockets, receipts & costs (automatic document reading)

The **Dockets** tab lets anyone on site photograph a delivery docket, a merchant
receipt (Chadwicks and the like) or a supplier invoice. Claude reads the document
number, supplier, date, each item with quantity, and on receipts and invoices the
prices, VAT and whether it was paid. The app prefills a record for you to check,
pick the project, and save. Every saved line lands on the **Deliveries** sheet
(a filterable Excel table with a plain-English Description column), the
**Delivery Summary** sheet (quantities by product and month) and the
**Costs by Project** sheet (ex-VAT cost by project, category and supplier by
month, plus what's unpaid) of the export workbook. The tab also has its own
**Excel** button that downloads the register for whatever filter is showing.

Prices are admin-only, the same rule as the costed workbook: crew accounts see
what came in, never what it cost. A foreman scanning a receipt still logs the
items; an admin can add the prices later by opening the line.

Setup, once:

1. In Supabase → SQL Editor, run the **Deliveries & dockets** block and then the
   **Receipts, invoices and costs** block at the bottom of `schema.sql` (both are
   safe to re-run).
2. Get an API key at [console.anthropic.com](https://console.anthropic.com) →
   Settings → API keys.
3. In Vercel → your project → **Settings → Environment Variables**, add
   `ANTHROPIC_API_KEY` with that key for all environments, then **Redeploy**.
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be there too (they are if
   the app already deploys) — the reader uses them to check the caller is signed in.

How it works:

- Reading runs in `api/read-docket.js`, a Vercel serverless function deployed
  automatically with the app, so the key never reaches the browser.
- Each docket costs roughly 1–3 cent to read at Claude Opus 5 rates.
- A docket with several product lines becomes several delivery lines sharing one
  photo. Anything the reader can't make out is left blank and the delivery is
  flagged **Check** so it gets compared with the paper docket later.
- Photos are shrunk to 2000px before upload. PDFs over about 3 MB are still stored
  but have to be typed in by hand (Vercel's request size limit).
- The supplier and product pick lists live in `src/lib/deliveries.js`
  (`SUPPLIER_OPTIONS`, `DELIVERY_PRODUCT_OPTIONS`); cost categories in
  `src/lib/costCategories.js`; projects in `PROJECT_OPTIONS` in `src/lib/helpers.js`.
  Free text is allowed for suppliers and products; the lists just make the common
  ones a tap away and give the reader names to snap to.
- Every card has a **What the reader saw** panel showing the full transcript the
  reader made before filling the fields — open it when a read looks wrong.
- Dockets are stored in a public-by-URL `dockets` bucket, same as report photos, so
  the **Open** links in the Excel export keep working.

---

## Notes

- **Photos** are compressed in the browser before upload to keep storage and mobile
  data usage down, while staying clear enough to review.
- **Storage bucket is public** by URL — anyone with the exact (long, random) file link
  can view it, but files aren't listable or guessable. If you need stricter control
  (e.g. signed, expiring links), that's a small follow-up change to
  `supabase/schema.sql` and `ReportDetail.jsx` — ask and I can do it.
- **Supabase free tier** covers 500MB database + 1GB file storage + 50,000 monthly
  active users — miles more than one crew logging daily reports needs. If you ever
  outgrow it, Supabase's paid tier starts at $25/month.
- **Adding more fields or projects:** the form fields live in
  `src/lib/helpers.js` (`DUCT_FIELDS`, `WEATHER_OPTIONS`) — add a field there, add the
  matching column in Supabase, and it'll show up in the form and detail view.
