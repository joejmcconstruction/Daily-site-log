-- ============================================================
-- Site Daily Report — Supabase schema
-- Run this once in: Supabase Dashboard > SQL Editor > New query
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Reports table ----------
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  report_date date not null,
  weather text not null,
  staff_on_site text not null,
  description text not null,
  trench_excavated numeric,
  trench_backfilled numeric,
  esb_5inch numeric,
  esb_50mm numeric,
  public_lighting numeric,
  virgin_duct numeric,
  eir_duct numeric,
  siro_duct numeric,
  ev_charger_duct numeric,
  chambers_fitted numeric,
  cause_of_delays text,
  additional_work text
);

-- ---------- Files attached to a report (photos + supporting docs) ----------
create table if not exists report_files (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  created_at timestamptz not null default now(),
  storage_path text not null,
  file_name text not null,
  file_type text,
  file_size bigint,
  kind text not null check (kind in ('photo', 'supporting'))
);

-- ---------- Row Level Security ----------
-- Locked down so only signed-in users (your crew) can read/write.
-- Everyone who's logged in shares the same log — simplest setup for one crew.

alter table reports enable row level security;
alter table report_files enable row level security;

create policy "authenticated users can read reports"
  on reports for select
  to authenticated
  using (true);

create policy "authenticated users can insert reports"
  on reports for insert
  to authenticated
  with check (true);

create policy "authenticated users can delete reports"
  on reports for delete
  to authenticated
  using (true);

create policy "authenticated users can read report_files"
  on report_files for select
  to authenticated
  using (true);

create policy "authenticated users can insert report_files"
  on report_files for insert
  to authenticated
  with check (true);

create policy "authenticated users can delete report_files"
  on report_files for delete
  to authenticated
  using (true);

-- ---------- Storage bucket for photos / files ----------
-- Creates a public bucket named 'site-reports'.
-- Public = anyone with the exact file URL can view it (URLs are long random paths,
-- not guessable/listable). Switch to private + signed URLs later if you need
-- stricter access control.

insert into storage.buckets (id, name, public)
values ('site-reports', 'site-reports', true)
on conflict (id) do nothing;

create policy "authenticated users can upload files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'site-reports');

create policy "authenticated users can read files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'site-reports');

create policy "anyone can view files via public url"
  on storage.objects for select
  to anon
  using (bucket_id = 'site-reports');

create policy "authenticated users can delete files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'site-reports');

-- ---------- Plant / machine hours ----------
create table public.machine_hours (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  log_date date not null,
  machine_name text not null,
  hours numeric not null,
  driver_name text not null
);

alter table public.machine_hours enable row level security;

create policy "Authenticated users can view machine hours"
on public.machine_hours for select
to authenticated
using (true);

create policy "Authenticated users can insert machine hours"
on public.machine_hours for insert
to authenticated
with check (true);

-- ---------- Combine reports + machine hours, add project & labour tracking ----------
-- Every report now records which project it's for and total labour hours,
-- and machine hours logged in the same submission link back to their report.

alter table public.reports add column if not exists project_name text;
alter table public.reports add column if not exists labour_hours numeric;

alter table public.machine_hours add column if not exists report_id uuid references public.reports(id) on delete cascade;

-- ---------- Private export file (manager-only Excel workbook) ----------
-- The app automatically regenerates a single .xlsx workbook after every report
-- is submitted or deleted, and overwrites this one file with it. The bucket is
-- NOT public, and there is no link to it anywhere in the app — download it from
-- the Supabase Dashboard: Storage > reports-export > site-daily-report.xlsx.
-- Note: cost rates are entered directly in that workbook's "Rates" sheet, not
-- in the app, so real cost figures never touch the database or crew-visible UI.

insert into storage.buckets (id, name, public)
values ('reports-export', 'reports-export', false)
on conflict (id) do nothing;

drop policy if exists "authenticated users can read export files" on storage.objects;
create policy "authenticated users can read export files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'reports-export');

drop policy if exists "authenticated users can write export files" on storage.objects;
create policy "authenticated users can write export files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'reports-export');

drop policy if exists "authenticated users can update export files" on storage.objects;
create policy "authenticated users can update export files"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'reports-export')
  with check (bucket_id = 'reports-export');

-- Optional cleanup: if you already ran an earlier version of this file that
-- created a cost_rates table, it's no longer used and safe to drop:
-- drop table if exists public.cost_rates;

