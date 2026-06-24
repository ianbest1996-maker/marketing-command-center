-- 餐饮营销作战中心 MVP 云端表结构
-- 在 Supabase SQL Editor 中先执行本文件，再执行 seed.sql。

create extension if not exists pgcrypto;

create table if not exists brands (
  name text primary key,
  owner text,
  created_at timestamptz not null default now()
);

create table if not exists app_users (
  id text primary key,
  name text not null,
  role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists stores (
  id text primary key,
  name text not null,
  brand text not null references brands(name),
  manager text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists activities (
  id text primary key,
  name text not null,
  type text not null,
  brand text not null references brands(name),
  scale text not null,
  owner text not null,
  start_date date not null,
  end_date date not null,
  prep_start_date date not null,
  goal text not null,
  plan text not null,
  budget integer not null default 0,
  actual_cost integer not null default 0,
  status text not null,
  previous_activity_id text references activities(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists activity_stores (
  activity_id text not null references activities(id) on delete cascade,
  store_id text not null references stores(id),
  primary key (activity_id, store_id)
);

create table if not exists tasks (
  id text primary key,
  activity_id text not null references activities(id) on delete cascade,
  title text not null,
  type text not null,
  owner text not null,
  store_id text references stores(id),
  due_date date not null,
  status text not null,
  standard text not null,
  is_key boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists design_assets (
  id text primary key,
  activity_id text not null references activities(id) on delete cascade,
  title text not null,
  type text not null,
  purpose text,
  file_names text[] not null default '{}',
  files jsonb not null default '[]'::jsonb,
  designer text not null,
  version integer not null default 1,
  status text not null,
  submitted_at date not null,
  reviewed_at date,
  reviewer text,
  review_comment text,
  preview_title text not null,
  preview_subtitle text not null,
  preview_cta text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ideas (
  id text primary key,
  title text not null,
  platform text not null,
  url text not null default '',
  budget integer not null default 0,
  suggestion text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists idea_brands (
  idea_id text not null references ideas(id) on delete cascade,
  brand text not null references brands(name),
  primary key (idea_id, brand)
);

create table if not exists store_appointments (
  id text primary key,
  activity_id text not null references activities(id) on delete cascade,
  store_id text not null references stores(id),
  type text not null,
  title text not null,
  requested_by text not null,
  detail text not null,
  candidate_slots text[] not null default '{}',
  selected_slot text,
  status text not null,
  created_at date not null,
  updated_at timestamptz not null default now()
);

create table if not exists operation_submissions (
  id text primary key,
  activity_id text not null references activities(id) on delete cascade,
  type text not null,
  title text not null,
  owner text not null,
  benchmark_links text not null,
  content_plan text not null,
  budget integer,
  need_design boolean not null default false,
  design_request text,
  status text not null,
  submitted_at date not null,
  review_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists material_task_statuses (
  task_id text primary key references tasks(id) on delete cascade,
  status text not null,
  updated_at timestamptz not null default now()
);

create table if not exists cost_confirmations (
  activity_id text primary key references activities(id) on delete cascade,
  confirmed_at timestamptz not null default now()
);

create table if not exists store_reports (
  id text primary key,
  activity_id text not null references activities(id) on delete cascade,
  store_id text not null references stores(id),
  package_sales integer not null default 0,
  revenue integer not null default 0,
  visits integer not null default 0,
  before_value integer not null default 0,
  last_year_value integer not null default 0,
  note text not null default '',
  submitted_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists file_assets (
  id uuid primary key default gen_random_uuid(),
  activity_id text references activities(id) on delete cascade,
  task_id text references tasks(id) on delete set null,
  owner_name text not null,
  file_name text not null,
  file_type text not null,
  storage_bucket text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists operation_logs (
  id uuid primary key default gen_random_uuid(),
  activity_id text references activities(id) on delete cascade,
  actor_name text not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists app_users_updated_at on app_users;
create trigger app_users_updated_at before update on app_users
for each row execute function set_updated_at();

drop trigger if exists stores_updated_at on stores;
create trigger stores_updated_at before update on stores
for each row execute function set_updated_at();

drop trigger if exists activities_updated_at on activities;
create trigger activities_updated_at before update on activities
for each row execute function set_updated_at();

drop trigger if exists tasks_updated_at on tasks;
create trigger tasks_updated_at before update on tasks
for each row execute function set_updated_at();

drop trigger if exists design_assets_updated_at on design_assets;
create trigger design_assets_updated_at before update on design_assets
for each row execute function set_updated_at();

drop trigger if exists ideas_updated_at on ideas;
create trigger ideas_updated_at before update on ideas
for each row execute function set_updated_at();

drop trigger if exists operation_submissions_updated_at on operation_submissions;
create trigger operation_submissions_updated_at before update on operation_submissions
for each row execute function set_updated_at();
