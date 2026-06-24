alter table brands
  add column if not exists owner text;

insert into brands (name, owner) values
  ('中餐', '段强建'),
  ('火锅', '彭天成'),
  ('虾锅', '李小建')
on conflict (name) do update set
  owner = excluded.owner;
