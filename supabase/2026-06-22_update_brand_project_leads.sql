update app_users
set name = case id
  when 'u2' then '段强建'
  when 'u3' then '彭天成'
  when 'u4' then '李小建'
  else name
end
where id in ('u2', 'u3', 'u4');

update activities
set owner = case owner
  when '李琳' then '段强建'
  when '周敏' then '彭天成'
  when '赵强' then '李小建'
  else owner
end
where owner in ('李琳', '周敏', '赵强');

update tasks
set owner = case owner
  when '李琳' then '段强建'
  when '周敏' then '彭天成'
  when '赵强' then '李小建'
  else owner
end
where owner in ('李琳', '周敏', '赵强');
