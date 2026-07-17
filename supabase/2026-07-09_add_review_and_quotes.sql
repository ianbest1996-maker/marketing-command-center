-- 复盘闭环 + 物料报价上云
-- 服务器（PostgreSQL）执行一次；幂等可重复执行。

alter table activities add column if not exists review_summary text not null default '';

create table if not exists material_quotes (
  id text primary key,
  activity_id text not null references activities(id) on delete cascade,
  task_title text not null default '',
  supplier text not null default '',
  material_name text not null default '',
  deadline date,
  amount integer not null default 0,
  note text not null default '',
  status text not null default '已记录',
  created_at timestamptz not null default now()
);