-- ============================================================
-- Admin management module (private — Joe + a small admin allowlist only)
-- ============================================================
-- Restricted to whoever is listed in admin_users. Crew accounts never see
-- this data or these tabs — enforced at the database level via RLS, not
-- just hidden in the app UI, so it can't be reached even via devtools.

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- Helper used by every admin-only policy, including this table's own.
-- security definer lets it read admin_users without going through RLS,
-- which matters here specifically: a select policy on admin_users that
-- queried admin_users directly (auth.uid() in (select user_id from
-- admin_users)) would be self-referential and fail with "infinite
-- recursion detected in policy for relation admin_users".
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

create policy "admins can view admin list"
on public.admin_users for select
to authenticated
using (public.is_admin());

-- ---------- Compliance certs (machines + vehicles) ----------
create table public.compliance_certs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  category text not null check (category in ('machine', 'vehicle')),
  subject_name text not null, -- machine name (from the app's machine list) or vehicle registration
  cert_type text not null,    -- e.g. 'GA1', 'NCT', 'Tax', 'Insurance', or a custom type
  issue_date date,
  expiry_date date not null,
  file_path text,             -- path in the private admin-documents bucket, if a photo/file was attached
  file_name text,
  notes text
);

alter table public.compliance_certs enable row level security;

create policy "admins can view compliance certs"
on public.compliance_certs for select to authenticated using (public.is_admin());
create policy "admins can insert compliance certs"
on public.compliance_certs for insert to authenticated with check (public.is_admin());
create policy "admins can update compliance certs"
on public.compliance_certs for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete compliance certs"
on public.compliance_certs for delete to authenticated using (public.is_admin());

-- ---------- Employees ----------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  full_name text not null,
  role text,
  start_date date,
  annual_holiday_allowance numeric not null default 20,
  notes text
);

alter table public.employees enable row level security;

create policy "admins can view employees"
on public.employees for select to authenticated using (public.is_admin());
create policy "admins can insert employees"
on public.employees for insert to authenticated with check (public.is_admin());
create policy "admins can update employees"
on public.employees for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete employees"
on public.employees for delete to authenticated using (public.is_admin());

-- ---------- Employee training records ----------
create table public.employee_training (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  training_name text not null,
  completed_date date,
  expiry_date date,
  file_path text,             -- path in the private admin-documents bucket, if a photo/file was attached
  file_name text,
  notes text
);

alter table public.employee_training enable row level security;

create policy "admins can view employee training"
on public.employee_training for select to authenticated using (public.is_admin());
create policy "admins can insert employee training"
on public.employee_training for insert to authenticated with check (public.is_admin());
create policy "admins can update employee training"
on public.employee_training for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete employee training"
on public.employee_training for delete to authenticated using (public.is_admin());

-- ---------- Employee holidays ----------
create table public.employee_holidays (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  notes text
);

alter table public.employee_holidays enable row level security;

create policy "admins can view employee holidays"
on public.employee_holidays for select to authenticated using (public.is_admin());
create policy "admins can insert employee holidays"
on public.employee_holidays for insert to authenticated with check (public.is_admin());
create policy "admins can update employee holidays"
on public.employee_holidays for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete employee holidays"
on public.employee_holidays for delete to authenticated using (public.is_admin());

-- ---------- Private storage for cert/training photos & files ----------
-- Not public like site-reports — only admins can read or write here.
insert into storage.buckets (id, name, public)
values ('admin-documents', 'admin-documents', false)
on conflict (id) do nothing;

create policy "admins can read admin documents"
on storage.objects for select to authenticated
using (bucket_id = 'admin-documents' and public.is_admin());

create policy "admins can upload admin documents"
on storage.objects for insert to authenticated
with check (bucket_id = 'admin-documents' and public.is_admin());

create policy "admins can update admin documents"
on storage.objects for update to authenticated
using (bucket_id = 'admin-documents' and public.is_admin())
with check (bucket_id = 'admin-documents' and public.is_admin());

create policy "admins can delete admin documents"
on storage.objects for delete to authenticated
using (bucket_id = 'admin-documents' and public.is_admin());

-- Add an admin: they must already have a login (Supabase Dashboard >
-- Authentication > Users > Add user) before running this.
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'someone@example.com'
-- on conflict do nothing;

-- ============================================================
-- Lock report history down to each crew member's own reports
-- ============================================================
-- Previously every signed-in user could read/insert/delete every report,
-- machine-hours row, and attached file. Now each user only sees and manages
-- their own; admins (is_admin()) still see and manage everything.
-- Note: this does not change the site-reports storage bucket itself, which
-- stays public (file URLs are long random paths, not guessable/listable) —
-- only the database rows describing who owns what are now restricted.

