-- Ensure each activity and project-lead-owned task belongs to the fixed brand leader.
-- 中餐: 段强建, 火锅: 彭天成, 虾锅: 李小建

update activities
set owner = case brand
  when '中餐' then '段强建'
  when '火锅' then '彭天成'
  when '虾锅' then '李小建'
  else owner
end
where brand in ('中餐', '火锅', '虾锅');

update tasks
set owner = case activities.brand
  when '中餐' then '段强建'
  when '火锅' then '彭天成'
  when '虾锅' then '李小建'
  else tasks.owner
end
from activities
where tasks.activity_id = activities.id
  and tasks.store_id is null
  and (
    tasks.type in ('规划', '数据', '复盘')
    or tasks.title like '%填写节点截止日期%'
    or tasks.title = '项目排期和任务下派确认'
  );
