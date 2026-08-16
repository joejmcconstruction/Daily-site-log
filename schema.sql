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
