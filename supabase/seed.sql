-- 基础组织数据。活动、任务、设计稿等业务演示数据会由应用首次连接云端时自动同步。

insert into brands (name, owner) values
  ('中餐', '段强建'),
  ('火锅', '彭天成'),
  ('虾锅', '李小建')
on conflict (name) do update set
  owner = excluded.owner;

insert into app_users (id, name, role) values
  ('u1', '闫总', '老板'),
  ('u2', '段强建', '品牌负责人'),
  ('u3', '彭天成', '品牌负责人'),
  ('u4', '李小建', '品牌负责人'),
  ('u5', '陈设计', '设计人员'),
  ('u6', '刘运营', '内容及投放运营'),
  ('u8', '张店长', '店长'),
  ('u9', '孙店长', '店长')
on conflict (id) do update set
  name = excluded.name,
  role = excluded.role;

-- 门店不再写入演示名称。上线测试前请在系统「基础资料」里维护真实门店。
