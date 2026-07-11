-- 店长照片真实上传：任务汇报照片 + 每日数据照片的存储字段
-- 服务器（PostgreSQL）和 Supabase 都需要执行一次；可重复执行（幂等）。

alter table tasks add column if not exists report_files jsonb not null default '[]'::jsonb;
alter table store_reports add column if not exists files jsonb not null default '[]'::jsonb;
