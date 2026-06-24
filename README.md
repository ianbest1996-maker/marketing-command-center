# 餐饮营销作战中心

本目录是餐饮营销作战中心 MVP，技术栈为 Next.js、React、TypeScript 和 PWA。当前版本已经预留云端同步：未配置 Supabase 时使用本地演示数据；配置 Supabase 后，人员、门店、活动、任务、设计稿、运营提报、门店预约等数据会同步到云端 PostgreSQL。

## 启动前端

```bash
npm.cmd install
npm.cmd run dev
```

浏览器打开：

```text
http://localhost:3000
```

## 已搭好的页面

- 管理首页：按登录账号展示对应工作台；老板看本月实际活动费用和延误节点，品牌负责人看本品牌本月活动统计，同时可看三品牌活动量和表现排名。
- 试用账号登录：老板、品牌负责人、运营、设计、店长用账号和试用口令进入系统，登录后默认进入不同工作视角。
- 项目提报：品牌负责人填写品牌、门店、预算、时间、目标和方案后提交老板审核；老板通过后由项目总填写节点截止日期并下派设计、运营、门店和复盘任务。
- 活动日历：按月查看已审核通过或进入执行链路的活动，支持拖动活动调整开始日期。
- 活动看板：按状态分列，支持拖拽移动状态。
- 节点监控：按活动跟踪方案、审核、设计、内容、门店、执行、数据、复盘节点，节点状态统一为已完成、进行中、延误。
- 设计审核：老板和品牌负责人审核海报、菜单、抖音商家页等设计内容；驳回后自动生成设计返工任务。
- 角色工作台：设计部跟进设计、下单物料、物料费用和收货；运营部提报短视频、直播、达人、投流节点；店长完成培训、物料拍照和日数据填报。
- 我的任务：按等待、待开始、进行中、延期、完成分组，并支持推进到进行中或完成。
- 活动详情：基本信息、方案、门店、任务、门店数据、历史复盘；手机填报入口只在店长账号显示。
- 灵感池：来源平台、预算建议、转换活动入口。
- 数据复盘：门店排名、活动前后对比、去年同期对比。
- 基础资料：老板维护人员、账号清单、品牌项目总、门店名称、门店品牌和店长归属。项目总换人后，品牌权限、项目审批和任务分发会跟随新负责人。
- 本地配置：本地到腾讯云的迁移说明。

## 当前权限规则

- 老板可查看全部项目，并处理项目提案、设计审核、节点延误等全局事项。
- 品牌项目总只查看和审批自己归属品牌的项目；归属关系在「基础资料」里维护，默认中餐归段强建，火锅归彭天成，虾锅归李小建。
- 设计、运营、店长只围绕分配给自己的任务和门店项目工作。
- 左侧导航会显示待处理数量，例如设计审核待批复、我的任务待处理、节点监控延误数量。

## Supabase 云端同步

1. 在 Supabase 新建项目。
2. 打开 SQL Editor，先执行：

```text
supabase/schema.sql
```

3. 再执行：

```text
supabase/seed.sql
```

4. 复制 `.env.local.example` 为 `.env.local`，填写：

```env
SUPABASE_URL="https://你的项目.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="你的 service_role key"
APP_LOGIN_PASSWORD="改成你自己的登录口令"
APP_SESSION_SECRET="一长串随机字符串-用于给登录会话签名"
```

5. 重启前端：

```bash
npm.cmd run dev
```

连接成功后，系统会通过 `/api/marketing-state` 把业务数据同步到 Supabase。注意：`SUPABASE_SERVICE_ROLE_KEY` 只放在本地或服务器环境变量里，不要发给外部人员。

## 登录鉴权与数据同步说明

- 所有云端接口（读取/保存数据、上传、读取文件）都要求先登录：服务端通过 `httpOnly` 的签名 Cookie 校验登录态，未登录直接返回 401。
- 登录口令在服务端用 `APP_LOGIN_PASSWORD` 校验（**生产环境务必设置，不设默认为 `123456`**），不再写死在前端代码里。`APP_SESSION_SECRET` 用于给会话签名，建议填一长串随机字符。
- 保存数据采用**增量同步**：前端只把本次改动的条目通过 `PATCH /api/marketing-state` 发给服务端，服务端按条 upsert / 删除，不再「清空全表再整体重写」。这样多人同时编辑不同活动/任务时不会互相覆盖，也没有清表造成的空窗。

## Supabase Storage 文件上传

1. 在 Supabase Storage 创建私有 bucket：

```text
marketing-files
```

2. 如果是已经建好的数据库，执行一次增量 SQL：

```text
supabase/2026-06-22_add_design_asset_files.sql
```

3. `.env.local` 中保持：

```env
SUPABASE_STORAGE_BUCKET="marketing-files"
```

当前已接入设计稿上传：设计师可一次上传多个设计稿，文件存入 Supabase Storage，审核页通过系统内部接口预览私有文件。

## 本地 PostgreSQL

如果要在本地跑 PostgreSQL，先启动 Docker Desktop，然后执行：

```bash
docker compose up -d
```

本地 PostgreSQL 目前只是后期独立后端路线的预留环境；当前试用版优先使用 Supabase。

本地连接地址：

```text
postgresql://marketing:marketing_local_password@localhost:5432/marketing_center
```

注意：Docker 初始化脚本只会在数据库卷第一次创建时执行。如果改了 SQL 后想重建数据库，需要先删除本项目的 Docker volume。

## 上云方向

当前设计保持云厂商中立：

- 数据库：标准 PostgreSQL，后期可迁 TencentDB for PostgreSQL。
- 文件：数据库只保存对象路径，后期可迁腾讯云 COS。
- 定时任务：先本地实现，后期可迁腾讯云轻量服务器 cron 或云函数 SCF。
- 短信：预留腾讯云 SMS 配置。
- 钉钉：预留机器人或企业内部应用配置。
