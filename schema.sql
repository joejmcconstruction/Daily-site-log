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

create policy "admins can view admin list"
on public.admin_users for select
to authenticated
using (auth.uid() in (select user_id from public.admin_users));

-- Helper used by every admin-only policy below.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

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