drop policy if exists "authenticated users can read reports" on reports;
drop policy if exists "authenticated users can insert reports" on reports;
drop policy if exists "authenticated users can delete reports" on reports;

create policy "users read own reports, admins read all"
on reports for select to authenticated
using (created_by = auth.uid() or public.is_admin());

create policy "users insert own reports"
on reports for insert to authenticated
with check (created_by = auth.uid());

create policy "users delete own reports, admins delete all"
on reports for delete to authenticated
using (created_by = auth.uid() or public.is_admin());

drop policy if exists "authenticated users can read report_files" on report_files;
drop policy if exists "authenticated users can insert report_files" on report_files;
drop policy if exists "authenticated users can delete report_files" on report_files;

create policy "users read own report files, admins read all"
on report_files for select to authenticated
using (exists (select 1 from reports r where r.id = report_files.report_id and (r.created_by = auth.uid() or public.is_admin())));

create policy "users insert own report files"
on report_files for insert to authenticated
with check (exists (select 1 from reports r where r.id = report_files.report_id and r.created_by = auth.uid()));

create policy "users delete own report files, admins delete all"
on report_files for delete to authenticated
using (exists (select 1 from reports r where r.id = report_files.report_id and (r.created_by = auth.uid() or public.is_admin())));

drop policy if exists "Authenticated users can view machine hours" on public.machine_hours;
drop policy if exists "Authenticated users can insert machine hours" on public.machine_hours;

create policy "users view own machine hours, admins view all"
on public.machine_hours for select to authenticated
using (created_by = auth.uid() or public.is_admin());

create policy "users insert own machine hours"
on public.machine_hours for insert to authenticated
with check (created_by = auth.uid());

create policy "users delete own machine hours, admins delete all"
on public.machine_hours for delete to authenticated
using (created_by = auth.uid() or public.is_admin());

-- ============================================================
-- Email alerts: certs/training expiring within 5 days
-- ============================================================
-- Runs entirely in Postgres (no Edge Function to deploy) — pg_cron fires a
-- daily check, pg_net sends the HTTP request, Resend delivers the email.
-- The Resend API key lives in Supabase Vault (encrypted), not in app code.
-- Only sends when something is actually expired or due within 5 days —
-- silent otherwise. Note: it re-sends every day an item stays overdue,
-- there's no "already notified" de-dup yet.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Run this once with your real key before scheduling the job below:
-- select vault.create_secret('re_your_real_key_here', 'resend_api_key', 'Resend API key for expiry alerts');

create or replace function public.notify_expiring_certs_and_training()
returns void
language plpgsql
security definer
as $$
declare
  api_key text;
  admin_email text;
  body_html text;
  cert_rows text;
  training_rows text;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  if api_key is null then
    raise notice 'notify_expiring_certs_and_training: resend_api_key not set in vault, skipping';
    return;
  end if;

  select coalesce(string_agg(
    format('<li><b>%s</b> — %s (%s) expires %s</li>', subject_name, cert_type, category, expiry_date),
    ''
  ), '') into cert_rows
  from public.compliance_certs
  where expiry_date <= current_date + 5;

  select coalesce(string_agg(
    format('<li><b>%s</b> — %s expires %s</li>', e.full_name, t.training_name, t.expiry_date),
    ''
  ), '') into training_rows
  from public.employee_training t
  join public.employees e on e.id = t.employee_id
  where t.expiry_date is not null and t.expiry_date <= current_date + 5;

  if cert_rows = '' and training_rows = '' then
    return;
  end if;

  body_html := '<h2>Certs / training expiring within 5 days</h2>';
  if cert_rows <> '' then
    body_html := body_html || '<h3>Certs</h3><ul>' || cert_rows || '</ul>';
  end if;
  if training_rows <> '' then
    body_html := body_html || '<h3>Training</h3><ul>' || training_rows || '</ul>';
  end if;

  for admin_email in
    select u.email from public.admin_users a join auth.users u on u.id = a.user_id
  loop
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', 'JMC Site Alerts <onboarding@resend.dev>',
        'to', admin_email,
        'subject', 'Certs/training expiring soon',
        'html', body_html
      )
    );
  end loop;
end;
$$;

-- Runs every day at 07:00 UTC. Adjust the cron expression if you want a
-- different time (Ireland is UTC or UTC+1 depending on daylight saving).
select cron.schedule(
  'daily-expiry-check',
  '0 7 * * *',
  $$select public.notify_expiring_certs_and_training();$$
);
