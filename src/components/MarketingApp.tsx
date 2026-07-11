"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import {
  statuses,
  users as demoUsers
} from "@/data/demo";
import type {
  Activity,
  ActivityStatus,
  Brand,
  DesignAsset,
  Idea,
  MarketingState,
  MarketingStateDelta,
  OperationSubmission,
  Role,
  Store,
  StoreContentAppointment,
  StoreReport,
  Task,
  TaskStatus,
  UploadedFile,
  User
} from "@/types";
import { computeMarketingStateDelta, isEmptyDelta } from "@/lib/marketingDelta";

// 系统「今天」：按北京时间取真实当天日期（此前为固定演示日期，会导致延误监控、
// 临期判断、日历和每日数据填报全部冻结在演示日）。页面加载时取一次。
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const STORAGE_KEY = "marketing-command-center-local-state-v4-boss-store-cleanup";
const USER_STORAGE_KEY = "marketing-command-center-current-user-v1";
const MONTHLY_MARKETING_BUDGET = 220000;
const allNavItems = ["首页", "项目提报", "活动日历", "活动看板", "节点监控", "设计审核", "我的任务", "活动详情", "灵感池", "数据复盘", "基础资料", "本地配置"] as const;
const managedBrands: Brand[] = ["中餐", "火锅", "虾锅"];
const brands: Array<"全部" | Brand> = ["全部", ...managedBrands];
const taskBuckets: TaskStatus[] = ["等待处理", "待开始", "进行中", "已延期", "已完成"];
const workViews = ["老板", "品牌负责人", "运营部", "设计部", "门店"] as const;
const DEFAULT_BRAND_LEADERS: Record<Brand, string> = {
  中餐: "段强建",
  火锅: "彭天成",
  虾锅: "李小建"
};
const brandColors: Record<Brand, string> = {
  中餐: "#b45309",
  火锅: "#be123c",
  虾锅: "#0f766e"
};
const LEGACY_BOSS_NAME = "王总";
const DEFAULT_BOSS_NAME = "闫总";
const DESIGN_OWNER_NAME = "陈设计";
const OPERATIONS_OWNER_NAME = "刘运营";
const LAUNCH_PLAN_TASK_MARKER = "填写节点截止日期";
const TRIAL_LOGIN_PASSWORD = "123456";

let users: User[] = demoUsers;
let stores: Store[] = [];
let brandLeaders: Record<Brand, string> = { ...DEFAULT_BRAND_LEADERS };
let storeReports: StoreReport[] = [];

function normalizeUsers(inputUsers: User[]) {
  return inputUsers.map((user) =>
    user.role === "老板" && user.name === LEGACY_BOSS_NAME ? { ...user, name: DEFAULT_BOSS_NAME } : user
  );
}

function getBossName(sourceUsers: User[] = users) {
  return sourceUsers.find((user) => user.role === "老板")?.name ?? DEFAULT_BOSS_NAME;
}

type NavItem = (typeof allNavItems)[number];
type WorkView = (typeof workViews)[number];

function normalizeBrandLeaders(input?: Partial<Record<Brand, string>>) {
  const next = { ...DEFAULT_BRAND_LEADERS };
  managedBrands.forEach((brand) => {
    const owner = input?.[brand]?.trim();
    if (owner) next[brand] = owner;
  });
  return next;
}

function deriveBrandLeadersFromActivities(
  allActivities: Activity[],
  fallback: Partial<Record<Brand, string>> = DEFAULT_BRAND_LEADERS
) {
  const next = normalizeBrandLeaders(fallback);
  managedBrands.forEach((brand) => {
    const brandOwners = allActivities
      .filter((activity) => activity.brand === brand && activity.owner.trim())
      .map((activity) => activity.owner);
    const ownerCounts = new Map<string, number>();
    brandOwners.forEach((owner) => ownerCounts.set(owner, (ownerCounts.get(owner) ?? 0) + 1));
    const mostUsedOwner = [...ownerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (mostUsedOwner) next[brand] = mostUsedOwner;
  });
  return next;
}

function getActivityOwner(activity: Pick<Activity, "brand" | "owner">, leaders = brandLeaders) {
  return leaders[activity.brand] ?? activity.owner;
}

function normalizeActivitiesByBrand(allActivities: Activity[], leaders = brandLeaders) {
  return allActivities.map((activity) => ({
    ...activity,
    owner: getActivityOwner(activity, leaders)
  }));
}

function isProjectLeadOwnedTask(task: Task) {
  return (
    !task.storeId &&
    (task.type === "规划" ||
      task.type === "数据" ||
      task.type === "复盘" ||
      task.title.includes(LAUNCH_PLAN_TASK_MARKER) ||
      task.title === "项目排期和任务下派确认")
  );
}

function normalizeProjectLeadTaskOwners(allTasks: Task[], allActivities: Activity[], leaders = brandLeaders) {
  const activityById = new Map(allActivities.map((activity) => [activity.id, activity]));

  return allTasks.map((task) => {
    const activity = activityById.get(task.activityId);
    if (!activity) return task;

    if (!isProjectLeadOwnedTask(task)) return task;

    const owner = getActivityOwner(activity, leaders);
    return task.owner === owner ? task : { ...task, owner };
  });
}
type NodeState = "未开始" | "已完成" | "进行中" | "延误";
type MaterialProductionStatus = "未开始" | "已下单" | "制作中" | "物料到货";

const materialProductionSteps: MaterialProductionStatus[] = ["未开始", "已下单", "制作中", "物料到货"];

interface LaunchPlanInput {
  activityId: string;
  kickoffDueDate: string;
  designDueDate: string;
  materialDueDate: string;
  contentDueDate: string;
  storeDueDate: string;
  dataDueDate: string;
  reviewDueDate: string;
  designTaskTitle: string;
  contentTaskTitle: string;
  designPurpose: string;
  designQuantity: string;
  designSizes: string;
  customMaterialRequirement: string;
  shortVideoCount: string;
  influencerRequirement: string;
  influencerPlatform: string;
  influencerBudget: string;
  liveSessionCount: string;
  kickoffTaskNote: string;
  designTaskNote: string;
  materialTaskNote: string;
  operationTaskNote: string;
  storeTaskNote: string;
  dataTaskNote: string;
  reviewTaskNote: string;
}

interface DesignUploadInput {
  activityId: string;
  title: string;
  type: DesignAsset["type"];
  purpose: string;
  fileNames: string[];
  files: UploadedFile[];
}

type IdeaInput = Omit<Idea, "id" | "status">;

type StoreAppointmentInput = Omit<StoreContentAppointment, "id" | "status" | "createdAt">;

type OperationSubmissionInput = Omit<OperationSubmission, "id" | "status" | "submittedAt">;

interface MaterialQuote {
  id: string;
  activityId: string;
  taskTitle: string;
  supplier: string;
  materialName: string;
  deadline: string;
  amount: number;
  note: string;
  status: "已记录";
}

interface MonitorNode {
  label: string;
  owner: string;
  dueDate: string;
  state: NodeState;
  reminder: string;
  detail?: string;
}

interface ReviewAnnotation {
  id: number;
  filePath: string;
  number: number;
  x: number;
  y: number;
  text: string;
}

interface CostItem {
  category: "物料费用" | "探店达人" | "广告投流" | "其他费用";
  owner: string;
  amount: number;
  status: "待确认" | "已确认";
  note: string;
}

function yuan(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0
  }).format(value);
}

function formatFileSize(bytes: number) {
  if (!bytes) return "未知大小";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function isImageFile(file: UploadedFile) {
  return file.mimeType.startsWith("image/");
}

// 提交反馈：任何地方调用即可弹出「✓ 已提交」动画提示。
function notifySubmitted(message = "已提交") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("app:submitted", { detail: message }));
  }
}

// 标记物料到货前，先弹窗让操作人填写门店来领取的日期并通知店长。
function requestMaterialArrival(taskId: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("app:material-arrival", { detail: taskId }));
  }
}

// 运营「去预约门店」：直接弹出预约门店弹窗（可带上要预约的活动 id）。
function requestStoreAppointment(activityId: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("app:store-appointment", { detail: activityId }));
  }
}

// 运营被驳回提案「修改重提」：弹出编辑弹窗，就地改写后重新提交。
function requestOperationResubmit(submissionId: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("app:operation-resubmit", { detail: submissionId }));
  }
}

function SubmitToast() {
  const [items, setItems] = useState<{ id: number; message: string }[]>([]);

  useEffect(() => {
    function onSubmitted(event: Event) {
      const message = (event as CustomEvent<string>).detail || "已提交";
      const id = Date.now() + Math.random();
      setItems((current) => [...current, { id, message }]);
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== id));
      }, 2200);
    }
    window.addEventListener("app:submitted", onSubmitted);
    return () => window.removeEventListener("app:submitted", onSubmitted);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="submit-toast-stack" aria-live="polite">
      {items.map((item) => (
        <div className="submit-toast" key={item.id}>
          <span className="submit-toast-check" aria-hidden>✓</span>
          {item.message}
        </div>
      ))}
    </div>
  );
}

function MaterialArrivalDialog({
  taskId,
  activities,
  stores,
  tasks,
  onClose,
  onConfirm
}: {
  taskId: string;
  activities: Activity[];
  stores: Store[];
  tasks: Task[];
  onClose: () => void;
  onConfirm: (pickupDate: string) => void;
}) {
  const materialTask = tasks.find((task) => task.id === taskId);
  const activity = materialTask ? activities.find((item) => item.id === materialTask.activityId) : undefined;
  const targetStores = activity
    ? (activity.storeIds.map((id) => stores.find((store) => store.id === id)).filter(Boolean) as Store[])
    : [];
  const [pickupDate, setPickupDate] = useState(() => addDays(TODAY, 1));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>通知门店领取物料</h3>
          <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <p className="modal-sub">
          {activity?.name ?? "活动"} · 物料已到货。确认后会通知下列门店店长，请他们在指定日期前来领取物料。
        </p>
        <label className="modal-field">
          <span>请门店来领取的日期</span>
          <input
            type="date"
            value={pickupDate}
            min={TODAY}
            onChange={(event) => setPickupDate(event.target.value)}
          />
        </label>
        <div className="modal-store-list">
          <strong>将通知 {targetStores.length} 家门店</strong>
          {targetStores.length > 0 ? (
            targetStores.map((store) => (
              <span key={store.id}>
                {store.name} · 店长 {store.manager}
              </span>
            ))
          ) : (
            <span>该活动暂未关联门店</span>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="button" disabled={!pickupDate} onClick={() => onConfirm(pickupDate)}>
            确认并通知门店
          </button>
        </div>
      </div>
    </div>
  );
}

function activityStatusText(status: ActivityStatus) {
  const labels: Partial<Record<ActivityStatus, string>> = {
    灵感池: "灵感待确认",
    方案准备: "项目提报准备中",
    待老板审核: "待老板审核",
    驳回修改: "老板驳回，待修改",
    已通过待启动: "老板已通过，待项目总拆解",
    设计和物料: "设计/物料执行中",
    平台和内容准备: "运营内容准备中",
    门店执行准备: "门店执行准备中",
    活动进行中: "活动进行中",
    数据收集中: "门店数据回收中",
    待复盘: "待复盘归档",
    已完成: "已完成",
    已取消: "已取消"
  };

  return labels[status] ?? status;
}

function needsBossReview(status: ActivityStatus) {
  return status === "待老板审核";
}

function waitingForApproval(status: ActivityStatus) {
  return status === "待老板审核";
}

function isBossReviewTask(task: Task) {
  return (
    task.type === "审核" &&
    (task.title.includes("老板审核") ||
      task.owner === getBossName() ||
      task.owner === DEFAULT_BOSS_NAME ||
      task.owner === LEGACY_BOSS_NAME)
  );
}

function normalizeBossReviewTaskOwners(allTasks: Task[], sourceUsers: User[] = users) {
  const bossName = getBossName(sourceUsers);
  let changed = false;
  const nextTasks = allTasks.map((task) => {
    if (!isBossReviewTask(task) || task.owner === bossName) return task;
    changed = true;
    return { ...task, owner: bossName };
  });
  return changed ? nextTasks : allTasks;
}

function hasLaunchPlanRequest(allTasks: Task[], activityId: string) {
  return allTasks.some((task) => task.activityId === activityId && task.title.includes(LAUNCH_PLAN_TASK_MARKER));
}

function nextTaskId(allTasks: Task[], offset = 1) {
  const maxId = allTasks.reduce((max, task) => {
    const idNumber = Number(task.id.replace(/^t/, ""));
    return Number.isFinite(idNumber) ? Math.max(max, idNumber) : max;
  }, 0);

  return `t${maxId + offset}`;
}

function createLaunchPlanRequestTask(activity: Activity, allTasks: Task[]): Task {
  return {
    id: nextTaskId(allTasks),
    activityId: activity.id,
    title: `审核通过：${LAUNCH_PLAN_TASK_MARKER}并分发任务`,
    type: "规划",
    owner: getActivityOwner(activity),
    dueDate: addDays(TODAY, 1),
    status: "等待处理",
    standard: "老板已通过项目提案。请品牌项目总拆解活动任务，填写各节点截止日期和各部门配合内容后提交分发。",
    isKey: true
  };
}

function designAssetStatusText(status: DesignAsset["status"]) {
  if (status === "待老板审核") return "待项目总审核";
  if (status === "驳回修改") return "驳回修改";
  return status;
}

function isActivityDesignApproved(activityId: string, designAssets: DesignAsset[]) {
  const activityAssets = designAssets.filter((asset) => asset.activityId === activityId);
  return activityAssets.length > 0 && activityAssets.every((asset) => asset.status === "已通过");
}

function getLatestDesignAsset(activityId: string, designAssets: DesignAsset[]) {
  return designAssets
    .filter((asset) => asset.activityId === activityId)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.version - a.version)[0];
}

function getMaterialProductionStatus(task: Task, materialTaskStatuses: Record<string, MaterialProductionStatus>) {
  if (materialTaskStatuses[task.id]) return materialTaskStatuses[task.id];
  return task.status === "已完成" ? "物料到货" : "未开始";
}

function getNextMaterialProductionStatus(status: MaterialProductionStatus) {
  const index = materialProductionSteps.indexOf(status);
  return materialProductionSteps[Math.min(index + 1, materialProductionSteps.length - 1)];
}

function isOperationFinalReview(status: OperationSubmission["status"]) {
  return status === "执行完成待项目总复核";
}

function isOperationComplete(status: OperationSubmission["status"]) {
  return status === "执行复核通过";
}

function isOperationActive(status: OperationSubmission["status"]) {
  return status !== "执行复核通过" && status !== "驳回修改" && status !== "草稿";
}

function needsStoreAppointment(type: OperationSubmission["type"]) {
  return type === "短视频计划" || type === "直播计划";
}

function getOperationAppointmentType(type: OperationSubmission["type"]): StoreContentAppointment["type"] | undefined {
  if (type === "短视频计划") return "短视频拍摄";
  if (type === "直播计划") return "直播配合";
  return undefined;
}

function hasConfirmedOperationAppointment(
  submission: OperationSubmission,
  appointments: StoreContentAppointment[]
) {
  const appointmentType = getOperationAppointmentType(submission.type);
  if (!appointmentType) return true;
  return appointments.some(
    (appointment) =>
      appointment.activityId === submission.activityId &&
      appointment.type === appointmentType &&
      appointment.status === "已确认"
  );
}

function daysBetween(from: string, to: string) {
  const start = new Date(`${from}T00:00:00+08:00`).getTime();
  const end = new Date(`${to}T00:00:00+08:00`).getTime();
  return Math.round((end - start) / 86400000);
}

function addDays(date: string, days: number) {
  const base = new Date(`${date}T00:00:00+08:00`);
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

// 时区安全的纯日期工具（按 UTC 计算，避免本地时区导致的偏移），用于日历排布。
function dateToUtcMs(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

function utcMsToDate(ms: number) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// 周一为一周起点，返回 0(周一)..6(周日)
function mondayIndex(dateStr: string) {
  return (new Date(dateToUtcMs(dateStr)).getUTCDay() + 6) % 7;
}

function shiftDate(dateStr: string, days: number) {
  return utcMsToDate(dateToUtcMs(dateStr) + days * 86400000);
}

function escapeIcsText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function parseAppointmentSlot(slot: string) {
  const match = slot.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
  if (!match) {
    // 候选时间解析失败时，兜底用明天 10:00-11:00。
    const fallback = addDays(TODAY, 1).replace(/-/g, "");
    return { start: `${fallback}T100000`, end: `${fallback}T110000` };
  }

  const [, month, day, startHour, startMinute, endHour, endMinute] = match;
  const year = TODAY.slice(0, 4);
  return {
    start: `${year}${month}${day}T${startHour}${startMinute}00`,
    end: `${year}${month}${day}T${endHour}${endMinute}00`
  };
}

function appointmentCalendarHref(
  appointment: StoreContentAppointment,
  activity?: Activity,
  store?: { name: string }
) {
  const slot = appointment.selectedSlot ?? appointment.candidateSlots[0] ?? "06-23 10:00-11:00";
  const { start, end } = parseAppointmentSlot(slot);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Marketing Command Center//CN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${appointment.id}@marketing-command-center.local`,
    `DTSTAMP:${TODAY.replaceAll("-", "")}T000000`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(`${appointment.type}：${appointment.title}`)}`,
    `LOCATION:${escapeIcsText(store?.name ?? "门店")}`,
    `DESCRIPTION:${escapeIcsText(`${activity?.name ?? "营销活动"}\n${appointment.detail}`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(`${appointment.title} 30 分钟后开始`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

function getActivityReportItems(activity?: Activity) {
  const text = `${activity?.name ?? ""}${activity?.goal ?? ""}${activity?.plan ?? ""}`;
  const items: Array<{ key: string; label: string }> = [];

  if (/礼盒|伴手礼|粽子/.test(text)) {
    items.push({ key: "giftBox", label: "礼盒/伴手礼" });
  }
  if (/生日卡|生日/.test(text)) {
    items.push({ key: "birthdayCard", label: "生日卡" });
  }
  if (/团购|套餐|券|双人餐|家宴/.test(text)) {
    items.push({ key: "package", label: "团购/套餐" });
  }
  if (items.length === 0) {
    items.push({ key: "activityProduct", label: "活动商品" });
  }

  return items;
}

function getActivityCostItems(
  activity: Activity,
  operationSubmissions: OperationSubmission[],
  approved: boolean
): CostItem[] {
  const adSubmission = operationSubmissions.find(
    (submission) => submission.activityId === activity.id && submission.type === "投流计划"
  );
  const baseTotal = activity.actualCost;
  const adAmount = adSubmission?.budget ?? 0;
  const materialAmount = 0;
  const influencerAmount = 0;
  const otherAmount = Math.max(0, baseTotal - adAmount - materialAmount - influencerAmount);
  const status = approved ? "已确认" : "待确认";

  return [
    {
      category: "物料费用",
      owner: DESIGN_OWNER_NAME,
      amount: materialAmount,
      status,
      note: "海报、菜单、台卡、门店物料制作和配送费用。"
    },
    {
      category: "探店达人",
      owner: OPERATIONS_OWNER_NAME,
      amount: influencerAmount,
      status,
      note: "达人探店、图文或短视频合作费用。"
    },
    {
      category: "广告投流",
      owner: OPERATIONS_OWNER_NAME,
      amount: adAmount,
      status:
        approved ||
        adSubmission?.status === "审核通过可执行" ||
        (adSubmission ? isOperationFinalReview(adSubmission.status) || isOperationComplete(adSubmission.status) : false)
          ? "已确认"
          : "待确认",
      note: adSubmission
        ? `${adSubmission.title} · ${adSubmission.status}`
        : "抖音本地生活投流预算和消耗。"
    },
    {
      category: "其他费用",
      owner: getActivityOwner(activity),
      amount: otherAmount,
      status,
      note: "临时采购、场地布置、赠品和不可归类费用。"
    }
  ];
}

function monthDays(year: number, month: number) {
  const first = new Date(year, month - 1, 1);
  const startOffset = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const total = new Date(year, month, 0).getDate();
  const days: Array<{ date: string; day: number | null }> = [];
  for (let i = 0; i < startOffset; i += 1) days.push({ date: "", day: null });
  for (let day = 1; day <= total; day += 1) {
    days.push({ date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, day });
  }
  while (days.length % 7 !== 0) days.push({ date: "", day: null });
  return days;
}

function usePwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    } else {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => registrations.forEach((registration) => registration.unregister()))
        .catch(() => undefined);
    }
  }, []);
}

function readSavedState() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as {
      brandLeaders?: Record<Brand, string>;
      users?: User[];
      stores?: Store[];
      activities?: Activity[];
      tasks?: Task[];
      designAssets?: DesignAsset[];
      ideas?: Idea[];
      storeAppointments?: StoreContentAppointment[];
      operationSubmissions?: OperationSubmission[];
      storeReports?: StoreReport[];
      costConfirmedActivityIds?: string[];
      materialTaskStatuses?: Record<string, MaterialProductionStatus>;
    };
  } catch {
    return null;
  }
}

function readSavedUserId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(USER_STORAGE_KEY);
}

function getUserWorkView(user: User): WorkView {
  if (user.role === "老板") return "老板";
  if (user.role === "品牌负责人") return "品牌负责人";
  if (user.role === "设计人员") return "设计部";
  if (user.role === "内容及投放运营") return "运营部";
  return "门店";
}

function getUserDefaultBrand(user: User): "全部" | Brand {
  const ownedBrand = (Object.entries(brandLeaders) as Array<[Brand, string]>).find(([, leader]) => leader === user.name)?.[0];
  if (ownedBrand) return ownedBrand;

  const managedStore = stores.find((store) => store.manager === user.name);
  return managedStore?.brand ?? "全部";
}

function canManageActivity(user: User, activity: Activity) {
  if (user.role === "老板") return true;
  return user.role === "品牌负责人" && getActivityOwner(activity) === user.name;
}

function canViewActivity(
  user: User,
  activity: Activity,
  allTasks: Task[] = [],
  allDesignAssets: DesignAsset[] = [],
  allOperationSubmissions: OperationSubmission[] = [],
  allStoreAppointments: StoreContentAppointment[] = []
) {
  if (canManageActivity(user, activity)) return true;

  const managedStore = stores.find((store) => store.manager === user.name);
  if (managedStore && activity.storeIds.includes(managedStore.id)) return true;

  return (
    allTasks.some((task) => task.activityId === activity.id && task.owner === user.name) ||
    allDesignAssets.some((asset) => activity.id === asset.activityId && asset.designer === user.name) ||
    allOperationSubmissions.some((submission) => submission.activityId === activity.id && submission.owner === user.name) ||
    allStoreAppointments.some((appointment) => appointment.activityId === activity.id && appointment.requestedBy === user.name)
  );
}

function getVisibleNavItems(user: User): NavItem[] {
  if (user.role === "老板") {
    return ["首页", "活动日历", "活动看板", "节点监控", "设计审核", "我的任务", "活动详情", "数据复盘", "基础资料", "本地配置"];
  }
  if (user.role === "品牌负责人") {
    return ["首页", "项目提报", "活动日历", "活动看板", "节点监控", "设计审核", "我的任务", "活动详情", "灵感池", "数据复盘", "本地配置"];
  }
  if (user.role === "设计人员") {
    return ["首页", "设计审核", "我的任务", "活动详情", "本地配置"];
  }
  if (user.role === "内容及投放运营") {
    return ["首页", "我的任务", "活动详情", "本地配置"];
  }
  return ["首页", "我的任务", "活动详情", "本地配置"];
}

function getScopedTasksForUser(user: User, allActivities: Activity[], allTasks: Task[]) {
  if (user.role === "老板") return allTasks;
  if (user.role === "品牌负责人") {
    const brand = getUserDefaultBrand(user);
    const brandActivityIds = new Set(
      allActivities.filter((activity) => brand === "全部" || activity.brand === brand).map((activity) => activity.id)
    );
    return allTasks.filter((task) => brandActivityIds.has(task.activityId));
  }
  return allTasks.filter((task) => task.owner === user.name);
}

function createGeneratedTasks(activity: Activity, currentCount: number, plan: LaunchPlanInput): Task[] {
  const projectLead = getActivityOwner(activity);
  const baseTasks: Task[] = [
    {
      id: `t${currentCount + 1}`,
      activityId: activity.id,
      title: "项目排期和任务下派确认",
      type: "规划",
      owner: projectLead,
      dueDate: plan.kickoffDueDate,
      status: "已完成",
      standard: plan.kickoffTaskNote,
      isKey: true
    },
    {
      id: `t${currentCount + 2}`,
      activityId: activity.id,
      title: plan.designTaskTitle,
      type: "设计",
      owner: DESIGN_OWNER_NAME,
      dueDate: plan.designDueDate,
      status: "待开始",
      standard: `${plan.designTaskNote}\n用途：${plan.designPurpose}\n数量：${plan.designQuantity}\n尺寸：${plan.designSizes}\n定制物料：${plan.customMaterialRequirement || "无"}\n设计内容需先提交项目总审核，通过后才能进入物料制作。`,
      isKey: true
    },
    {
      id: `t${currentCount + 3}`,
      activityId: activity.id,
      title: "物料下单、到货确认和门店领取通知",
      type: "物料",
      owner: DESIGN_OWNER_NAME,
      dueDate: plan.materialDueDate,
      status: "待开始",
      standard: `${plan.materialTaskNote}\n设计审核通过后下单物料；物料到货后将状态改为物料到货，并通知参与门店领取物料。`,
      isKey: true
    },
    {
      id: `t${currentCount + 4}`,
      activityId: activity.id,
      title: plan.contentTaskTitle,
      type: "内容",
      owner: OPERATIONS_OWNER_NAME,
      dueDate: plan.contentDueDate,
      status: "待开始",
      standard: `${plan.operationTaskNote}\n短视频数量：${plan.shortVideoCount}\n探店达人：${plan.influencerRequirement}；平台：${plan.influencerPlatform}；预算：${plan.influencerBudget}\n直播场次：${plan.liveSessionCount}\n运营需提交短视频内容、达人报价和直播计划给项目总审核；通过后再与门店预约拍摄/直播时间。`,
      isKey: true
    },
    {
      id: `t${currentCount + 5}`,
      activityId: activity.id,
      title: "活动数据回收和门店填报跟进",
      type: "数据",
      owner: projectLead,
      dueDate: plan.dataDueDate,
      status: "待开始",
      standard: plan.dataTaskNote,
      isKey: true
    },
    {
      id: `t${currentCount + 6}`,
      activityId: activity.id,
      title: "活动数据汇总和复盘",
      type: "复盘",
      owner: projectLead,
      dueDate: plan.reviewDueDate,
      status: "待开始",
      standard: plan.reviewTaskNote,
      isKey: true
    }
  ];

  const storeTasks = activity.storeIds.flatMap((storeId, index) => {
    const store = stores.find((item) => item.id === storeId);
    const baseId = currentCount + baseTasks.length + 1 + index * 2;
    return [
      {
        id: `t${baseId}`,
        activityId: activity.id,
        title: `${store?.name ?? "门店"}领取物料、装饰门店和员工培训`,
        type: "门店执行",
        owner: store?.manager ?? projectLead,
        storeId,
        dueDate: plan.storeDueDate,
        status: "待开始" as const,
        standard: `${plan.storeTaskNote}\n门店领取物料后完成布置，拍照上传，并完成员工活动口径培训。`,
        isKey: true
      },
      {
        id: `t${baseId + 1}`,
        activityId: activity.id,
        title: `${store?.name ?? "门店"}每日活动数据填报`,
        type: "门店数据",
        owner: store?.manager ?? projectLead,
        storeId,
        dueDate: plan.dataDueDate,
        status: "待开始" as const,
        standard: "活动期间每天填报门店活动商品销量、销售额、客流、现场照片和顾客反馈，数据回传给项目总。",
        isKey: true
      }
    ];
  });

  return [...baseTasks, ...storeTasks];
}

function statusReached(activity: Activity, reachedStatuses: ActivityStatus[]) {
  return reachedStatuses.includes(activity.status);
}

function evaluateNode(
  done: boolean,
  active: boolean,
  dueDate: string,
  waiting = false
): NodeState {
  if (done) return "已完成";
  if (waiting || !active) return "未开始";
  if (dueDate < TODAY) return "延误";
  return "进行中";
}

function summarizeTaskGroup(activityTasks: Task[], keywords: string[]) {
  const matched = activityTasks.filter((task) =>
    keywords.some((keyword) => task.type.includes(keyword) || task.title.includes(keyword))
  );
  const latestDueDate = matched.reduce((latest, task) => (task.dueDate > latest ? task.dueDate : latest), "");
  return {
    matched,
    latestDueDate,
    done: matched.length > 0 && matched.every((task) => task.status === "已完成"),
    active: matched.some((task) => task.status === "进行中" || task.status === "已延期" || task.status === "等待处理")
  };
}

function getMonitorNodes(
  activity: Activity,
  allTasks: Task[],
  designAssets: DesignAsset[] = [],
  materialTaskStatuses: Record<string, MaterialProductionStatus> = {},
  operationSubmissions: OperationSubmission[] = []
): MonitorNode[] {
  const activityTasks = allTasks.filter((task) => task.activityId === activity.id);
  const designTasks = summarizeTaskGroup(activityTasks, ["设计"]);
  const materialTasks = summarizeTaskGroup(activityTasks, ["物料"]);
  const materialTaskList = materialTasks.matched;
  const designApproved = isActivityDesignApproved(activity.id, designAssets);
  const latestDesignAsset = getLatestDesignAsset(activity.id, designAssets);
  const designReviewing = latestDesignAsset?.status === "待老板审核";
  const designRejected = latestDesignAsset?.status === "驳回修改";
  const materialDone =
    materialTaskList.length === 0
      ? designApproved
      : materialTaskList.every((task) => getMaterialProductionStatus(task, materialTaskStatuses) === "物料到货");
  const materialStatusSummary =
    materialTaskList.length > 0
      ? materialTaskList
          .map((task) => getMaterialProductionStatus(task, materialTaskStatuses))
          .sort((a, b) => materialProductionSteps.indexOf(a) - materialProductionSteps.indexOf(b))[0]
      : "未开始";
  const contentTasks = summarizeTaskGroup(activityTasks, ["内容", "投流", "达人"]);
  const afterApproval: ActivityStatus[] = [
    "已通过待启动",
    "设计和物料",
    "平台和内容准备",
    "门店执行准备",
    "活动进行中",
    "数据收集中",
    "待复盘",
    "已完成"
  ];
  const afterActive: ActivityStatus[] = ["数据收集中", "待复盘", "已完成"];
  const activityOperationSubmissions = operationSubmissions.filter((submission) => submission.activityId === activity.id);
  const operationDone =
    activityOperationSubmissions.length > 0
      ? activityOperationSubmissions.every((submission) => isOperationComplete(submission.status))
      : contentTasks.done;
  const operationNodeDone =
    activityOperationSubmissions.length > 0
      ? operationDone
      : contentTasks.done || statusReached(activity, ["门店执行准备", "活动进行中", ...afterActive]);
  const operationActive =
    activityOperationSubmissions.some((submission) => isOperationActive(submission.status)) || contentTasks.active;
  const operationReminder =
    activityOperationSubmissions.length > 0
      ? activityOperationSubmissions.some((submission) => isOperationFinalReview(submission.status))
        ? "运营执行已提交，等待项目总复核"
        : activityOperationSubmissions.some((submission) => submission.status === "审核通过可执行")
          ? "运营方案已通过，等待预约门店或执行回传"
          : "等待运营提报或项目总审核"
      : "钉钉提醒运营";
  const operationDetail =
    activityOperationSubmissions.length === 0
      ? undefined
      : operationDone
        ? "运营：已完成"
        : activityOperationSubmissions.some((submission) => isOperationFinalReview(submission.status))
          ? "运营：待项目总复核"
          : activityOperationSubmissions.some((submission) => submission.status === "审核通过可执行")
            ? "运营：已通过待执行"
            : activityOperationSubmissions.some((submission) => submission.status === "待项目总审核")
              ? "运营：待项目总审核"
              : "运营：进行中";
  const storeTasks = summarizeTaskGroup(activityTasks, ["门店执行", "门店", "照片"]);
  const dataTasks = summarizeTaskGroup(activityTasks, ["数据"]);
  const reviewTasks = summarizeTaskGroup(activityTasks, ["复盘"]);
  const proposalNode: MonitorNode = {
    label: "方案确认",
    owner: getActivityOwner(activity),
    dueDate: activity.prepStartDate,
    state: evaluateNode(
      statusReached(activity, ["待老板审核", ...afterApproval]),
      activity.status === "方案准备" || activity.status === "驳回修改",
      activity.prepStartDate
    ),
    reminder: "钉钉提醒负责人"
  };
  const bossReviewNode: MonitorNode = {
    label: "老板审核",
    owner: getBossName(),
    dueDate: addDays(activity.prepStartDate, 3),
    state: evaluateNode(
      statusReached(activity, afterApproval),
      needsBossReview(activity.status),
      addDays(activity.prepStartDate, 3),
      activity.status === "方案准备"
    ),
    reminder: "重要审核可短信"
  };
  const launchPlanTask = activityTasks.find((task) => task.title.includes(LAUNCH_PLAN_TASK_MARKER));
  const hasDistributedLaunchTasks = activityTasks.some((task) => task.title === "项目排期和任务下派确认");

  if (!hasDistributedLaunchTasks) {
    return [
      proposalNode,
      bossReviewNode,
      {
        label: "节点排期和任务分发",
        owner: getActivityOwner(activity),
        dueDate: launchPlanTask?.dueDate ?? addDays(TODAY, 1),
        state: evaluateNode(
          launchPlanTask?.status === "已完成",
          Boolean(launchPlanTask) && launchPlanTask?.status !== "已完成",
          launchPlanTask?.dueDate ?? addDays(TODAY, 1),
          !statusReached(activity, afterApproval)
        ),
        reminder: statusReached(activity, afterApproval)
          ? "等待项目总填写节点截止日期并分发任务"
          : "老板通过后自动生成排期任务"
      }
    ];
  }

  return [
    proposalNode,
    bossReviewNode,
    {
      label: "设计稿审批",
      owner: designTasks.matched[0]?.owner ?? DESIGN_OWNER_NAME,
      dueDate: designTasks.latestDueDate || addDays(activity.startDate, -14),
      state: evaluateNode(
        designApproved,
        designReviewing || designRejected || designTasks.active || activity.status === "设计和物料",
        designTasks.latestDueDate || addDays(activity.startDate, -14),
        waitingForApproval(activity.status) || activity.status === "已通过待启动"
      ),
      reminder: designApproved
        ? "设计稿已通过"
        : designReviewing
          ? "设计稿审核中"
          : designRejected
            ? "设计稿驳回修改，等待重新提交"
            : "等待设计师提交设计稿"
    },
    {
      label: "物料制作",
      owner: materialTasks.matched[0]?.owner ?? DESIGN_OWNER_NAME,
      dueDate: materialTasks.latestDueDate || addDays(activity.startDate, -8),
      state: evaluateNode(
        materialDone,
        designApproved && (materialTasks.active || materialStatusSummary !== "未开始" || activity.status === "设计和物料"),
        materialTasks.latestDueDate || addDays(activity.startDate, -8),
        !designApproved
      ),
      reminder: designApproved ? `当前物料状态：${materialStatusSummary}` : "设计稿通过后才能进入物料制作",
      detail: designApproved ? `物料：${materialStatusSummary}` : undefined
    },
    {
      label: "平台内容",
      owner: contentTasks.matched[0]?.owner ?? OPERATIONS_OWNER_NAME,
      dueDate: contentTasks.latestDueDate || addDays(activity.startDate, -5),
      state: evaluateNode(
        operationNodeDone,
        operationActive || activity.status === "平台和内容准备",
        contentTasks.latestDueDate || addDays(activity.startDate, -5),
        // 运营在派单后（设计/物料阶段）即可开始；只要尚无任何运营进展才算未开始。
        !operationActive && (activity.status === "已通过待启动" || activity.status === "设计和物料")
      ),
      reminder: operationReminder,
      detail: operationDetail
    },
    {
      label: "门店准备",
      owner: storeTasks.matched[0]?.owner ?? "各店长",
      dueDate: storeTasks.latestDueDate || addDays(activity.startDate, -3),
      state: evaluateNode(
        storeTasks.done || statusReached(activity, ["活动进行中", ...afterActive]),
        storeTasks.active || activity.status === "门店执行准备",
        storeTasks.latestDueDate || addDays(activity.startDate, -3),
        // 物料到货后门店即可开始领料/布置；门店任务已活跃就不再算未开始。
        !storeTasks.active && activity.status === "平台和内容准备"
      ),
      reminder: "逾期提醒店长和品牌负责人"
    },
    {
      label: "活动执行",
      owner: getActivityOwner(activity),
      dueDate: activity.endDate,
      state: evaluateNode(
        statusReached(activity, afterActive),
        activity.status === "活动进行中" || (activity.startDate <= TODAY && activity.endDate >= TODAY),
        activity.endDate,
        activity.status === "门店执行准备"
      ),
      reminder: "每日看板巡检"
    },
    {
      label: "数据回收",
      owner: dataTasks.matched[0]?.owner ?? getActivityOwner(activity),
      dueDate: dataTasks.latestDueDate || addDays(activity.endDate, 2),
      state: evaluateNode(
        dataTasks.done || activity.status === "待复盘" || activity.status === "已完成",
        dataTasks.active || activity.status === "数据收集中",
        dataTasks.latestDueDate || addDays(activity.endDate, 2),
        // 活动期间门店每天填数据，数据任务已活跃就不再算未开始。
        !dataTasks.active && activity.status === "活动进行中"
      ),
      reminder: "未提交门店钉钉提醒"
    },
    {
      label: "复盘归档",
      owner: reviewTasks.matched[0]?.owner ?? getActivityOwner(activity),
      dueDate: reviewTasks.latestDueDate || addDays(activity.endDate, 7),
      state: evaluateNode(
        activity.status === "已完成" || reviewTasks.done,
        reviewTasks.active || activity.status === "待复盘",
        reviewTasks.latestDueDate || addDays(activity.endDate, 7),
        !reviewTasks.active && activity.status === "数据收集中"
      ),
      reminder: "沉淀到下一年度"
    }
  ];
}

function getActivityHealth(nodes: MonitorNode[]) {
  const delayed = nodes.filter((node) => node.state === "延误").length;
  const active = nodes.filter((node) => node.state === "进行中").length;
  const done = nodes.filter((node) => node.state === "已完成").length;
  const completion = Math.round((done / nodes.length) * 100);

  if (delayed > 0) return { label: "延误", className: "danger", completion };
  if (active > 0) return { label: "推进中", className: "active", completion };
  return { label: "已完成", className: "ok", completion };
}

function getNextTaskStatus(status: TaskStatus): TaskStatus {
  if (status === "已完成") return "已完成";
  if (status === "进行中") return "已完成";
  return "进行中";
}

function getAdvanceLabel(status: TaskStatus) {
  if (status === "已完成") return "已完成";
  if (status === "进行中") return "完成";
  if (status === "已延期") return "重新推进";
  return "推进";
}

function getLoginAccount(user: User) {
  const fixedAccounts: Record<string, string> = {
    u1: "boss",
    u2: "zhongcan",
    u3: "huoguo",
    u4: "xiaguo",
    u5: "design",
    u6: "operation",
    u8: "store1",
    u9: "store2"
  };

  return fixedAccounts[user.id] ?? user.id;
}

function findLoginUser(account: string, availableUsers: User[]) {
  const normalized = account.trim().toLowerCase();
  if (!normalized) return null;

  return (
    availableUsers.find((user) =>
      [user.id, user.name, getLoginAccount(user)].some((value) => value.toLowerCase() === normalized)
    ) ?? null
  );
}

function createUserId(existingUsers: User[]) {
  let index = existingUsers.length + 1;
  let id = `u${index}`;
  while (existingUsers.some((user) => user.id === id)) {
    index += 1;
    id = `u${index}`;
  }
  return id;
}

function createStoreId(existingStores: Store[]) {
  let index = existingStores.length + 1;
  let id = `s${index}`;
  while (existingStores.some((store) => store.id === id)) {
    index += 1;
    id = `s${index}`;
  }
  return id;
}

async function uploadMarketingFile(file: File, activityId: string, area: string): Promise<UploadedFile> {
  const maxFileSizeMb = 50;
  const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;

  if (file.size > maxFileSizeBytes) {
    throw new Error(`${file.name} 超过 ${maxFileSizeMb}MB，请压缩后再上传。`);
  }

  // 第一步：向服务端要一个「直传地址」（小请求，远在 Vercel 4.5MB 上限之下）。
  const signResponse = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, activityId, area })
  });

  if (!signResponse.ok) {
    const payload = (await signResponse.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `文件上传失败，状态码 ${signResponse.status}`);
  }

  const { uploadUrl, path, fileUrl } = (await signResponse.json()) as {
    uploadUrl: string;
    path: string;
    fileUrl: string;
  };

  // 第二步：把文件字节直接 PUT 到 Supabase Storage，不经过 Vercel 函数。
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file
  });

  if (!uploadResponse.ok) {
    const detail = await uploadResponse.text().catch(() => "");
    throw new Error(`云端文件存储失败：${detail || `状态码 ${uploadResponse.status}`}`);
  }

  return {
    name: file.name,
    path,
    url: fileUrl,
    mimeType: file.type || "application/octet-stream",
    size: file.size
  };
}

function hasCloudState(state: MarketingState) {
  return (
    state.users.length > 0 ||
    state.stores.length > 0 ||
    Boolean(state.brandLeaders && Object.keys(state.brandLeaders).length > 0) ||
    state.activities.length > 0 ||
    state.tasks.length > 0 ||
    state.designAssets.length > 0 ||
    state.ideas.length > 0 ||
    state.storeAppointments.length > 0 ||
    state.operationSubmissions.length > 0
  );
}

function buildInitialMarketingState(): MarketingState {
  const initialBrandLeaders = normalizeBrandLeaders(DEFAULT_BRAND_LEADERS);
  return {
    brandLeaders: initialBrandLeaders,
    users: normalizeUsers(demoUsers),
    stores: [],
    activities: [],
    tasks: [],
    designAssets: [],
    ideas: [],
    storeAppointments: [],
    operationSubmissions: [],
    storeReports: [],
    costConfirmedActivityIds: [],
    materialTaskStatuses: {}
  };
}

export function MarketingApp() {
  usePwaRegistration();

  const [currentUserId, setCurrentUserId] = useState<string | null>(() => readSavedUserId());
  const [activeNav, setActiveNav] = useState<NavItem>("首页");
  const [organizationUsers, setOrganizationUsers] = useState<User[]>(() => normalizeUsers(readSavedState()?.users ?? demoUsers));
  const [organizationStores, setOrganizationStores] = useState<Store[]>(() => readSavedState()?.stores ?? []);
  const [brandLeaderConfig, setBrandLeaderConfig] = useState<Record<Brand, string>>(() => {
    const savedState = readSavedState();
    const next = normalizeBrandLeaders(
      savedState?.brandLeaders ?? deriveBrandLeadersFromActivities(savedState?.activities ?? [])
    );
    brandLeaders = next;
    return next;
  });
  const [activities, setActivities] = useState<Activity[]>(() =>
    normalizeActivitiesByBrand(readSavedState()?.activities ?? [], brandLeaders)
  );
  const [tasks, setTasks] = useState<Task[]>(() => {
    const savedState = readSavedState();
    const normalizedActivities = normalizeActivitiesByBrand(savedState?.activities ?? [], brandLeaders);
    return normalizeBossReviewTaskOwners(
      normalizeProjectLeadTaskOwners(savedState?.tasks ?? [], normalizedActivities, brandLeaders),
      normalizeUsers(savedState?.users ?? demoUsers)
    );
  });
  const [designAssets, setDesignAssets] = useState<DesignAsset[]>(
    () => readSavedState()?.designAssets ?? []
  );
  const [localIdeas, setLocalIdeas] = useState<Idea[]>(() => readSavedState()?.ideas ?? []);
  const [storeAppointments, setStoreAppointments] = useState<StoreContentAppointment[]>(
    () => readSavedState()?.storeAppointments ?? []
  );
  const [operationSubmissions, setOperationSubmissions] = useState<OperationSubmission[]>(
    () => readSavedState()?.operationSubmissions ?? []
  );
  const [storeReportsState, setStoreReports] = useState<StoreReport[]>(
    () => readSavedState()?.storeReports ?? []
  );
  const [costConfirmedActivityIds, setCostConfirmedActivityIds] = useState<string[]>(
    () => readSavedState()?.costConfirmedActivityIds ?? []
  );
  const [materialTaskStatuses, setMaterialTaskStatuses] = useState<Record<string, MaterialProductionStatus>>(
    () => readSavedState()?.materialTaskStatuses ?? {}
  );
  const [brandFilter, setBrandFilter] = useState<"全部" | Brand>("全部");
  const [workView, setWorkView] = useState<WorkView>("老板");
  const [month, setMonth] = useState(Number(TODAY.slice(5, 7)));
  const [selectedActivityId, setSelectedActivityId] = useState("a1");
  const [draggingActivityId, setDraggingActivityId] = useState<string | null>(null);
  const [materialArrivalTaskId, setMaterialArrivalTaskId] = useState<string | null>(null);
  const [resubmitSubmissionId, setResubmitSubmissionId] = useState<string | null>(null);
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const cloudSaveReady = useRef(false);
  // 云端数据每个页面会话只拉取一次：首次登录后本地状态即为工作副本，
  // 之后持续增量同步。避免切换账号时重拉云端覆盖掉尚未同步的本地改动。
  const cloudLoaded = useRef(false);
  // 上一次成功同步到云端的快照，用来算出「这次改了哪些条目」做增量保存。
  const lastSyncedState = useRef<MarketingState | null>(null);
  // 待保存的防抖任务：定时器 + 这次要发送的增量与对应快照。
  const pendingSaveTimer = useRef<number | null>(null);
  const pendingSave = useRef<{ delta: MarketingStateDelta; state: MarketingState } | null>(null);

  users = organizationUsers;
  stores = organizationStores;
  brandLeaders = brandLeaderConfig;
  storeReports = storeReportsState;

  const currentUser = organizationUsers.find((user) => user.id === currentUserId) ?? null;
  const visibleNavItems = useMemo(() => (currentUser ? getVisibleNavItems(currentUser) : []), [currentUser]);
  const canChangeBrandFilter = currentUser?.role === "老板";
  const accessibleActivities = useMemo(
    () =>
      currentUser
        ? activities.filter((activity) =>
            canViewActivity(currentUser, activity, tasks, designAssets, operationSubmissions, storeAppointments)
          )
        : [],
    [activities, currentUser, designAssets, operationSubmissions, storeAppointments, tasks]
  );
  const selectedActivity = accessibleActivities.find((item) => item.id === selectedActivityId) ?? accessibleActivities[0];
  const filteredActivities = useMemo(
    () => accessibleActivities.filter((item) => brandFilter === "全部" || item.brand === brandFilter),
    [accessibleActivities, brandFilter]
  );
  const userScopedTasks = useMemo(
    () => (currentUser ? getScopedTasksForUser(currentUser, activities, tasks) : tasks),
    [activities, currentUser, tasks]
  );
  const navBadges = useMemo(() => {
    if (!currentUser) return {} as Partial<Record<NavItem, number>>;

    const accessibleActivityIds = new Set(accessibleActivities.map((activity) => activity.id));
    const manageableActivityIds = new Set(
      accessibleActivities
        .filter((activity) => canManageActivity(currentUser, activity))
        .map((activity) => activity.id)
    );
    const bossReviewCount =
      currentUser.role === "老板"
        ? accessibleActivities.filter((activity) => needsBossReview(activity.status)).length
        : 0;
    const designReviewCount = designAssets.filter(
      (asset) =>
        manageableActivityIds.has(asset.activityId) &&
        (asset.status === "待老板审核" || asset.status === "驳回修改")
    ).length;
    const operationReviewCount = operationSubmissions.filter(
      (submission) =>
        manageableActivityIds.has(submission.activityId) &&
        (submission.status === "待项目总审核" || submission.status === "执行完成待项目总复核")
    ).length;
    const ownedTaskCount =
      currentUser.role === "老板"
        ? bossReviewCount
        : tasks.filter(
            (task) =>
              task.status !== "已完成" &&
              accessibleActivityIds.has(task.activityId) &&
              (task.owner === currentUser.name ||
                (currentUser.role === "品牌负责人" &&
                  manageableActivityIds.has(task.activityId) &&
                  task.title.includes(LAUNCH_PLAN_TASK_MARKER)))
          ).length;
    const delayedCount = tasks.filter(
      (task) => accessibleActivityIds.has(task.activityId) && task.status === "已延期"
    ).length;

    return {
      我的任务: ownedTaskCount + (currentUser.role === "品牌负责人" ? operationReviewCount + designReviewCount : 0),
      设计审核: designReviewCount,
      节点监控: delayedCount,
      活动看板: bossReviewCount
    } satisfies Partial<Record<NavItem, number>>;
  }, [accessibleActivities, activities, currentUser, designAssets, operationSubmissions, tasks]);

  useEffect(() => {
    if (!currentUserId || cloudLoaded.current) return;
    let cancelled = false;

    fetch("/api/marketing-state")
      .then(async (response) => {
        if (response.status === 401) {
          // 会话已过期，回到登录页重新登录。
          if (!cancelled) setCurrentUserId(null);
          return;
        }
        if (!response.ok) return;
        const payload = (await response.json()) as { state?: MarketingState };
        if (!payload.state || cancelled) return;

        const hasExistingCloudState = hasCloudState(payload.state);
        const nextState = hasExistingCloudState
          ? {
              brandLeaders:
                payload.state.brandLeaders ??
                deriveBrandLeadersFromActivities(payload.state.activities ?? []),
              users: normalizeUsers(payload.state.users?.length > 0 ? payload.state.users : demoUsers),
              stores: payload.state.stores ?? [],
              activities: payload.state.activities ?? [],
              tasks: payload.state.tasks ?? [],
              designAssets: payload.state.designAssets ?? [],
              ideas: payload.state.ideas ?? [],
              storeAppointments:
                payload.state.storeAppointments ?? [],
              operationSubmissions:
                payload.state.operationSubmissions ?? [],
              storeReports: payload.state.storeReports ?? [],
              costConfirmedActivityIds: payload.state.costConfirmedActivityIds ?? [],
              materialTaskStatuses: payload.state.materialTaskStatuses ?? {}
            }
          : {
              ...buildInitialMarketingState(),
              brandLeaders:
                payload.state.brandLeaders ??
                deriveBrandLeadersFromActivities(payload.state.activities ?? []),
              users: normalizeUsers(payload.state.users?.length > 0 ? payload.state.users : demoUsers),
              stores: payload.state.stores ?? []
            };

        const normalizedBrandLeaders = normalizeBrandLeaders(nextState.brandLeaders);
        brandLeaders = normalizedBrandLeaders;
        const normalizedActivities = normalizeActivitiesByBrand(nextState.activities, normalizedBrandLeaders);
        const normalizedTasks = normalizeBossReviewTaskOwners(
          normalizeProjectLeadTaskOwners(nextState.tasks, normalizedActivities, normalizedBrandLeaders),
          nextState.users
        );

        setOrganizationUsers(nextState.users);
        setOrganizationStores(nextState.stores);
        setBrandLeaderConfig(normalizedBrandLeaders);
        setActivities(normalizedActivities);
        setTasks(normalizedTasks);
        setDesignAssets(nextState.designAssets);
        setLocalIdeas(nextState.ideas);
        setStoreAppointments(nextState.storeAppointments);
        setOperationSubmissions(nextState.operationSubmissions);
        setStoreReports(nextState.storeReports);
        setCostConfirmedActivityIds(nextState.costConfirmedActivityIds);
        setMaterialTaskStatuses(nextState.materialTaskStatuses as Record<string, MaterialProductionStatus>);

        // 记录刚加载到的云端快照，后续保存据此算增量；首屏不会产生多余写入。
        lastSyncedState.current = {
          brandLeaders: normalizedBrandLeaders,
          users: nextState.users,
          stores: nextState.stores,
          activities: normalizedActivities,
          tasks: normalizedTasks,
          designAssets: nextState.designAssets,
          ideas: nextState.ideas,
          storeAppointments: nextState.storeAppointments,
          operationSubmissions: nextState.operationSubmissions,
          storeReports: nextState.storeReports,
          costConfirmedActivityIds: nextState.costConfirmedActivityIds,
          materialTaskStatuses: nextState.materialTaskStatuses
        };

        cloudLoaded.current = true;
        cloudSaveReady.current = true;
        setCloudSyncEnabled(true);

        if (!hasExistingCloudState) {
          fetch("/api/marketing-state", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...nextState,
              brandLeaders: normalizedBrandLeaders,
              activities: normalizedActivities,
              tasks: normalizedTasks
            })
          }).catch(() => undefined);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  useEffect(() => {
    const state: MarketingState = {
      brandLeaders: brandLeaderConfig,
      users: organizationUsers,
      stores: organizationStores,
      activities,
      tasks,
      designAssets,
      ideas: localIdeas,
      storeAppointments,
      operationSubmissions,
      storeReports: storeReportsState,
      costConfirmedActivityIds,
      materialTaskStatuses
    };

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state)
    );

    if (!cloudSyncEnabled || !cloudSaveReady.current || !lastSyncedState.current) return;

    const baseline = lastSyncedState.current;
    const delta = computeMarketingStateDelta(baseline, state);
    if (isEmptyDelta(delta)) return;

    // 记录待保存的增量，并重置防抖定时器；切换账号时会先 flush 再登出。
    pendingSave.current = { delta, state };
    if (pendingSaveTimer.current !== null) window.clearTimeout(pendingSaveTimer.current);
    pendingSaveTimer.current = window.setTimeout(() => {
      pendingSaveTimer.current = null;
      void flushPendingSave();
    }, 700);
  }, [
    organizationUsers,
    organizationStores,
    brandLeaderConfig,
    activities,
    tasks,
    designAssets,
    localIdeas,
    storeAppointments,
    operationSubmissions,
    storeReportsState,
    costConfirmedActivityIds,
    materialTaskStatuses
  ]);

  // 立即把待保存的增量发往云端（带当前有效登录态）。切换账号/登出前调用，
  // 避免防抖保存在 cookie 被清除后才触发、导致 401 丢失。
  async function flushPendingSave() {
    if (pendingSaveTimer.current !== null) {
      window.clearTimeout(pendingSaveTimer.current);
      pendingSaveTimer.current = null;
    }
    const pending = pendingSave.current;
    if (!pending) return;
    pendingSave.current = null;
    try {
      const response = await fetch("/api/marketing-state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending.delta)
      });
      if (response.ok) {
        lastSyncedState.current = pending.state;
      } else {
        // 失败则放回待保存，下次状态变化或下次 flush 时重试。
        pendingSave.current = pending;
      }
    } catch {
      pendingSave.current = pending;
    }
  }

  useEffect(() => {
    if (currentUserId) {
      window.localStorage.setItem(USER_STORAGE_KEY, currentUserId);
    } else {
      window.localStorage.removeItem(USER_STORAGE_KEY);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUser) return;
    setWorkView(getUserWorkView(currentUser));
    setBrandFilter(currentUser.role === "老板" ? "全部" : getUserDefaultBrand(currentUser));
  }, [brandLeaderConfig, currentUser]);

  useEffect(() => {
    setTasks((current) => normalizeBossReviewTaskOwners(current, organizationUsers));
  }, [organizationUsers]);

  useEffect(() => {
    function onMaterialArrival(event: Event) {
      const taskId = (event as CustomEvent<string>).detail;
      if (taskId) setMaterialArrivalTaskId(taskId);
    }
    window.addEventListener("app:material-arrival", onMaterialArrival);
    return () => window.removeEventListener("app:material-arrival", onMaterialArrival);
  }, []);

  useEffect(() => {
    function onResubmit(event: Event) {
      const submissionId = (event as CustomEvent<string>).detail;
      if (submissionId) setResubmitSubmissionId(submissionId);
    }
    window.addEventListener("app:operation-resubmit", onResubmit);
    return () => window.removeEventListener("app:operation-resubmit", onResubmit);
  }, []);

  useEffect(() => {
    if (accessibleActivities.length === 0) return;
    if (!accessibleActivities.some((activity) => activity.id === selectedActivityId)) {
      setSelectedActivityId(accessibleActivities[0].id);
    }
  }, [accessibleActivities, selectedActivityId]);

  function loginAs(userId: string) {
    const user = organizationUsers.find((item) => item.id === userId);
    if (!user) return;
    setCurrentUserId(user.id);
    setWorkView(getUserWorkView(user));
    setBrandFilter(getUserDefaultBrand(user));
    setActiveNav("首页");
  }

  function saveUser(nextUser: User) {
    const existingUser = organizationUsers.find((user) => user.id === nextUser.id);
    const previousName = existingUser?.name;

    setOrganizationUsers((current) => {
      if (current.some((user) => user.id === nextUser.id)) {
        return current.map((user) => (user.id === nextUser.id ? nextUser : user));
      }
      return [...current, nextUser];
    });

    if (!previousName || previousName === nextUser.name) return;

    setBrandLeaderConfig((current) => {
      const next = { ...current };
      let changed = false;
      managedBrands.forEach((brand) => {
        if (next[brand] === previousName) {
          next[brand] = nextUser.name;
          changed = true;
        }
      });
      if (changed) brandLeaders = next;
      return changed ? next : current;
    });
    setActivities((current) =>
      current.map((activity) => (activity.owner === previousName ? { ...activity, owner: nextUser.name } : activity))
    );
    setTasks((current) =>
      current.map((task) => (task.owner === previousName ? { ...task, owner: nextUser.name } : task))
    );
    setDesignAssets((current) =>
      current.map((asset) => ({
        ...asset,
        designer: asset.designer === previousName ? nextUser.name : asset.designer,
        reviewer: asset.reviewer === previousName ? nextUser.name : asset.reviewer
      }))
    );
    setOperationSubmissions((current) =>
      current.map((submission) =>
        submission.owner === previousName ? { ...submission, owner: nextUser.name } : submission
      )
    );
    setStoreAppointments((current) =>
      current.map((appointment) =>
        appointment.requestedBy === previousName ? { ...appointment, requestedBy: nextUser.name } : appointment
      )
    );
    setOrganizationStores((current) =>
      current.map((store) => (store.manager === previousName ? { ...store, manager: nextUser.name } : store))
    );
  }

  function saveStore(nextStore: Store) {
    setOrganizationStores((current) => {
      if (current.some((store) => store.id === nextStore.id)) {
        return current.map((store) => (store.id === nextStore.id ? nextStore : store));
      }
      return [...current, nextStore];
    });
  }

  function saveBrandLeader(brand: Brand, owner: string) {
    const cleanOwner = owner.trim();
    if (!cleanOwner) return;

    const nextBrandLeaders = normalizeBrandLeaders({ ...brandLeaderConfig, [brand]: cleanOwner });
    brandLeaders = nextBrandLeaders;
    const nextActivities = normalizeActivitiesByBrand(
      activities.map((activity) => (activity.brand === brand ? { ...activity, owner: cleanOwner } : activity)),
      nextBrandLeaders
    );

    setBrandLeaderConfig(nextBrandLeaders);
    setActivities(nextActivities);
    setTasks((current) => normalizeProjectLeadTaskOwners(current, nextActivities, nextBrandLeaders));
  }

  useEffect(() => {
    if (currentUser && !visibleNavItems.includes(activeNav)) {
      setActiveNav("首页");
    }
  }, [activeNav, currentUser, visibleNavItems]);

  const dashboard = useMemo(() => {
    const scopedActivityIds = new Set(filteredActivities.map((item) => item.id));
    const thisMonth = filteredActivities.filter((item) => item.startDate.startsWith(TODAY.slice(0, 7)));
    const pendingReviews = filteredActivities.filter((item) => needsBossReview(item.status));
    const overdueTasks = tasks.filter(
      (item) => scopedActivityIds.has(item.activityId) && item.status !== "已完成" && item.dueDate < TODAY
    );
    const dataRequiredStatuses: ActivityStatus[] = ["活动进行中", "数据收集中", "待复盘"];
    const unsubmittedStores = filteredActivities
      .filter((activity) => dataRequiredStatuses.includes(activity.status))
      .reduce((total, activity) => {
      const activityReports = storeReports.filter((report) => report.activityId === activity.id);
      return total + Math.max(activity.storeIds.length - activityReports.length, 0);
    }, 0);

    return {
      thisMonthCount: thisMonth.length,
      upcomingCount: filteredActivities.filter((item) => item.startDate >= TODAY && item.status !== "已完成").length,
      pendingReviewCount: pendingReviews.length,
      overdueTaskCount: overdueTasks.length,
      unsubmittedStores,
      monthlyBudget: brandFilter === "全部" ? MONTHLY_MARKETING_BUDGET : Math.round(MONTHLY_MARKETING_BUDGET / 3),
      monthlyActivityBudget: thisMonth.reduce((sum, item) => sum + item.budget, 0),
      monthlyActualCost: thisMonth.reduce((sum, item) => sum + item.actualCost, 0),
      yearlyBudget: filteredActivities.filter((item) => item.startDate.startsWith(TODAY.slice(0, 4))).reduce((sum, item) => sum + item.budget, 0),
      yearlyActual: filteredActivities.filter((item) => item.startDate.startsWith(TODAY.slice(0, 4))).reduce((sum, item) => sum + item.actualCost, 0)
    };
  }, [filteredActivities, tasks]);

  function moveActivity(activityId: string, nextStatus: ActivityStatus) {
    setActivities((current) =>
      current.map((item) => (item.id === activityId ? { ...item, status: nextStatus } : item))
    );
  }

  function moveActivityDate(activityId: string, nextStartDate: string) {
    setActivities((current) =>
      current.map((item) => {
        if (item.id !== activityId) return item;
        const duration = daysBetween(item.startDate, item.endDate);
        return {
          ...item,
          startDate: nextStartDate,
          endDate: addDays(nextStartDate, duration),
          prepStartDate: addDays(nextStartDate, item.scale === "大型活动" ? -60 : item.scale === "普通活动" ? -30 : -14)
        };
      })
    );
  }

  function completeTask(taskId: string) {
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, status: "已完成" } : task))
    );
  }

  function updateTaskStatus(taskId: string, status: TaskStatus) {
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, status } : task))
    );
  }

  // 店长提交任务汇报：说明写入任务说明、现场照片存入 reportFiles，任务标记完成。
  function submitTaskReport(taskId: string, note: string, files: UploadedFile[]) {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: "已完成" as const,
              standard: note.trim()
                ? `${task.standard}\n完成汇报：${note.trim()}`
                : `${task.standard}\n已提交完成汇报。`,
              reportFiles: [...(task.reportFiles ?? []), ...files]
            }
          : task
      )
    );
    notifySubmitted(files.length > 0 ? `汇报已提交（${files.length} 张照片）` : "汇报已提交");
  }

  function approveActivity(activityId: string) {
    const activity = activities.find((item) => item.id === activityId);
    if (!activity || currentUser?.role !== "老板") return;

    moveActivity(activityId, "已通过待启动");
    setTasks((current) => {
      const reviewedTasks = current.map((task) =>
        task.activityId === activityId && isBossReviewTask(task)
          ? { ...task, status: "已完成" as const }
          : task
      );
      if (hasLaunchPlanRequest(reviewedTasks, activityId)) return reviewedTasks;
      return [...reviewedTasks, createLaunchPlanRequestTask(activity, reviewedTasks)];
    });
    notifySubmitted("已通过，等待项目总下发节点");
  }

  function rejectActivity(activityId: string, comment: string) {
    const activity = activities.find((item) => item.id === activityId);
    if (!activity || currentUser?.role !== "老板") return;

    const cleanComment = comment.trim() || "请补充活动目标、预算依据、门店执行安排和预期数据，再重新提交审核。";
    moveActivity(activityId, "驳回修改");
    setTasks((current) =>
      current.map((task) =>
        task.activityId === activityId && isBossReviewTask(task)
          ? { ...task, status: "已完成", standard: `驳回修改意见：${cleanComment}` }
          : task
      )
    );
    notifySubmitted("已驳回，已退回修改");
  }

  function submitLaunchPlan(plan: LaunchPlanInput) {
    const activity = activities.find((item) => item.id === plan.activityId);
    if (!activity || !currentUser || !canManageActivity(currentUser, activity)) return;

    setTasks((current) => {
      const hasLaunchTasks = current.some(
        (task) => task.activityId === plan.activityId && task.title === "项目排期和任务下派确认"
      );
      const reviewedTasks = current.map((task) =>
        task.activityId === plan.activityId && isBossReviewTask(task)
          ? { ...task, status: "已完成" as const }
          : task.activityId === plan.activityId && task.title.includes(LAUNCH_PLAN_TASK_MARKER)
          ? { ...task, status: "已完成" as const, standard: "已完成节点截止日期填写和跨部门任务分发。" }
          : task
      );
      if (hasLaunchTasks) return reviewedTasks;
      return [...reviewedTasks, ...createGeneratedTasks(activity, reviewedTasks.length, plan)];
    });
    moveActivity(plan.activityId, "设计和物料");
    notifySubmitted("节点已下发，任务已分配到各部门");
  }

  function submitActivityProposal(proposal: Omit<Activity, "id" | "actualCost" | "status">) {
    const nextActivity: Activity = {
      ...proposal,
      id: `a${activities.length + 1}`,
      owner: getActivityOwner(proposal),
      actualCost: 0,
      status: "待老板审核"
    };
    setActivities((current) => [nextActivity, ...current]);
    setTasks((current) => [
      ...current,
      {
        id: nextTaskId(current),
        activityId: nextActivity.id,
        title: `老板审核：${nextActivity.name}`,
        type: "审核",
        owner: getBossName(),
        dueDate: addDays(TODAY, 1),
        status: "等待处理",
        standard: "老板通过或驳回项目提报，确认预算和活动方向。",
        isKey: true
      }
    ]);
    setSelectedActivityId(nextActivity.id);
    setActiveNav("活动详情");
    notifySubmitted("项目提报已提交，等待老板审核");
  }

  // 老板驳回的提案：品牌负责人按意见就地修改后重新提交（不再新建重复项目）。
  function resubmitActivityProposal(
    activityId: string,
    updates: Pick<Activity, "name" | "startDate" | "endDate" | "budget" | "goal" | "plan" | "storeIds">
  ) {
    const activity = activities.find((item) => item.id === activityId);
    if (!activity || !currentUser || !canManageActivity(currentUser, activity)) return;

    setActivities((current) =>
      current.map((item) =>
        item.id === activityId
          ? {
              ...item,
              ...updates,
              prepStartDate: addDays(
                updates.startDate,
                item.scale === "大型活动" ? -60 : item.scale === "普通活动" ? -30 : -14
              ),
              status: "待老板审核"
            }
          : item
      )
    );
    setTasks((current) => [
      ...current,
      {
        id: nextTaskId(current),
        activityId,
        title: `老板审核：${updates.name}`,
        type: "审核",
        owner: getBossName(),
        dueDate: addDays(TODAY, 1),
        status: "等待处理",
        standard: "品牌负责人已按驳回意见修改提案，请老板重新审核预算和活动方向。",
        isKey: true
      }
    ]);
    notifySubmitted("提案已重新提交，等待老板审核");
  }

  // 取老板对某活动最近一次的驳回意见（记录在老板审核任务的说明里）。
  function getProposalRejectComment(activityId: string) {
    const rejectTasks = tasks.filter(
      (task) => task.activityId === activityId && isBossReviewTask(task) && task.standard.includes("驳回修改意见")
    );
    const latest = rejectTasks[rejectTasks.length - 1];
    if (!latest) return "";
    const index = latest.standard.indexOf("驳回修改意见：");
    return index >= 0 ? latest.standard.slice(index + "驳回修改意见：".length) : latest.standard;
  }

  function submitIdea(input: IdeaInput) {
    const nextIdea: Idea = {
      ...input,
      id: `i${localIdeas.length + 1}`,
      status: "待评估"
    };
    setLocalIdeas((current) => [nextIdea, ...current]);
    notifySubmitted("灵感已提交");
  }

  function convertIdeaToActivity(ideaId: string) {
    const idea = localIdeas.find((item) => item.id === ideaId);
    if (!idea || idea.status === "已转活动" || !currentUser) return;

    const userBrand = getUserDefaultBrand(currentUser);
    const brand = idea.brands[0] ?? (userBrand === "全部" ? "中餐" : userBrand);
    const startDate = addDays(TODAY, 14);
    const endDate = addDays(startDate, 7);

    submitActivityProposal({
      name: idea.title,
      type: "临时营销活动",
      brand,
      storeIds: stores.filter((store) => store.brand === brand).slice(0, 3).map((store) => store.id),
      scale: "普通活动",
      owner: currentUser.name,
      startDate,
      endDate,
      prepStartDate: TODAY,
      goal: idea.suggestion,
      plan: `来源平台：${idea.platform}\n来源链接：${idea.url || "未填写"}\n初步建议：${idea.suggestion}`,
      budget: idea.budget
    });
    setLocalIdeas((current) =>
      current.map((item) => (item.id === ideaId ? { ...item, status: "已转活动" } : item))
    );
  }

  function submitStoreAppointment(input: StoreAppointmentInput) {
    const nextAppointment: StoreContentAppointment = {
      ...input,
      id: `sa${storeAppointments.length + 1}`,
      status: "待店长选择",
      createdAt: TODAY
    };
    setStoreAppointments((current) => [nextAppointment, ...current]);
    notifySubmitted("拍摄/直播需求已发给门店");
  }

  function confirmStoreAppointment(appointmentId: string, selectedSlot: string) {
    setStoreAppointments((current) =>
      current.map((appointment) =>
        appointment.id === appointmentId
          ? { ...appointment, selectedSlot, status: "已确认" }
          : appointment
      )
    );
    notifySubmitted("已确认拍摄时间");
  }

  // 店长每日数据：按 门店+活动+日期 唯一 id，重复提交则覆盖更新。
  function submitStoreReport(report: StoreReport) {
    setStoreReports((current) => {
      const exists = current.some((item) => item.id === report.id);
      return exists
        ? current.map((item) => (item.id === report.id ? report : item))
        : [report, ...current];
    });
    notifySubmitted("今日数据已提交");
  }

  function submitOperationSubmission(input: OperationSubmissionInput) {
    const nextSubmission: OperationSubmission = {
      ...input,
      id: `op${operationSubmissions.length + 1}`,
      status: "待项目总审核",
      submittedAt: TODAY
    };
    setOperationSubmissions((current) => [nextSubmission, ...current]);
    notifySubmitted("运营提报已提交，等待项目总审核");
  }

  function resubmitOperationSubmission(
    submissionId: string,
    updates: Pick<OperationSubmission, "title" | "benchmarkLinks" | "contentPlan" | "budget">
  ) {
    setOperationSubmissions((current) =>
      current.map((submission) =>
        submission.id === submissionId
          ? {
              ...submission,
              ...updates,
              status: "待项目总审核",
              reviewComment: undefined,
              submittedAt: TODAY
            }
          : submission
      )
    );
    notifySubmitted("已重新提交，等待项目总审核");
  }

  function approveOperationSubmission(
    submissionId: string,
    comment = "审核通过，可以进入执行。"
  ) {
    const targetSubmission = operationSubmissions.find((submission) => submission.id === submissionId);
    const targetActivity = targetSubmission
      ? activities.find((activity) => activity.id === targetSubmission.activityId)
      : undefined;
    if (!targetSubmission || !targetActivity || !currentUser || !canManageActivity(currentUser, targetActivity)) return;

    setOperationSubmissions((current) =>
      current.map((submission) => {
        if (submission.id !== submissionId) return submission;
        if (isOperationFinalReview(submission.status)) {
          return { ...submission, status: "执行复核通过", reviewComment: comment || "项目总复核通过，运营节点完成。" };
        }
        return { ...submission, status: "审核通过可执行", reviewComment: comment };
      })
    );
    if (targetSubmission && isOperationFinalReview(targetSubmission.status)) {
      setTasks((current) =>
        current.map((task) =>
          task.activityId === targetSubmission.activityId &&
          task.owner === OPERATIONS_OWNER_NAME &&
          (task.type.includes("内容") || task.type.includes("投流") || task.type.includes("达人"))
            ? { ...task, status: "已完成" as const, standard: `${task.standard}\n运营执行已由项目总复核通过。` }
            : task
        )
      );
      const activity = activities.find((item) => item.id === targetSubmission.activityId);
      if (activity?.status === "平台和内容准备") {
        moveActivity(activity.id, "门店执行准备");
      }
    }
  }

  function rejectOperationSubmission(submissionId: string, comment?: string) {
    const targetSubmission = operationSubmissions.find((submission) => submission.id === submissionId);
    const targetActivity = targetSubmission
      ? activities.find((activity) => activity.id === targetSubmission.activityId)
      : undefined;
    if (!targetSubmission || !targetActivity || !currentUser || !canManageActivity(currentUser, targetActivity)) return;

    // 复核阶段（执行完成待复核）被退回：方案本身已通过，只需运营改执行结果后直接重交复核，
    // 退回到「审核通过可执行」，不必再走一遍方案审核。
    const isFinalReview = isOperationFinalReview(targetSubmission.status);
    const effectiveComment =
      comment?.trim() ||
      (isFinalReview
        ? "请按复核意见调整视频/直播/投流执行结果后，在本阶段重新提交复核。"
        : "请补充对标内容、执行排期、预算依据和预期结果后重新提交。");

    setOperationSubmissions((current) =>
      current.map((submission) =>
        submission.id === submissionId
          ? {
              ...submission,
              status: isFinalReview ? "审核通过可执行" : "驳回修改",
              reviewComment: effectiveComment
            }
          : submission
      )
    );

    if (isFinalReview && targetSubmission) {
      // 把对应运营任务拉回进行中，提示运营继续处理执行结果。
      setTasks((current) =>
        current.map((task) =>
          task.activityId === targetSubmission.activityId &&
          task.owner === OPERATIONS_OWNER_NAME &&
          (task.type.includes("内容") || task.type.includes("投流") || task.type.includes("达人"))
            ? { ...task, status: "进行中" as const, standard: `${task.standard}\n复核被退回：${effectiveComment}` }
            : task
        )
      );
    }

    notifySubmitted(isFinalReview ? "已退回运营重新提交执行结果" : "已驳回，退回运营修改方案");
  }

  function submitOperationCompletionReview(submissionId: string) {
    const targetSubmission = operationSubmissions.find((submission) => submission.id === submissionId);
    setOperationSubmissions((current) =>
      current.map((submission) =>
        submission.id === submissionId && submission.status === "审核通过可执行"
          ? {
              ...submission,
              status: "执行完成待项目总复核",
              reviewComment: "运营已完成执行，等待项目总复核素材、投流或直播结果。"
            }
          : submission
      )
    );
    if (targetSubmission) {
      setTasks((current) =>
        current.map((task) =>
          task.activityId === targetSubmission.activityId &&
          task.owner === OPERATIONS_OWNER_NAME &&
          (task.type.includes("内容") || task.type.includes("投流") || task.type.includes("达人"))
            ? { ...task, status: "进行中" as const, standard: `${task.standard}\n运营已提交执行结果，等待项目总复核。` }
            : task
        )
      );
    }
    notifySubmitted("已提交执行结果，等待项目总复核");
  }

  function confirmActivityCost(activityId: string) {
    setCostConfirmedActivityIds((current) => (current.includes(activityId) ? current : [...current, activityId]));
    setTasks((current) =>
      current.map((task) =>
        task.activityId === activityId && task.type.includes("费用")
          ? { ...task, status: "已完成" as const, standard: "费用已核对确认。" }
          : task
      )
    );
    setOperationSubmissions((current) =>
      current.map((submission) =>
        submission.activityId === activityId && submission.type === "投流计划" && submission.status === "待项目总审核"
          ? { ...submission, status: "审核通过可执行" as const, reviewComment: "项目总已确认投流预算，可以执行投流。" }
          : submission
      )
    );
  }

  function updateMaterialTaskStatus(taskId: string, status: MaterialProductionStatus, pickupDate?: string) {
    const materialTask = tasks.find((task) => task.id === taskId);
    const activity = materialTask ? activities.find((item) => item.id === materialTask.activityId) : undefined;
    const arrivalPickupDate = pickupDate || addDays(TODAY, 1);

    setMaterialTaskStatuses((current) => ({ ...current, [taskId]: status }));
    setTasks((current) => {
      const updatedTasks = current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: status === "物料到货" ? ("已完成" as const) : status === "未开始" ? ("待开始" as const) : ("进行中" as const),
              standard:
                status === "物料到货"
                  ? `${task.standard}\n物料已到货，已通知相关门店于 ${arrivalPickupDate} 来领取物料。`
                  : task.standard
            }
          : task
      );

      if (!activity || status !== "物料到货") return updatedTasks;

      const nextTasks = [...updatedTasks];
      activity.storeIds.forEach((storeId) => {
        const store = stores.find((item) => item.id === storeId);
        const alreadyCreated = nextTasks.some(
          (task) => task.activityId === activity.id && task.storeId === storeId && task.type === "门店领料"
        );
        if (alreadyCreated) return;
        nextTasks.push({
          id: nextTaskId(nextTasks),
          activityId: activity.id,
          title: `${store?.name ?? "门店"}领取${activity.name}活动物料`,
          type: "门店领料",
          owner: store?.manager ?? getActivityOwner(activity),
          storeId,
          dueDate: arrivalPickupDate,
          status: "等待处理",
          standard: `物料已到货，请于 ${arrivalPickupDate} 到指定地点领取物料，核对数量和内容，完成门店布置后上传现场照片。`,
          isKey: true
        });
      });

      return nextTasks;
    });

    if (activity?.status === "设计和物料" && status === "物料到货") {
      moveActivity(activity.id, "平台和内容准备");
    }
  }

  function requestDesignForOperation(submissionId: string) {
    const submission = operationSubmissions.find((item) => item.id === submissionId);
    if (!submission) return;

    setTasks((current) => [
      ...current,
      {
        id: nextTaskId(current),
        activityId: submission.activityId,
        title: `直播商品图设计：${submission.title}`,
        type: "设计",
        owner: DESIGN_OWNER_NAME,
        dueDate: addDays(TODAY, 2),
        status: "待开始",
        standard: submission.designRequest || "运营需要直播商品图，请根据直播计划设计商品图。",
        isKey: true
      }
    ]);
  }

  function approveDesignAsset(assetId: string) {
    const asset = designAssets.find((item) => item.id === assetId);
    const activity = asset ? activities.find((item) => item.id === asset.activityId) : undefined;
    if (!asset || !activity || !currentUser || !canManageActivity(currentUser, activity)) return;

    setDesignAssets((current) =>
      current.map((asset) =>
        asset.id === assetId
          ? {
              ...asset,
              status: "已通过",
              reviewer: "项目总",
              reviewedAt: TODAY,
              reviewComment: "项目总审核通过，可以进入物料制作。"
            }
          : asset
      )
    );
    if (asset) {
      setTasks((current) =>
        current.map((task) =>
          task.activityId === asset.activityId && task.owner === DESIGN_OWNER_NAME && task.type.includes("设计")
            ? { ...task, status: "已完成" as const, standard: `${task.standard}\n设计稿已审批通过，可以进入物料制作。` }
            : task
        )
      );
    }
  }

  function rejectDesignAsset(assetId: string, comment: string) {
    const asset = designAssets.find((item) => item.id === assetId);
    const activity = asset ? activities.find((item) => item.id === asset.activityId) : undefined;
    if (!asset || !activity || !currentUser || !canManageActivity(currentUser, activity)) return;

    const cleanComment = comment.trim() || "请根据项目总意见调整画面重点、价格信息和门店执行口径。";
    setDesignAssets((current) =>
      current.map((item) =>
        item.id === assetId
          ? {
              ...item,
              status: "驳回修改",
              reviewer: "项目总",
              reviewedAt: TODAY,
              reviewComment: cleanComment,
              version: item.version + 1
            }
          : item
      )
    );
    setTasks((current) => [
      ...current,
      {
        id: nextTaskId(current),
        activityId: asset.activityId,
        title: `修改设计：${asset.title}`,
        type: "设计",
        owner: asset.designer,
        dueDate: addDays(TODAY, 2),
        status: "待开始",
        standard: cleanComment,
        isKey: true
      }
    ]);
  }

  function submitDesignUpload(input: DesignUploadInput) {
    setDesignAssets((current) => [
      {
        id: `d${current.length + 1}`,
        activityId: input.activityId,
        title: input.title,
        type: input.type,
        purpose: input.purpose,
        fileNames: input.fileNames,
        files: input.files,
        designer: DESIGN_OWNER_NAME,
        version: 1,
        status: "待老板审核",
        submittedAt: TODAY,
        previewTitle: input.title,
        previewSubtitle: input.purpose,
        previewCta: input.type
      },
      ...current
    ]);
    setTasks((current) =>
      current.map((task) =>
        task.activityId === input.activityId && task.owner === DESIGN_OWNER_NAME && (task.type.includes("设计") || task.title.includes("设计"))
          ? { ...task, status: "进行中" as const, standard: `${task.standard}\n设计稿已提交，项目节点进入审核中。` }
          : task
      )
    );
    notifySubmitted("设计稿已提交，等待项目总审核");
  }

  function resetLocalData() {
    window.localStorage.removeItem(STORAGE_KEY);
    setOrganizationUsers(normalizeUsers(demoUsers));
    setOrganizationStores([]);
    setActivities([]);
    setTasks([]);
    setDesignAssets([]);
    setLocalIdeas([]);
    setStoreAppointments([]);
    setOperationSubmissions([]);
    setStoreReports([]);
    setCostConfirmedActivityIds([]);
    setMaterialTaskStatuses({});
    setSelectedActivityId("");
  }

  if (!currentUser) {
    return <LoginScreen users={organizationUsers} loginAs={loginAs} />;
  }

  return (
    <main className="app-shell">
      <SubmitToast />
      {materialArrivalTaskId && (
        <MaterialArrivalDialog
          taskId={materialArrivalTaskId}
          activities={activities}
          stores={organizationStores}
          tasks={tasks}
          onClose={() => setMaterialArrivalTaskId(null)}
          onConfirm={(pickupDate) => {
            updateMaterialTaskStatus(materialArrivalTaskId, "物料到货", pickupDate);
            notifySubmitted(`已通知门店 ${pickupDate} 来领取物料`);
            setMaterialArrivalTaskId(null);
          }}
        />
      )}
      {resubmitSubmissionId &&
        (() => {
          const target = operationSubmissions.find((submission) => submission.id === resubmitSubmissionId);
          if (!target) return null;
          return (
            <OperationResubmitDialog
              submission={target}
              activity={activities.find((item) => item.id === target.activityId)}
              onClose={() => setResubmitSubmissionId(null)}
              onSubmit={(updates) => {
                resubmitOperationSubmission(target.id, updates);
                setResubmitSubmissionId(null);
              }}
            />
          );
        })()}
      <aside className="sidebar">
        <div>
          <p className="eyebrow">MVP 本地版</p>
          <h1>餐饮营销作战中心</h1>
        </div>
        <nav className="nav-list" aria-label="主导航">
          {visibleNavItems.map((item) => (
            <button
              className={activeNav === item ? "nav-item active" : "nav-item"}
              key={item}
              onClick={() => setActiveNav(item)}
            >
              <span>{item}</span>
              {(navBadges[item] ?? 0) > 0 && <b className="nav-badge">{navBadges[item]}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span>今天</span>
          <strong>{TODAY}</strong>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">电脑端规划 + 手机端执行</p>
            <h2>{activeNav}</h2>
          </div>
          <div className="topbar-actions">
            <span className="user-chip">{currentUser.name} · {currentUser.role}</span>
            <span className="user-chip">{workView}视角</span>
            {canChangeBrandFilter ? (
              <select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value as "全部" | Brand)}>
                {brands.map((brand) => (
                  <option key={brand}>{brand}</option>
                ))}
              </select>
            ) : (
              <span className="user-chip">
                {getUserDefaultBrand(currentUser) === "全部" ? "全部项目" : `${getUserDefaultBrand(currentUser)}项目`}
              </span>
            )}
            {currentUser.role === "品牌负责人" && (
              <button className="primary" onClick={() => setActiveNav("项目提报")}>提报项目</button>
            )}
            <button onClick={resetLocalData}>清空本机缓存</button>
            <button
              className="ghost-button"
              onClick={async () => {
                // 先把未保存的改动存到云端（此时登录态仍有效），再登出。
                await flushPendingSave();
                await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
                setCurrentUserId(null);
              }}
            >
              切换账号
            </button>
          </div>
        </header>

        {activeNav === "首页" && (
          <Dashboard
            dashboard={dashboard}
            allActivities={activities}
            activities={filteredActivities}
            tasks={userScopedTasks}
            designAssets={designAssets}
            storeAppointments={storeAppointments}
            operationSubmissions={operationSubmissions}
            materialTaskStatuses={materialTaskStatuses}
            submitDesignUpload={submitDesignUpload}
            workView={workView}
            currentUser={currentUser}
            updateTaskStatus={updateTaskStatus}
            submitLaunchPlan={submitLaunchPlan}
            submitStoreAppointment={submitStoreAppointment}
            confirmStoreAppointment={confirmStoreAppointment}
            submitOperationSubmission={submitOperationSubmission}
            submitOperationCompletionReview={submitOperationCompletionReview}
            approveOperationSubmission={approveOperationSubmission}
            rejectOperationSubmission={rejectOperationSubmission}
            updateMaterialTaskStatus={updateMaterialTaskStatus}
            requestDesignForOperation={requestDesignForOperation}
            setSelectedActivityId={setSelectedActivityId}
            setActiveNav={setActiveNav}
          />
        )}

        {activeNav === "项目提报" && (
          <ProposalPage
            currentUser={currentUser}
            brandFilter={brandFilter}
            ideas={localIdeas}
            submitActivityProposal={submitActivityProposal}
            submitIdea={submitIdea}
          />
        )}

        {activeNav === "活动日历" && (
          <CalendarView
            activities={filteredActivities.filter((activity) =>
              [
                "已通过待启动",
                "设计和物料",
                "平台和内容准备",
                "门店执行准备",
                "活动进行中",
                "数据收集中",
                "待复盘",
                "已完成"
              ].includes(activity.status)
            )}
            month={month}
            setMonth={setMonth}
            draggingActivityId={draggingActivityId}
            setDraggingActivityId={setDraggingActivityId}
            moveActivityDate={moveActivityDate}
            openActivity={(id) => {
              setSelectedActivityId(id);
              setActiveNav("活动详情");
            }}
          />
        )}

        {activeNav === "活动看板" && (
          <BoardView
            activities={filteredActivities}
            tasks={tasks}
            draggingActivityId={draggingActivityId}
            setDraggingActivityId={setDraggingActivityId}
            moveActivity={moveActivity}
            openActivity={(id) => {
              setSelectedActivityId(id);
              setActiveNav("活动详情");
            }}
          />
        )}

        {activeNav === "节点监控" && (
          <NodeMonitor
            activities={filteredActivities}
            tasks={tasks}
            designAssets={designAssets}
            materialTaskStatuses={materialTaskStatuses}
            operationSubmissions={operationSubmissions}
            openActivity={(id) => {
              setSelectedActivityId(id);
              setActiveNav("活动详情");
            }}
          />
        )}

        {activeNav === "设计审核" && (
          <DesignReviewPage
            activities={filteredActivities}
            designAssets={designAssets}
            currentUser={currentUser}
            submitDesignUpload={submitDesignUpload}
            approveDesignAsset={approveDesignAsset}
            rejectDesignAsset={rejectDesignAsset}
            openActivity={(id) => {
              setSelectedActivityId(id);
              setActiveNav("活动详情");
            }}
          />
        )}

        {activeNav === "我的任务" && (
          <TaskView
            tasks={currentUser.role === "老板" ? tasks.filter(isBossReviewTask) : userScopedTasks}
            activities={activities}
            designAssets={designAssets}
            materialTaskStatuses={materialTaskStatuses}
            operationSubmissions={operationSubmissions}
            storeAppointments={storeAppointments}
            currentUser={currentUser}
            completeTask={completeTask}
            updateTaskStatus={updateTaskStatus}
            submitTaskReport={submitTaskReport}
            submitLaunchPlan={submitLaunchPlan}
            submitOperationSubmission={submitOperationSubmission}
            submitOperationCompletionReview={submitOperationCompletionReview}
            resubmitOperationSubmission={resubmitOperationSubmission}
            resubmitActivityProposal={resubmitActivityProposal}
            getProposalRejectComment={getProposalRejectComment}
            approveOperationSubmission={approveOperationSubmission}
            rejectOperationSubmission={rejectOperationSubmission}
            requestDesignForOperation={requestDesignForOperation}
            submitStoreReport={submitStoreReport}
            confirmStoreAppointment={confirmStoreAppointment}
            approveActivity={approveActivity}
            rejectActivity={rejectActivity}
            openActivity={(id) => {
              setSelectedActivityId(id);
              setActiveNav("活动详情");
            }}
            goDashboard={() => setActiveNav("首页")}
          />
        )}

        {activeNav === "活动详情" && (
          selectedActivity ? (
            <ActivityDetail
              activity={selectedActivity}
              activities={accessibleActivities}
              tasks={tasks.filter((task) => task.activityId === selectedActivity.id)}
              designAssets={designAssets.filter((asset) => asset.activityId === selectedActivity.id)}
              allDesignAssets={designAssets}
              materialTaskStatuses={materialTaskStatuses}
              approveActivity={approveActivity}
              rejectActivity={(id) => rejectActivity(id, "")}
              approveDesignAsset={approveDesignAsset}
              rejectDesignAsset={rejectDesignAsset}
              operationSubmissions={operationSubmissions}
              costConfirmedActivityIds={costConfirmedActivityIds}
              confirmActivityCost={confirmActivityCost}
              currentUser={currentUser}
              selectActivity={setSelectedActivityId}
            />
          ) : (
            <section className="panel">
              <h3>暂无可查看项目</h3>
              <p className="body-copy">当前账号还没有被分配到可查看的营销项目。</p>
            </section>
          )
        )}

        {activeNav === "灵感池" && <IdeaPool ideas={localIdeas} convertIdeaToActivity={convertIdeaToActivity} />}

        {activeNav === "数据复盘" && (
          <Analytics activities={filteredActivities} />
        )}

        {activeNav === "基础资料" && (
          <BasicDataPage
            users={organizationUsers}
            stores={organizationStores}
            brandLeaders={brandLeaderConfig}
            saveUser={saveUser}
            saveStore={saveStore}
            saveBrandLeader={saveBrandLeader}
          />
        )}

        {activeNav === "本地配置" && <LocalSetup />}
      </section>
    </main>
  );
}

function LoginScreen({ users: loginUsers, loginAs }: { users: User[]; loginAs: (userId: string) => void }) {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const loginGroups = [
    { title: "管理层", roles: ["老板"] },
    { title: "品牌负责人", roles: ["品牌负责人"] },
    { title: "执行部门", roles: ["设计人员", "内容及投放运营"] },
    { title: "门店", roles: ["店长"] }
  ];

  const [submitting, setSubmitting] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const user = findLoginUser(account, loginUsers);
    if (!user) {
      setLoginError("账号或口令不正确。试用口令默认是 123456。");
      return;
    }

    setLoginError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, password })
      });

      if (!response.ok) {
        setLoginError("账号或口令不正确。试用口令默认是 123456。");
        return;
      }

      loginAs(user.id);
    } catch {
      setLoginError("登录服务暂时不可用，请稍后再试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-hero">
        <p className="eyebrow">试用账号登录</p>
        <h1>餐饮营销作战中心</h1>
        <p>输入账号和试用口令进入系统。登录后会按岗位展示不同页面和任务入口。</p>
        <form className="login-form" onSubmit={submitLogin}>
          <label>
            账号
            <input value={account} onChange={(event) => setAccount(event.target.value)} placeholder="例如 boss / design / store1" />
          </label>
          <label>
            口令
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="试用口令 123456"
              type="password"
            />
          </label>
          {loginError && <p className="form-error">{loginError}</p>}
          <button className="primary" type="submit" disabled={submitting}>
            {submitting ? "登录中…" : "登录"}
          </button>
        </form>
      </section>
      <section className="login-panel">
        {loginGroups.map((group) => (
          <div className="login-group" key={group.title}>
            <h2>{group.title}</h2>
            <div className="login-grid">
              {loginUsers
                .filter((user) => group.roles.includes(user.role))
                .map((user) => (
                  <button
                    className="login-card"
                    key={user.id}
                    onClick={() => {
                      setAccount(getLoginAccount(user));
                      setPassword(TRIAL_LOGIN_PASSWORD);
                      setLoginError("");
                    }}
                    type="button"
                  >
                    <strong>{user.name}</strong>
                    <span>{user.role}</span>
                    <em>账号：{getLoginAccount(user)}</em>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

function BasicDataPage({
  users: organizationUsers,
  stores: organizationStores,
  brandLeaders: currentBrandLeaders,
  saveUser,
  saveStore,
  saveBrandLeader
}: {
  users: User[];
  stores: Store[];
  brandLeaders: Record<Brand, string>;
  saveUser: (user: User) => void;
  saveStore: (store: Store) => void;
  saveBrandLeader: (brand: Brand, owner: string) => void;
}) {
  const roleOptions: Role[] = ["老板", "品牌负责人", "设计人员", "内容及投放运营", "店长"];
  const projectLeadUsers = organizationUsers.filter((user) => user.role === "品牌负责人");
  const [selectedUserId, setSelectedUserId] = useState("new");
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState<Role>("店长");
  const [selectedStoreId, setSelectedStoreId] = useState("new");
  const [storeName, setStoreName] = useState("");
  const [storeBrand, setStoreBrand] = useState<Brand>("中餐");
  const [storeManager, setStoreManager] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const selectedUser = organizationUsers.find((user) => user.id === selectedUserId);
    if (!selectedUser) {
      setUserName("");
      setUserRole("店长");
      return;
    }

    setUserName(selectedUser.name);
    setUserRole(selectedUser.role);
  }, [organizationUsers, selectedUserId]);

  useEffect(() => {
    const selectedStore = organizationStores.find((store) => store.id === selectedStoreId);
    if (!selectedStore) {
      setStoreName("");
      setStoreBrand("中餐");
      setStoreManager(organizationUsers.find((user) => user.role === "店长")?.name ?? "");
      return;
    }

    setStoreName(selectedStore.name);
    setStoreBrand(selectedStore.brand);
    setStoreManager(selectedStore.manager);
  }, [organizationStores, organizationUsers, selectedStoreId]);

  function submitUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = userName.trim();
    if (!trimmedName) {
      setMessage("人员姓名不能为空。");
      return;
    }

    const nextUser: User = {
      id: selectedUserId === "new" ? createUserId(organizationUsers) : selectedUserId,
      name: trimmedName,
      role: userRole
    };

    saveUser(nextUser);
    setSelectedUserId(nextUser.id);
    setMessage(`${nextUser.name} 已保存。`);
  }

  function submitStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = storeName.trim();
    if (!trimmedName || !storeManager.trim()) {
      setMessage("门店名称和店长不能为空。");
      return;
    }

    const nextStore: Store = {
      id: selectedStoreId === "new" ? createStoreId(organizationStores) : selectedStoreId,
      name: trimmedName,
      brand: storeBrand,
      manager: storeManager.trim()
    };

    saveStore(nextStore);
    setSelectedStoreId(nextStore.id);
    setMessage(`${nextStore.name} 已保存。`);
  }

  return (
    <div className="page-stack">
      <section className="section-header">
        <div>
          <p className="eyebrow">基础资料</p>
          <h3>人员、账号和门店</h3>
        </div>
        <span className="status-pill active">自动同步 Supabase</span>
      </section>

      {message && <p className="inline-notice">{message}</p>}

      <section className="panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">品牌项目总</p>
            <h3>维护品牌负责人归属</h3>
          </div>
          <span className="status-pill">影响项目权限和任务分发</span>
        </div>
        <div className="brand-leader-grid">
          {managedBrands.map((brand) => {
            const currentOwner = currentBrandLeaders[brand] ?? "";
            const options = projectLeadUsers.some((user) => user.name === currentOwner)
              ? projectLeadUsers
              : currentOwner
                ? [{ id: `current-${brand}`, name: currentOwner, role: "品牌负责人" as const }, ...projectLeadUsers]
                : projectLeadUsers;
            return (
              <label className="brand-leader-card" key={brand}>
                <span>{brand}</span>
                <select
                  value={currentOwner}
                  onChange={(event) => {
                    saveBrandLeader(brand, event.target.value);
                    setMessage(`${brand}项目总已调整为 ${event.target.value}。`);
                  }}
                >
                  <option value="">选择项目总</option>
                  {options.map((user) => (
                    <option key={user.id} value={user.name}>{user.name}</option>
                  ))}
                </select>
                <em>该品牌项目、审批、节点和复盘会自动归到此人名下。</em>
              </label>
            );
          })}
        </div>
      </section>

      <section className="two-column">
        <form className="panel form-panel" onSubmit={submitUser}>
          <div className="panel-title">
            <div>
              <p className="eyebrow">账号资料</p>
              <h3>维护人员</h3>
            </div>
            <button className="ghost-button" type="button" onClick={() => setSelectedUserId("new")}>新增人员</button>
          </div>
          <label>
            选择人员
            <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
              <option value="new">新增人员</option>
              {organizationUsers.map((user) => (
                <option key={user.id} value={user.id}>{user.name} · {user.role}</option>
              ))}
            </select>
          </label>
          <label>
            姓名
            <input value={userName} onChange={(event) => setUserName(event.target.value)} placeholder="输入真实姓名" />
          </label>
          <label>
            角色
            <select value={userRole} onChange={(event) => setUserRole(event.target.value as Role)}>
              {roleOptions.map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
          </label>
          <p className="helper-text">
            试用账号会自动生成。当前账号：
            {selectedUserId === "new"
              ? "保存后生成"
              : getLoginAccount(organizationUsers.find((user) => user.id === selectedUserId) ?? { id: selectedUserId, name: userName, role: userRole })}
          </p>
          <button className="primary" type="submit">保存人员</button>
        </form>

        <form className="panel form-panel" onSubmit={submitStore}>
          <div className="panel-title">
            <div>
              <p className="eyebrow">门店资料</p>
              <h3>维护门店</h3>
            </div>
            <button className="ghost-button" type="button" onClick={() => setSelectedStoreId("new")}>新增门店</button>
          </div>
          <label>
            选择门店
            <select value={selectedStoreId} onChange={(event) => setSelectedStoreId(event.target.value)}>
              <option value="new">新增门店</option>
              {organizationStores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </label>
          <label>
            门店名称
            <input value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="输入门店名称" />
          </label>
          <label>
            所属品牌
            <select value={storeBrand} onChange={(event) => setStoreBrand(event.target.value as Brand)}>
              {(["中餐", "火锅", "虾锅"] as Brand[]).map((brand) => (
                <option key={brand}>{brand}</option>
              ))}
            </select>
          </label>
          <label>
            店长
            <select value={storeManager} onChange={(event) => setStoreManager(event.target.value)}>
              <option value="">选择店长</option>
              {organizationUsers
                .filter((user) => user.role === "店长")
                .map((user) => (
                  <option key={user.id} value={user.name}>{user.name}</option>
                ))}
            </select>
          </label>
          <button className="primary" type="submit">保存门店</button>
        </form>
      </section>

      <section className="two-column">
        <div className="panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">试用账号</p>
              <h3>账号清单</h3>
            </div>
            <span className="status-pill">口令 123456</span>
          </div>
          <div className="data-table compact">
            <div className="data-row header"><span>姓名</span><span>角色</span><span>账号</span></div>
            {organizationUsers.map((user) => (
              <div className="data-row" key={user.id}>
                <span>{user.name}</span>
                <span>{user.role}</span>
                <strong>{getLoginAccount(user)}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">门店归属</p>
              <h3>门店清单</h3>
            </div>
            <span className="status-pill">{organizationStores.length} 家</span>
          </div>
          <div className="data-table compact">
            <div className="data-row header"><span>门店</span><span>品牌</span><span>店长</span></div>
            {organizationStores.map((store) => (
              <div className="data-row" key={store.id}>
                <span>{store.name}</span>
                <span>{store.brand}</span>
                <strong>{store.manager}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function ProposalPage({
  currentUser,
  brandFilter,
  ideas,
  submitActivityProposal,
  submitIdea
}: {
  currentUser: User;
  brandFilter: "全部" | Brand;
  ideas: Idea[];
  submitActivityProposal: (proposal: Omit<Activity, "id" | "actualCost" | "status">) => void;
  submitIdea: (idea: IdeaInput) => void;
}) {
  const defaultBrand = getUserDefaultBrand(currentUser);
  const initialBrand = defaultBrand === "全部" ? (brandFilter === "全部" ? "中餐" : brandFilter) : defaultBrand;
  const [name, setName] = useState("暑期升学宴推广");
  const [brand, setBrand] = useState<Brand>(initialBrand);
  const [scale, setScale] = useState<Activity["scale"]>("普通活动");
  const [startDate, setStartDate] = useState(addDays(TODAY, 21));
  const [endDate, setEndDate] = useState(addDays(TODAY, 51));
  const [budget, setBudget] = useState(70000);
  const [goal, setGoal] = useState("获取暑期升学宴、谢师宴预订线索，提升包间预订。");
  const [plan, setPlan] = useState("选择核心门店测试套餐，短视频展示包间、菜品和服务仪式感。");
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>(
    stores.filter((store) => store.brand === initialBrand).slice(0, 3).map((store) => store.id)
  );

  const brandStores = stores.filter((store) => store.brand === brand);
  const canSubmit = name.trim() && selectedStoreIds.length > 0 && budget > 0 && startDate <= endDate;

  function toggleStore(storeId: string) {
    setSelectedStoreIds((current) =>
      current.includes(storeId) ? current.filter((id) => id !== storeId) : [...current, storeId]
    );
  }

  function applyIdeaToProposal(idea: Idea) {
    const nextBrand = idea.brands[0] ?? brand;
    setName(idea.title);
    setBrand(nextBrand);
    setBudget(idea.budget);
    setPlan(`${idea.suggestion}\n来源：${idea.platform}${idea.url ? ` ${idea.url}` : ""}`);
    setSelectedStoreIds(stores.filter((store) => store.brand === nextBrand).slice(0, 3).map((store) => store.id));
  }

  return (
    <section className="proposal-layout proposal-integrated">
      <div className="proposal-main">
        <article className="panel">
          <div className="panel-title">
            <h3>品牌项目提报</h3>
            <span>{currentUser.name} · {currentUser.role}</span>
          </div>
          <div className="proposal-form">
            <label>
              <span>活动名称</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <span>所属品牌</span>
              <select
                value={brand}
                onChange={(event) => {
                  const nextBrand = event.target.value as Brand;
                  setBrand(nextBrand);
                  setSelectedStoreIds(stores.filter((store) => store.brand === nextBrand).slice(0, 3).map((store) => store.id));
                }}
                disabled={defaultBrand !== "全部"}
              >
                {(["中餐", "火锅", "虾锅"] as Brand[]).map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              <span>活动规模</span>
              <select value={scale} onChange={(event) => setScale(event.target.value as Activity["scale"])}>
                {(["大型活动", "普通活动", "节日氛围活动"] as Activity["scale"][]).map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              <span>活动预算</span>
              <input inputMode="numeric" value={budget} onChange={(event) => setBudget(Number(event.target.value) || 0)} />
            </label>
            <label>
              <span>开始日期</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label>
              <span>结束日期</span>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </label>
            <label className="full-span">
              <span>活动目标</span>
              <textarea rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} />
            </label>
            <label className="full-span">
              <span>初步方案</span>
              <textarea rows={5} value={plan} onChange={(event) => setPlan(event.target.value)} />
            </label>
            <div className="proposal-store-section full-span">
              <div className="proposal-section-title">
                <div>
                  <h4>参与门店</h4>
                  <p>只显示当前品牌下的门店，提报通过后系统会按这些门店生成执行和数据填报任务。</p>
                </div>
                <span>{selectedStoreIds.length} 家</span>
              </div>
              <div className="store-check-list proposal-store-list">
                {brandStores.length > 0 ? (
                  brandStores.map((store) => (
                    <label key={store.id}>
                      <input
                        type="checkbox"
                        checked={selectedStoreIds.includes(store.id)}
                        onChange={() => toggleStore(store.id)}
                      />
                      <span>{store.name}</span>
                      <em>{store.manager}</em>
                    </label>
                  ))
                ) : (
                  <p className="body-copy">当前品牌还没有维护真实门店，请先到「基础资料」新增门店后再提报项目。</p>
                )}
              </div>
            </div>
            <div className="proposal-summary full-span">
              <strong>提交后流程</strong>
              <p>项目会进入「待老板审核」。老板通过后，项目总再填写各节点截止日期，并下派设计、运营、门店和复盘任务。</p>
            </div>
            <button
              className="primary submit-proposal full-span"
              disabled={!canSubmit}
              onClick={() =>
                submitActivityProposal({
                  name,
                  type: "临时营销活动",
                  brand,
                  storeIds: selectedStoreIds,
                  scale,
                  owner: currentUser.name,
                  startDate,
                  endDate,
                  prepStartDate: addDays(startDate, scale === "大型活动" ? -60 : scale === "普通活动" ? -30 : -14),
                  goal,
                  plan,
                  budget
                })
              }
            >
              提交给老板审核
            </button>
          </div>
        </article>

        <HolidayAndTrendPanel />
        <IdeaCapturePanel
          currentUser={currentUser}
          ideas={ideas}
          submitIdea={submitIdea}
          onUseIdea={applyIdeaToProposal}
        />
      </div>
    </section>
  );
}

function IdeaCapturePanel({
  currentUser,
  ideas,
  submitIdea,
  onUseIdea
}: {
  currentUser: User;
  ideas: Idea[];
  submitIdea: (idea: IdeaInput) => void;
  onUseIdea: (idea: Idea) => void;
}) {
  const defaultBrand = getUserDefaultBrand(currentUser);
  const initialBrand = defaultBrand === "全部" ? "中餐" : defaultBrand;
  const [title, setTitle] = useState("小红书本地宝藏店打卡");
  const [platform, setPlatform] = useState("小红书");
  const [url, setUrl] = useState("");
  const [budget, setBudget] = useState(12000);
  const [suggestion, setSuggestion] = useState("适合先选 1-2 家门店做图文探店，观察收藏和到店咨询。");
  const [selectedBrands, setSelectedBrands] = useState<Brand[]>([initialBrand]);
  const canSubmit = title.trim() && platform.trim() && selectedBrands.length > 0 && suggestion.trim();

  function toggleBrand(brand: Brand) {
    setSelectedBrands((current) =>
      current.includes(brand) ? current.filter((item) => item !== brand) : [...current, brand]
    );
  }

  return (
    <article className="panel">
      <div className="panel-title">
        <h3>灵感记录</h3>
        <span>项目总填写，评估后可带入提报</span>
      </div>
      <div className="idea-capture-layout">
        <div className="idea-capture-form">
          <label>
            <span>灵感标题</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            <span>来源平台</span>
            <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
              {["小红书", "抖音", "大众点评", "美团", "朋友圈", "线下观察"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            <span>来源链接</span>
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="可先不填" />
          </label>
          <label>
            <span>初步预算</span>
            <input inputMode="numeric" value={budget} onChange={(event) => setBudget(Number(event.target.value) || 0)} />
          </label>
          <label className="full-span">
            <span>适用品牌</span>
            <div className="brand-checkbox-row">
              {(["中餐", "火锅", "虾锅"] as Brand[]).map((brand) => (
                <label key={brand}>
                  <input
                    checked={selectedBrands.includes(brand)}
                    type="checkbox"
                    onChange={() => toggleBrand(brand)}
                  />
                  <span>{brand}</span>
                </label>
              ))}
            </div>
          </label>
          <label className="full-span">
            <span>活动建议</span>
            <textarea rows={3} value={suggestion} onChange={(event) => setSuggestion(event.target.value)} />
          </label>
          <button
            className="primary"
            disabled={!canSubmit}
            onClick={() => {
              submitIdea({
                title,
                platform,
                url,
                brands: selectedBrands,
                budget,
                suggestion
              });
              setTitle("");
              setUrl("");
              setSuggestion("");
            }}
          >
            保存到灵感池
          </button>
        </div>

        <div className="idea-mini-list">
          {ideas.slice(0, 4).map((idea) => (
            <article className="idea-mini-card" key={idea.id}>
              <div>
                <strong>{idea.title}</strong>
                <span>{idea.platform} · {idea.brands.join("、")} · {yuan(idea.budget)}</span>
              </div>
              <p>{idea.suggestion}</p>
              <button onClick={() => onUseIdea(idea)}>带入项目提报</button>
            </article>
          ))}
        </div>
      </div>
    </article>
  );
}

function Dashboard({
  dashboard,
  allActivities,
  activities,
  tasks,
  designAssets,
  storeAppointments,
  operationSubmissions,
  materialTaskStatuses,
  submitDesignUpload,
  workView,
  currentUser,
  updateTaskStatus,
  submitLaunchPlan,
  submitStoreAppointment,
  confirmStoreAppointment,
  submitOperationSubmission,
  submitOperationCompletionReview,
  approveOperationSubmission,
  rejectOperationSubmission,
  updateMaterialTaskStatus,
  requestDesignForOperation,
  setSelectedActivityId,
  setActiveNav
}: {
  dashboard: {
    thisMonthCount: number;
    upcomingCount: number;
    pendingReviewCount: number;
    overdueTaskCount: number;
    unsubmittedStores: number;
    monthlyBudget: number;
    monthlyActivityBudget: number;
    monthlyActualCost: number;
    yearlyBudget: number;
    yearlyActual: number;
  };
  allActivities: Activity[];
  activities: Activity[];
  tasks: Task[];
  designAssets: DesignAsset[];
  storeAppointments: StoreContentAppointment[];
  operationSubmissions: OperationSubmission[];
  materialTaskStatuses: Record<string, MaterialProductionStatus>;
  submitDesignUpload: (input: DesignUploadInput) => void;
  workView: WorkView;
  currentUser: User;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  submitLaunchPlan: (plan: LaunchPlanInput) => void;
  submitStoreAppointment: (input: StoreAppointmentInput) => void;
  confirmStoreAppointment: (appointmentId: string, selectedSlot: string) => void;
  submitOperationSubmission: (input: OperationSubmissionInput) => void;
  submitOperationCompletionReview: (submissionId: string) => void;
  approveOperationSubmission: (submissionId: string, comment?: string) => void;
  rejectOperationSubmission: (submissionId: string, comment?: string) => void;
  updateMaterialTaskStatus: (taskId: string, status: MaterialProductionStatus) => void;
  requestDesignForOperation: (submissionId: string) => void;
  setSelectedActivityId: (id: string) => void;
  setActiveNav: (nav: NavItem) => void;
}) {
  const visibleActivityIds = new Set(activities.map((activity) => activity.id));
  const recentReports = storeReports
    .slice()
    .filter((report) => visibleActivityIds.has(report.activityId))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 4);

  if (currentUser.role === "店长" || currentUser.role === "内容及投放运营" || currentUser.role === "设计人员") {
    return (
      <div className="page-stack">
        <RoleWorkbench
          activities={activities}
          allActivities={allActivities}
          tasks={tasks}
          designAssets={designAssets}
          storeAppointments={storeAppointments}
          operationSubmissions={operationSubmissions}
          materialTaskStatuses={materialTaskStatuses}
          workView={workView}
          currentUser={currentUser}
          updateTaskStatus={updateTaskStatus}
          submitLaunchPlan={submitLaunchPlan}
          submitDesignUpload={submitDesignUpload}
          submitStoreAppointment={submitStoreAppointment}
          confirmStoreAppointment={confirmStoreAppointment}
          submitOperationSubmission={submitOperationSubmission}
          submitOperationCompletionReview={submitOperationCompletionReview}
          approveOperationSubmission={approveOperationSubmission}
          rejectOperationSubmission={rejectOperationSubmission}
          updateMaterialTaskStatus={updateMaterialTaskStatus}
          requestDesignForOperation={requestDesignForOperation}
          openActivity={(id) => {
            setSelectedActivityId(id);
            setActiveNav("活动详情");
          }}
          goProposal={() => setActiveNav("项目提报")}
          goTasks={() => setActiveNav("我的任务")}
        />
      </div>
    );
  }
  const baseStats = [
    ["本月活动", dashboard.thisMonthCount.toString()],
    ["即将开始", dashboard.upcomingCount.toString()],
    ["待审核", dashboard.pendingReviewCount.toString()],
    ["延期任务", dashboard.overdueTaskCount.toString()],
    ["未提交门店", dashboard.unsubmittedStores.toString()]
  ];
  const stats = currentUser.role === "老板"
    ? [...baseStats, ["本月预算", yuan(dashboard.monthlyBudget)], ["本月实际活动费用", yuan(dashboard.monthlyActualCost)]]
    : [
        ...baseStats,
        ["本月活动预算", yuan(dashboard.monthlyActivityBudget)],
        ["本月实际花费", yuan(dashboard.monthlyActualCost)]
  ];

  return (
    <div className="page-stack">
      <section className="metric-grid">
        {stats.map(([label, value]) => (
          <article className="metric-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <BrandComparisonChart activities={allActivities} />

      {currentUser.role === "老板" && (
        <BossPendingReviewPanel
          activities={allActivities}
          openActivity={(id) => {
            setSelectedActivityId(id);
            setActiveNav("活动详情");
          }}
          goReviewTasks={() => setActiveNav("我的任务")}
        />
      )}

      {currentUser.role !== "老板" && (
        <RoleWorkbench
          activities={activities}
          allActivities={allActivities}
          tasks={tasks}
          designAssets={designAssets}
          storeAppointments={storeAppointments}
          operationSubmissions={operationSubmissions}
          materialTaskStatuses={materialTaskStatuses}
          workView={workView}
          currentUser={currentUser}
          updateTaskStatus={updateTaskStatus}
          submitLaunchPlan={submitLaunchPlan}
          submitDesignUpload={submitDesignUpload}
          submitStoreAppointment={submitStoreAppointment}
          confirmStoreAppointment={confirmStoreAppointment}
          submitOperationSubmission={submitOperationSubmission}
          submitOperationCompletionReview={submitOperationCompletionReview}
          approveOperationSubmission={approveOperationSubmission}
          rejectOperationSubmission={rejectOperationSubmission}
          updateMaterialTaskStatus={updateMaterialTaskStatus}
          requestDesignForOperation={requestDesignForOperation}
          openActivity={(id) => {
            setSelectedActivityId(id);
            setActiveNav("活动详情");
          }}
          goProposal={() => setActiveNav("项目提报")}
          goTasks={() => setActiveNav("我的任务")}
        />
      )}

      {currentUser.role === "老板" && (
        <>
          <DelayedNodesPanel
            activities={allActivities}
            tasks={tasks}
            designAssets={designAssets}
            materialTaskStatuses={materialTaskStatuses}
            operationSubmissions={operationSubmissions}
            openActivity={(id) => {
              setSelectedActivityId(id);
              setActiveNav("活动详情");
            }}
          />
          <StoreReportTicker activities={allActivities} />
        </>
      )}

      {currentUser.role !== "老板" && <section className="two-column">
        <div className="panel">
          <div className="panel-title">
            <h3>最近活动效果</h3>
            <span>按活动营业额排序</span>
          </div>
          <div className="rank-list">
            {recentReports.length > 0 ? (
              recentReports.map((report, index) => {
                const activity = activities.find((item) => item.id === report.activityId);
                const store = stores.find((item) => item.id === report.storeId);
                return (
                  <button
                    className="rank-row"
                    key={report.id}
                    onClick={() => {
                      if (activity) {
                        setSelectedActivityId(activity.id);
                        setActiveNav("活动详情");
                      }
                    }}
                  >
                    <span>{index + 1}</span>
                    <strong>{store?.name}</strong>
                    <em>{activity?.name}</em>
                    <b>{yuan(report.revenue)}</b>
                  </button>
                );
              })
            ) : (
              <p className="body-copy">暂无门店上报的活动效果数据。</p>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">
            <h3>需要处理</h3>
            <span>任务和审核</span>
          </div>
          <div className="task-strip">
            {tasks
              .filter((task) => task.status === "已延期" || task.status === "等待处理")
              .map((task) => (
                <div className="task-line" key={task.id}>
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.owner} · {task.dueDate}</span>
                  </div>
                  <b>{task.status}</b>
                </div>
              ))}
          </div>
        </div>
      </section>}
    </div>
  );
}

function BrandComparisonChart({ activities }: { activities: Activity[] }) {
  const brandStats = (["中餐", "火锅", "虾锅"] as Brand[]).map((brand) => {
    const brandActivities = activities.filter((activity) => activity.brand === brand && activity.startDate.startsWith(TODAY.slice(0, 7)));
    const completedCount = brandActivities.filter((activity) => activity.status === "已完成").length;
    const brandActivityIds = new Set(activities.filter((activity) => activity.brand === brand).map((activity) => activity.id));
    const brandReports = storeReports.filter((report) => brandActivityIds.has(report.activityId));
    const revenue = brandReports.reduce((sum, report) => sum + report.revenue, 0);
    const beforeValue = brandReports.reduce((sum, report) => sum + report.beforeValue, 0);
    const growth = beforeValue ? Math.round(((revenue - beforeValue) / beforeValue) * 100) : 0;
    const submittedStores = brandReports.length;
    const maxRevenue = 140000;

    return {
      brand,
      leader: brandLeaders[brand],
      count: brandActivities.length,
      completedCount,
      revenue,
      growth,
      submittedStores,
      revenueRatio: Math.min(100, Math.round((revenue / maxRevenue) * 100))
    };
  });
  const rankedBrandStats = brandStats
    .slice()
    .sort((a, b) => b.revenue + b.count * 12000 - (a.revenue + a.count * 12000));
  const maxCount = Math.max(1, ...rankedBrandStats.map((item) => item.count));

  return (
    <article className="panel">
      <div className="panel-title">
        <h3>三品牌本月活动和表现</h3>
        <span>完成数量 + 营销销售额</span>
      </div>
      <div className="comparison-chart">
        {rankedBrandStats.map((item, index) => (
          <div className="brand-row" key={item.brand}>
            <span className="brand-rank">第{index + 1}</span>
            <div className="brand-label">
              <strong>{item.brand} · {item.leader}</strong>
              <span>本月活动 {item.count} 个 · 已完成 {item.completedCount} 个 · {item.submittedStores} 家已填报</span>
            </div>
            <div className="bar-pair">
              <div className="bar-line">
                <span style={{ width: `${(item.count / maxCount) * 100}%`, background: brandColors[item.brand] }} />
              </div>
              <div className="bar-line muted-bar">
                <span style={{ width: `${item.revenueRatio}%` }} />
              </div>
            </div>
            <div className="brand-result">
              <strong>{yuan(item.revenue)}</strong>
              <span className={item.growth >= 0 ? "trend-up" : "trend-down"}>{item.growth >= 0 ? "+" : ""}{item.growth}%</span>
            </div>
          </div>
        ))}
      </div>
      <div className="chart-legend">
        <span><i className="solid" />本月营销活动数量</span>
        <span><i />营销销售额</span>
      </div>
    </article>
  );
}

function BossPendingReviewPanel({
  activities,
  openActivity,
  goReviewTasks
}: {
  activities: Activity[];
  openActivity: (id: string) => void;
  goReviewTasks: () => void;
}) {
  const pendingActivities = activities.filter((activity) => needsBossReview(activity.status));

  return (
    <section className="panel">
      <div className="panel-title">
        <h3>需要老板审核的项目</h3>
        <button className="primary" onClick={goReviewTasks}>去审核任务</button>
      </div>
      <div className="boss-review-grid">
        {pendingActivities.length > 0 ? (
          pendingActivities.map((activity) => (
            <button className="boss-review-card" key={activity.id} onClick={() => openActivity(activity.id)}>
              <strong>{activity.name}</strong>
              <span>{activity.brand} · {getActivityOwner(activity)} · {activity.storeIds.length} 家门店</span>
              <em>{activity.startDate} 至 {activity.endDate}</em>
              <b>{yuan(activity.budget)}</b>
            </button>
          ))
        ) : (
          <p className="body-copy">当前没有需要老板处理的项目提案。</p>
        )}
      </div>
    </section>
  );
}

function StoreReportTicker({ activities }: { activities: Activity[] }) {
  const visibleActivityIds = new Set(activities.map((activity) => activity.id));
  const reportRows = storeReports
    .filter((report) => visibleActivityIds.has(report.activityId))
    .map((report) => {
      const activity = activities.find((item) => item.id === report.activityId);
      const store = stores.find((item) => item.id === report.storeId);
      return { report, activity, store };
    });
  const rows = reportRows.length > 0 ? [...reportRows, ...reportRows] : [];

  return (
    <section className="panel">
      <div className="panel-title">
        <h3>门店活动数据滚动播报</h3>
        <span>店长上报营业额和销售数量</span>
      </div>
      <div className="report-ticker">
        {rows.length > 0 ? (
          <div className="report-ticker-track">
            {rows.map(({ report, activity, store }, index) => (
              <div className="report-ticker-row" key={`${report.id}-${index}`}>
                <strong>{store?.name}</strong>
                <span>{store?.manager} · {activity?.name}</span>
                <em>销量 {report.packageSales}</em>
                <b>{yuan(report.revenue)}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="body-copy">暂无店长上报数据，正式填报后这里会滚动展示。</p>
        )}
      </div>
    </section>
  );
}

function HolidayAndTrendPanel() {
  const holidayIdeas = [
    {
      date: "06-21",
      title: "夏至清爽局",
      idea: "火锅做酸汤/番茄清爽锅，中餐做凉菜家宴，虾锅做啤酒夜宵套餐。"
    },
    {
      date: "07-01",
      title: "暑期档启动",
      idea: "升学宴、谢师宴、学生聚餐、家庭宴预订开始铺内容，提前收集包间线索。"
    },
    {
      date: "07-07",
      title: "小暑",
      idea: "重点做解暑、夜宵、晚市，推出清爽锅底、冰饮、啤酒和小份套餐。"
    },
    {
      date: "07-15",
      title: "升学宴第一波",
      idea: "中餐主推包间和宴席，火锅/虾锅主推学生聚餐和谢师小宴。"
    }
  ];
  const hotTopics = [
    { platform: "抖音", topic: "夏季夜宵搭子", action: "拍虾锅出锅、冰啤酒、朋友局、晚市排队和团购套餐。" },
    { platform: "小红书", topic: "本地宝藏店打卡", action: "做门店环境、真实套餐价格、适合几人吃、顾客反馈的图文笔记。" },
    { platform: "抖音", topic: "升学宴/谢师宴", action: "拍包间、上菜仪式、宴席菜单、家长预订咨询和真实案例。" },
    { platform: "小红书", topic: "暑期聚餐不踩雷", action: "按人均、菜量、包间、停车、适合学生/家庭做清单型内容。" }
  ];

  return (
    <article className="panel">
      <div className="panel-title">
        <h3>节日提醒和热点灵感</h3>
        <span>未来 30 天 · 后期接数据库和热点接口</span>
      </div>
      <p className="body-copy">
        后期这里由三类数据自动生成：品牌每年固定活动、年度节假日日历、抖音/小红书热点灵感；提前一个月提醒项目总判断是否提报。
      </p>
      <div className="reminder-list">
        {holidayIdeas.map((item) => (
          <div className="reminder-row" key={item.title}>
            <span>{item.date}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.idea}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="hot-topic-grid">
        {hotTopics.map((item) => (
          <div className="hot-topic" key={`${item.platform}-${item.topic}`}>
            <span>{item.platform}</span>
            <strong>{item.topic}</strong>
            <p>{item.action}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function RoleWorkbench({
  activities,
  allActivities,
  tasks,
  designAssets,
  storeAppointments,
  operationSubmissions,
  materialTaskStatuses,
  workView,
  currentUser,
  updateTaskStatus,
  submitLaunchPlan,
  submitDesignUpload,
  submitStoreAppointment,
  confirmStoreAppointment,
  submitOperationSubmission,
  submitOperationCompletionReview,
  approveOperationSubmission,
  rejectOperationSubmission,
  updateMaterialTaskStatus,
  requestDesignForOperation,
  openActivity,
  goProposal,
  goTasks
}: {
  activities: Activity[];
  allActivities: Activity[];
  tasks: Task[];
  designAssets: DesignAsset[];
  storeAppointments: StoreContentAppointment[];
  operationSubmissions: OperationSubmission[];
  materialTaskStatuses: Record<string, MaterialProductionStatus>;
  workView: WorkView;
  currentUser: User;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  submitLaunchPlan: (plan: LaunchPlanInput) => void;
  submitDesignUpload: (input: DesignUploadInput) => void;
  submitStoreAppointment: (input: StoreAppointmentInput) => void;
  confirmStoreAppointment: (appointmentId: string, selectedSlot: string) => void;
  submitOperationSubmission: (input: OperationSubmissionInput) => void;
  submitOperationCompletionReview: (submissionId: string) => void;
  approveOperationSubmission: (submissionId: string, comment?: string) => void;
  rejectOperationSubmission: (submissionId: string, comment?: string) => void;
  updateMaterialTaskStatus: (taskId: string, status: MaterialProductionStatus) => void;
  requestDesignForOperation: (submissionId: string) => void;
  openActivity: (id: string) => void;
  goProposal: () => void;
  goTasks: () => void;
}) {
  const scopeIds = new Set(activities.map((activity) => activity.id));
  const scopedTasks = tasks.filter((task) => scopeIds.has(task.activityId));

  if (workView === "品牌负责人") {
    const ownBrand = getUserDefaultBrand(currentUser);
    const brandActivities = activities.filter((activity) => ownBrand === "全部" || activity.brand === ownBrand);
    const brandActivityIds = new Set(brandActivities.map((activity) => activity.id));
    const pendingOperationReviews = operationSubmissions.filter(
      (submission) =>
        brandActivityIds.has(submission.activityId) &&
        (submission.status === "待项目总审核" ||
          isOperationFinalReview(submission.status))
    );
    const pendingLaunchActivities = brandActivities.filter((activity) => activity.status === "已通过待启动");
    const launchPendingCount = pendingLaunchActivities.length;
    const rejectedProposalCount = brandActivities.filter((activity) => activity.status === "驳回修改").length;
    return (
      <section className="role-workspace">
        {(pendingOperationReviews.length > 0 || launchPendingCount > 0 || rejectedProposalCount > 0) && (
          <div className="approval-alert">
            <span className="approval-alert-icon" aria-hidden>🔔</span>
            <div>
              <strong>有待你处理的事项</strong>
              <p>
                {[
                  pendingOperationReviews.length > 0 && `${pendingOperationReviews.length} 项运营提报待审核/复核`,
                  launchPendingCount > 0 && `${launchPendingCount} 个项目待排期下派`,
                  rejectedProposalCount > 0 && `${rejectedProposalCount} 个提案被老板驳回（到「我的任务」修改重提）`
                ]
                  .filter(Boolean)
                  .join("；")}
                。
              </p>
            </div>
          </div>
        )}
        {launchPendingCount > 0 && (
          <section className="panel">
            <div className="panel-title">
              <h3>审核通过后待排期</h3>
              <span>{launchPendingCount} 个待排期项目</span>
            </div>
            <div className="project-task-list">
              {pendingLaunchActivities.map((activity) => (
                <article className="project-task-card priority" key={activity.id}>
                  <div>
                    <strong>审核通过：填写节点截止日期并分发任务</strong>
                    <span>{activity.name} · {activity.startDate} 至 {activity.endDate}</span>
                    <p>老板已通过项目提案。请到「我的任务」填写各节点截止日期和各部门配合内容后提交分发。</p>
                  </div>
                  <div className="node-actions">
                    <button onClick={() => openActivity(activity.id)}>活动详情</button>
                    <button className="primary" onClick={goTasks}>去我的任务排期下派</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        <OperationApprovalPanel
          title="运营审核和复核"
          subtitle="方案先审核方向，执行完成后由项目总复核节点"
          submissions={pendingOperationReviews}
          activities={activities}
          approveOperationSubmission={approveOperationSubmission}
          rejectOperationSubmission={rejectOperationSubmission}
        />
        <section className="panel">
          <div className="panel-title">
            <h3>{ownBrand === "全部" ? "本品牌" : ownBrand}项目节点进度</h3>
            <button className="primary" onClick={goProposal}>新提报项目</button>
          </div>
          <div className="brand-node-list">
            {brandActivities.map((activity) => {
              const nodes = getMonitorNodes(activity, tasks, designAssets, materialTaskStatuses, operationSubmissions);
              const health = getActivityHealth(nodes);
              const currentNode =
                nodes.find((node) => node.state === "延误") ?? nodes.find((node) => node.state === "进行中") ?? nodes.at(-1);
              const done = nodes.filter((node) => node.state === "已完成").length;
              return (
                <button className="brand-node-row" key={activity.id} onClick={() => openActivity(activity.id)}>
                  <div>
                    <strong>{activity.name}</strong>
                    <span>{activityStatusText(activity.status)} · {activity.startDate} 至 {activity.endDate}</span>
                  </div>
                  <em>{currentNode?.label} · {currentNode?.owner}</em>
                  <b className={`health-pill ${health.className}`}>{health.label}</b>
                  <small>{done}/{nodes.length}</small>
                </button>
              );
            })}
          </div>
        </section>
      </section>
    );
  }

  if (workView === "设计部") {
    const designTasks = scopedTasks.filter((task) => task.type.includes("设计") || task.type.includes("物料"));
    return (
      <DesignerWorkbench
        tasks={designTasks}
        activities={allActivities}
        designAssets={designAssets}
        materialTaskStatuses={materialTaskStatuses}
        submitDesignUpload={submitDesignUpload}
        updateMaterialTaskStatus={updateMaterialTaskStatus}
        openActivity={openActivity}
        updateTaskStatus={updateTaskStatus}
      />
    );
  }

  if (workView === "运营部") {
    const operationTasks = scopedTasks.filter(
      (task) => task.type.includes("内容") || task.type.includes("投流") || task.type.includes("达人")
    );
    return (
      <OperationsWorkbench
        tasks={operationTasks}
        activities={allActivities}
        storeAppointments={storeAppointments}
        operationSubmissions={operationSubmissions}
        submitOperationSubmission={submitOperationSubmission}
        submitOperationCompletionReview={submitOperationCompletionReview}
        requestDesignForOperation={requestDesignForOperation}
        submitStoreAppointment={submitStoreAppointment}
        openActivity={openActivity}
        goTasks={goTasks}
      />
    );
  }

  if (workView === "门店") {
    const storeTasks = scopedTasks.filter((task) => task.owner === currentUser.name || task.type.includes("门店"));
    return (
      <StoreManagerWorkbench
        tasks={storeTasks}
        activities={allActivities}
        appointments={storeAppointments}
        currentUser={currentUser}
        confirmStoreAppointment={confirmStoreAppointment}
        openActivity={openActivity}
        goTasks={goTasks}
      />
    );
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <h3>老板盯办台</h3>
        <span>延误优先</span>
      </div>
      <div className="task-strip">
        {activities
          .map((activity) => ({
            activity,
            health: getActivityHealth(getMonitorNodes(activity, tasks, designAssets, materialTaskStatuses, operationSubmissions))
          }))
          .sort((a, b) => (a.health.className === "danger" ? -1 : b.health.className === "danger" ? 1 : 0))
          .slice(0, 5)
          .map(({ activity, health }) => (
            <button className="task-line" key={activity.id} onClick={() => openActivity(activity.id)}>
              <div>
                <strong>{activity.name}</strong>
                <span>{activity.brand} · {getActivityOwner(activity)} · {activityStatusText(activity.status)}</span>
              </div>
              <b>{health.label}</b>
            </button>
          ))}
      </div>
    </section>
  );
}

function DelayedNodesPanel({
  activities,
  tasks,
  designAssets,
  materialTaskStatuses,
  operationSubmissions,
  openActivity
}: {
  activities: Activity[];
  tasks: Task[];
  designAssets: DesignAsset[];
  materialTaskStatuses: Record<string, MaterialProductionStatus>;
  operationSubmissions: OperationSubmission[];
  openActivity: (id: string) => void;
}) {
  const delayedNodes = activities
    .filter((activity) => activity.status !== "已取消")
    .flatMap((activity) =>
      getMonitorNodes(activity, tasks, designAssets, materialTaskStatuses, operationSubmissions)
        .filter((node) => node.state === "延误")
        .map((node) => ({ activity, node }))
    )
    .sort((a, b) => a.node.dueDate.localeCompare(b.node.dueDate));

  return (
    <section className="panel">
      <div className="panel-title">
        <h3>延误项目节点</h3>
        <span>{delayedNodes.length} 个需要盯办</span>
      </div>
      <div className="delayed-node-list">
        {delayedNodes.length > 0 ? (
          delayedNodes.slice(0, 6).map(({ activity, node }) => (
            <button className="delayed-node-row" key={`${activity.id}-${node.label}`} onClick={() => openActivity(activity.id)}>
              <strong>{node.label}</strong>
              <span>{activity.name}</span>
              <em>{activity.brand} · {node.owner}</em>
              <b>{node.dueDate}</b>
            </button>
          ))
        ) : (
          <p className="body-copy">当前没有延误节点。</p>
        )}
      </div>
    </section>
  );
}

function LaunchPlanPanel({
  activities,
  submitLaunchPlan,
  openActivity
}: {
  activities: Activity[];
  submitLaunchPlan: (plan: LaunchPlanInput) => void;
  openActivity: (id: string) => void;
}) {
  const pendingActivities = activities.filter((activity) => activity.status === "已通过待启动");
  const [selectedActivityId, setSelectedActivityId] = useState(pendingActivities[0]?.id ?? "");
  const selectedActivity = pendingActivities.find((activity) => activity.id === selectedActivityId) ?? pendingActivities[0];
  const [plan, setPlan] = useState<Omit<LaunchPlanInput, "activityId">>(() =>
    selectedActivity ? getDefaultLaunchPlan(selectedActivity) : getEmptyLaunchPlan()
  );

  useEffect(() => {
    if (!selectedActivity) {
      setSelectedActivityId("");
      return;
    }
    if (!pendingActivities.some((activity) => activity.id === selectedActivityId)) {
      setSelectedActivityId(selectedActivity.id);
    }
    setPlan(getDefaultLaunchPlan(selectedActivity));
  }, [selectedActivity?.id]);

  function updatePlan<K extends keyof Omit<LaunchPlanInput, "activityId">>(
    key: K,
    value: Omit<LaunchPlanInput, "activityId">[K]
  ) {
    setPlan((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <h3>通过后排期和任务下派</h3>
        <span>{pendingActivities.length} 个待排期项目</span>
      </div>
      {selectedActivity ? (
        <div className="launch-plan">
          <div className="launch-project-row">
            <label>
              <span>已通过项目</span>
              <select value={selectedActivity.id} onChange={(event) => setSelectedActivityId(event.target.value)}>
                {pendingActivities.map((activity) => (
                  <option value={activity.id} key={activity.id}>{activity.name}</option>
                ))}
              </select>
            </label>
            <button onClick={() => openActivity(selectedActivity.id)}>查看活动</button>
          </div>
          <div className="workflow-steps" aria-label="排期分发流程">
            <span>1. 锁定各节点截止日期</span>
            <span>2. 写清设计和运营交付要求</span>
            <span>3. 分发给设计、运营和门店</span>
          </div>
          <div className="form-section-title">
            <strong>节点截止日期</strong>
            <span>系统会按这些日期跟踪延误节点</span>
          </div>
          <div className="deadline-grid">
            <label>
              <span>启动会/任务下派截止</span>
              <input type="date" value={plan.kickoffDueDate} onChange={(event) => updatePlan("kickoffDueDate", event.target.value)} />
            </label>
            <label>
              <span>设计提交截止</span>
              <input type="date" value={plan.designDueDate} onChange={(event) => updatePlan("designDueDate", event.target.value)} />
            </label>
            <label>
              <span>物料费用/收货截止</span>
              <input type="date" value={plan.materialDueDate} onChange={(event) => updatePlan("materialDueDate", event.target.value)} />
            </label>
            <label>
              <span>运营内容提报截止</span>
              <input type="date" value={plan.contentDueDate} onChange={(event) => updatePlan("contentDueDate", event.target.value)} />
            </label>
            <label>
              <span>门店准备截止</span>
              <input type="date" value={plan.storeDueDate} onChange={(event) => updatePlan("storeDueDate", event.target.value)} />
            </label>
            <label>
              <span>数据回收截止</span>
              <input type="date" value={plan.dataDueDate} onChange={(event) => updatePlan("dataDueDate", event.target.value)} />
            </label>
            <label>
              <span>复盘归档截止</span>
              <input type="date" value={plan.reviewDueDate} onChange={(event) => updatePlan("reviewDueDate", event.target.value)} />
            </label>
          </div>
          <div className="form-section-title">
            <strong>部门交付要求</strong>
            <span>这些内容会写进各部门任务卡</span>
          </div>
          <div className="assignment-groups">
            <section className="assignment-group">
              <h5>项目统筹</h5>
              <div className="assignment-grid">
                <label className="full-span">
                  <span>项目统筹节点要求</span>
                  <textarea rows={3} value={plan.kickoffTaskNote} onChange={(event) => updatePlan("kickoffTaskNote", event.target.value)} />
                </label>
              </div>
            </section>

            <section className="assignment-group">
              <h5>🎨 设计部</h5>
              <div className="assignment-grid">
                <label>
                  <span>设计任务名称</span>
                  <input value={plan.designTaskTitle} onChange={(event) => updatePlan("designTaskTitle", event.target.value)} />
                </label>
                <label>
                  <span>设计用途</span>
                  <input value={plan.designPurpose} onChange={(event) => updatePlan("designPurpose", event.target.value)} />
                </label>
                <label>
                  <span>设计数量</span>
                  <input value={plan.designQuantity} onChange={(event) => updatePlan("designQuantity", event.target.value)} />
                </label>
                <label>
                  <span>设计尺寸</span>
                  <input value={plan.designSizes} onChange={(event) => updatePlan("designSizes", event.target.value)} />
                </label>
                <label className="full-span">
                  <span>定制物料要求</span>
                  <input value={plan.customMaterialRequirement} onChange={(event) => updatePlan("customMaterialRequirement", event.target.value)} />
                </label>
                <label className="full-span">
                  <span>设计部配合内容</span>
                  <textarea rows={3} value={plan.designTaskNote} onChange={(event) => updatePlan("designTaskNote", event.target.value)} />
                </label>
                <label className="full-span">
                  <span>物料和费用配合内容</span>
                  <textarea rows={3} value={plan.materialTaskNote} onChange={(event) => updatePlan("materialTaskNote", event.target.value)} />
                </label>
              </div>
            </section>

            <section className="assignment-group">
              <h5>📣 运营部</h5>
              <div className="assignment-grid">
                <label>
                  <span>运营任务名称</span>
                  <input value={plan.contentTaskTitle} onChange={(event) => updatePlan("contentTaskTitle", event.target.value)} />
                </label>
                <label>
                  <span>短视频数量</span>
                  <input value={plan.shortVideoCount} onChange={(event) => updatePlan("shortVideoCount", event.target.value)} />
                </label>
                <label>
                  <span>直播场次</span>
                  <input value={plan.liveSessionCount} onChange={(event) => updatePlan("liveSessionCount", event.target.value)} />
                </label>
                <label>
                  <span>达人要求</span>
                  <input value={plan.influencerRequirement} onChange={(event) => updatePlan("influencerRequirement", event.target.value)} />
                </label>
                <label>
                  <span>达人平台</span>
                  <input value={plan.influencerPlatform} onChange={(event) => updatePlan("influencerPlatform", event.target.value)} />
                </label>
                <label>
                  <span>达人预算</span>
                  <input value={plan.influencerBudget} onChange={(event) => updatePlan("influencerBudget", event.target.value)} />
                </label>
                <label className="full-span">
                  <span>运营部配合内容</span>
                  <textarea rows={3} value={plan.operationTaskNote} onChange={(event) => updatePlan("operationTaskNote", event.target.value)} />
                </label>
              </div>
            </section>

            <section className="assignment-group">
              <h5>🏪 门店</h5>
              <div className="assignment-grid">
                <label className="full-span">
                  <span>门店配合内容</span>
                  <textarea rows={3} value={plan.storeTaskNote} onChange={(event) => updatePlan("storeTaskNote", event.target.value)} />
                </label>
              </div>
            </section>

            <section className="assignment-group">
              <h5>📊 数据与复盘</h5>
              <div className="assignment-grid">
                <label className="full-span">
                  <span>数据回收要求</span>
                  <textarea rows={3} value={plan.dataTaskNote} onChange={(event) => updatePlan("dataTaskNote", event.target.value)} />
                </label>
                <label className="full-span">
                  <span>复盘归档要求</span>
                  <textarea rows={3} value={plan.reviewTaskNote} onChange={(event) => updatePlan("reviewTaskNote", event.target.value)} />
                </label>
              </div>
            </section>
          </div>
          <button
            className="primary submit-proposal"
            onClick={() => submitLaunchPlan({ activityId: selectedActivity.id, ...plan })}
          >
            提交拆解并分发任务
          </button>
        </div>
      ) : (
        <p className="body-copy">目前没有老板已通过、待项目总排期的项目。</p>
      )}
    </section>
  );
}

function getEmptyLaunchPlan(): Omit<LaunchPlanInput, "activityId"> {
  return {
    kickoffDueDate: TODAY,
    designDueDate: TODAY,
    materialDueDate: TODAY,
    contentDueDate: TODAY,
    storeDueDate: TODAY,
    dataDueDate: TODAY,
    reviewDueDate: TODAY,
    designTaskTitle: "活动主视觉、菜单和门店物料设计",
    contentTaskTitle: "短视频、直播、达人和投流节点提报",
    designPurpose: "门店海报、菜单夹页、抖音商家页、社群转发图和门店物料。",
    designQuantity: "海报 2 张、菜单 2 张、平台图 3 张。",
    designSizes: "A2 海报、A4 菜单、1:1 团购封面、9:16 短视频封面。",
    customMaterialRequirement: "桌面台卡、门店海报、领取清单和到货验收照片。",
    shortVideoCount: "3 条",
    influencerRequirement: "邀请 2 位本地探店达人，先提交报价和账号数据。",
    influencerPlatform: "抖音/小红书",
    influencerBudget: "8000 元以内",
    liveSessionCount: "2 场",
    kickoffTaskNote: "项目总确认活动目标、参与门店、节点截止日期、跨部门负责人和数据回收口径，并完成任务分发。",
    designTaskNote: "设计部提交主视觉、海报、菜单、门店物料和平台展示图；设计画面需项目总审核通过后进入物料制作。",
    materialTaskNote: "设计部记录物料供应商、报价、下单时间、预计到货时间和实际费用；报价用于项目留档。",
    operationTaskNote: "运营部按项目要求提报短视频计划、直播计划、达人联系名单和投流节点回报；不需要的动作标记为本项目不执行。",
    storeTaskNote: "店长完成员工培训、物料摆放拍照、现场执行反馈，并在活动期每天填报对应商品销售数据。",
    dataTaskNote: "项目总跟进各门店活动营业额、团购或套餐销量、客流、现场照片和问题反馈。",
    reviewTaskNote: "项目总汇总门店数据、营销数据、费用数据和执行问题，形成活动复盘和下一年度建议。"
  };
}

function getDefaultLaunchPlan(activity: Activity): Omit<LaunchPlanInput, "activityId"> {
  return {
    kickoffDueDate: activity.prepStartDate,
    designDueDate: addDays(activity.startDate, -14),
    materialDueDate: addDays(activity.startDate, -8),
    contentDueDate: addDays(activity.startDate, -7),
    storeDueDate: addDays(activity.startDate, -3),
    dataDueDate: addDays(activity.endDate, 2),
    reviewDueDate: addDays(activity.endDate, 7),
    designTaskTitle: `${activity.name}主视觉、菜单和门店物料设计`,
    contentTaskTitle: `${activity.name}短视频、直播、达人和投流提报`,
    designPurpose: `${activity.name}门店露出、平台售卖页、菜单夹页和社群传播。`,
    designQuantity: "海报 2 张、菜单 2 张、平台图 3 张，可按活动调整。",
    designSizes: "A2 海报、A4 菜单、1:1 团购封面、9:16 短视频封面。",
    customMaterialRequirement: "如需台卡、展架、礼盒贴纸或定制物料，请设计部填报价并提交审批。",
    shortVideoCount: "3 条",
    influencerRequirement: "按项目需要邀请本地探店达人；不需要则填写本项目不执行。",
    influencerPlatform: "抖音/小红书",
    influencerBudget: "按项目预算控制",
    liveSessionCount: "1-2 场",
    kickoffTaskNote: `项目总确认${activity.name}的目标、门店、预算、节点截止日期、跨部门负责人和数据回收口径，并完成任务分发。`,
    designTaskNote: `设计部提交${activity.name}所需主视觉、海报、菜单、门店物料和平台展示图；设计画面需项目总审核通过后进入物料制作。`,
    materialTaskNote: "设计部记录物料供应商、报价、下单时间、预计到货时间和实际费用；报价用于项目留档。",
    operationTaskNote: "短视频、直播、达人邀请和投流按本项目需求提报；如不需要执行某项，运营需在节点回报中说明原因。",
    storeTaskNote: "店长完成员工培训、物料摆放拍照、现场执行反馈，并在活动期每天填报对应商品销售数据。",
    dataTaskNote: "项目总跟进各门店活动营业额、团购或套餐销量、客流、现场照片和问题反馈。",
    reviewTaskNote: "项目总汇总门店数据、营销数据、费用数据和执行问题，形成活动复盘和下一年度建议。"
  };
}

// 关键规格类字段：让设计/运营一眼抓到数量、尺寸、场次、预算等硬指标。
const HIGHLIGHT_SPEC_KEYS = ["数量", "尺寸", "场次", "预算", "条数", "张数", "份数", "时长"];

// 把任务说明（\n 分隔的「键：值」文本）渲染成结构化分行：
// 规格类键高亮突出，其它键加粗，说明文字淡化，便于快速看清要求。
function TaskStandard({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <div className="task-standard">
      {lines.map((line, index) => {
        const sep = line.indexOf("：");
        if (sep > 0 && sep <= 8) {
          const key = line.slice(0, sep);
          const isSpec = HIGHLIGHT_SPEC_KEYS.some((spec) => key.includes(spec));
          return (
            <p className={isSpec ? "kv spec" : "kv"} key={index}>
              <b>{key}</b>
              <span>{line.slice(sep + 1)}</span>
            </p>
          );
        }
        return (
          <p className="note" key={index}>
            {line}
          </p>
        );
      })}
    </div>
  );
}

function DesignerWorkbench({
  tasks,
  activities,
  designAssets,
  materialTaskStatuses,
  submitDesignUpload,
  updateMaterialTaskStatus,
  openActivity,
  updateTaskStatus
}: {
  tasks: Task[];
  activities: Activity[];
  designAssets: DesignAsset[];
  materialTaskStatuses: Record<string, MaterialProductionStatus>;
  submitDesignUpload: (input: DesignUploadInput) => void;
  updateMaterialTaskStatus: (taskId: string, status: MaterialProductionStatus) => void;
  openActivity: (id: string) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
}) {
  const [quotes, setQuotes] = useState<MaterialQuote[]>([
    {
      id: "mq1",
      activityId: "a1",
      taskTitle: "端午台卡物料制作",
      supplier: "忻州快印工场",
      materialName: "桌面台卡",
      deadline: "2026-06-18",
      amount: 18500,
      note: "200 套台卡，含加急制作和同城配送。",
      status: "已记录"
    }
  ]);
  const designTasks = tasks.filter((task) => task.type.includes("设计"));
  const materialTasks = tasks.filter((task) => task.type.includes("物料"));
  const assignedActivityIds = new Set(tasks.map((task) => task.activityId));
  const assignedActivities = activities.filter((activity) => assignedActivityIds.has(activity.id));
  const uploadActivities = assignedActivities.length > 0 ? assignedActivities : activities;
  const [uploadDialogActivityId, setUploadDialogActivityId] = useState<string | null>(null);
  const activeDesignOrders = designTasks.filter((task) => task.status !== "已完成").length;
  const reviewingAssets = designAssets.filter((asset) => asset.status === "待老板审核").length;
  const materialInProgress = materialTasks.filter(
    (task) => getMaterialProductionStatus(task, materialTaskStatuses) !== "物料到货"
  ).length;
  const urgentTasks = tasks.filter((task) => task.status !== "已完成" && daysBetween(TODAY, task.dueDate) <= 3).length;

  return (
    <section className="role-workspace designer-workbench">
      <section className="panel designer-focus-panel">
        <div>
          <p className="eyebrow">设计工作台</p>
          <h3>按工作流推进设计单</h3>
          <span>接单后先标记开始制作，提交项目总审核；通过后安排物料制作，到货后自动通知门店店长领取。</span>
        </div>
        <div className="designer-focus-stats">
          <article><span>待推进</span><strong>{activeDesignOrders}</strong></article>
          <article><span>审核中</span><strong>{reviewingAssets}</strong></article>
          <article><span>物料中</span><strong>{materialInProgress}</strong></article>
          <article><span>临期</span><strong>{urgentTasks}</strong></article>
        </div>
      </section>

      <div className="designer-workspace-grid">
        <div className="designer-main-column">
          <DesignerWorkflowPanel
            designTasks={designTasks}
            materialTasks={materialTasks}
            activities={activities}
            designAssets={designAssets}
            materialTaskStatuses={materialTaskStatuses}
            updateTaskStatus={updateTaskStatus}
            updateMaterialTaskStatus={updateMaterialTaskStatus}
            requestUpload={(activityId) => setUploadDialogActivityId(activityId)}
            openActivity={openActivity}
          />
        </div>

        <aside className="designer-side-column">
          <DesignerDeadlineChart tasks={tasks} activities={activities} />
          <MaterialQuotePanel
            materialTasks={materialTasks}
            activities={activities}
            quotes={quotes}
            submitQuote={(quote) => setQuotes((current) => [{ ...quote, id: `mq${current.length + 1}` }, ...current])}
            openActivity={openActivity}
          />
        </aside>
      </div>

      {uploadDialogActivityId !== null && (
        <DesignUploadPanel
          asDialog
          activities={uploadActivities}
          selectedActivityId={uploadDialogActivityId}
          submitDesignUpload={submitDesignUpload}
          onClose={() => setUploadDialogActivityId(null)}
        />
      )}
    </section>
  );
}

function DesignerWorkflowPanel({
  designTasks,
  materialTasks,
  activities,
  designAssets,
  materialTaskStatuses,
  updateTaskStatus,
  updateMaterialTaskStatus,
  requestUpload,
  openActivity
}: {
  designTasks: Task[];
  materialTasks: Task[];
  activities: Activity[];
  designAssets: DesignAsset[];
  materialTaskStatuses: Record<string, MaterialProductionStatus>;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  updateMaterialTaskStatus: (taskId: string, status: MaterialProductionStatus) => void;
  requestUpload: (activityId: string) => void;
  openActivity: (id: string) => void;
}) {
  return (
    <section className="panel operation-flow-panel">
      <div className="panel-title">
        <h3>设计单工作流</h3>
        <span>不手动完成节点，按设计稿审批和物料到货推进</span>
      </div>
      <div className="operation-flow-list">
        {designTasks.length > 0 ? (
          designTasks.map((task) => (
            <DesignerWorkflowCard
              task={task}
              materialTask={materialTasks.find((item) => item.activityId === task.activityId)}
              activity={activities.find((item) => item.id === task.activityId)}
              latestAsset={getLatestDesignAsset(task.activityId, designAssets)}
              designApproved={isActivityDesignApproved(task.activityId, designAssets)}
              materialTaskStatuses={materialTaskStatuses}
              updateTaskStatus={updateTaskStatus}
              updateMaterialTaskStatus={updateMaterialTaskStatus}
              requestUpload={requestUpload}
              openActivity={openActivity}
              key={task.id}
            />
          ))
        ) : (
          <p className="body-copy">暂时没有项目总派发的设计单。</p>
        )}
      </div>
    </section>
  );
}

function DesignerWorkflowCard({
  task,
  materialTask,
  activity,
  latestAsset,
  designApproved,
  materialTaskStatuses,
  updateTaskStatus,
  updateMaterialTaskStatus,
  requestUpload,
  openActivity
}: {
  task: Task;
  materialTask?: Task;
  activity?: Activity;
  latestAsset?: DesignAsset;
  designApproved: boolean;
  materialTaskStatuses: Record<string, MaterialProductionStatus>;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  updateMaterialTaskStatus: (taskId: string, status: MaterialProductionStatus) => void;
  requestUpload: (activityId: string) => void;
  openActivity: (id: string) => void;
}) {
  const materialStatus = materialTask ? getMaterialProductionStatus(materialTask, materialTaskStatuses) : undefined;
  const materialArrived = materialStatus === "物料到货";
  const reviewing = latestAsset?.status === "待老板审核";
  const rejected = latestAsset?.status === "驳回修改";
  const started = task.status === "进行中" || task.status === "已完成" || Boolean(latestAsset);
  const canStart = task.status !== "进行中" && task.status !== "已完成";
  const canSubmit = started && !reviewing && !designApproved;
  const nextMaterialStatus = materialStatus ? getNextMaterialProductionStatus(materialStatus) : "未开始";
  const flowSteps = [
    { label: "接到设计单", detail: task.dueDate, state: "done" },
    {
      label: "开始制作",
      detail: task.status === "进行中" ? "设计中" : task.status,
      state: started ? "done" : "active"
    },
    {
      label: "项目总审核",
      detail: reviewing ? "审核中" : rejected ? "已驳回" : designApproved ? "已通过" : "待提交",
      state: designApproved ? "done" : reviewing ? "active" : rejected ? "blocked" : "todo"
    },
    {
      label: "物料制作",
      detail: materialTask ? materialStatus ?? "未开始" : "无物料任务",
      state: !materialTask ? "todo" : materialArrived ? "done" : designApproved ? "active" : "todo"
    },
    {
      label: "门店领取",
      detail: materialArrived ? "已通知店长" : "待到货",
      state: materialArrived ? "done" : "todo"
    }
  ];

  return (
    <article className={`operation-flow-card ${reviewing ? "reviewing" : rejected ? "blocked" : materialArrived ? "done" : ""}`}>
      <div className="operation-flow-head">
        <div>
          <strong>{task.title}</strong>
          <span>{activity?.brand ?? "未匹配品牌"} · {activity?.name ?? "未匹配活动"} · 截止 {task.dueDate}</span>
          <TaskStandard text={task.standard} />
        </div>
        <b>{materialArrived ? "设计节点完成" : reviewing ? "待项目总审核" : rejected ? "需修改" : designApproved ? "设计稿已通过" : task.status}</b>
      </div>

      <div className="operation-flow-steps">
        {flowSteps.map((step) => (
          <div className={`operation-flow-step ${step.state}`} key={step.label}>
            <i />
            <strong>{step.label}</strong>
            <span>{step.detail}</span>
          </div>
        ))}
      </div>

      {materialTask && (
        <div className="designer-material-inline">
          <div>
            <strong>{materialTask.title}</strong>
            <span>到货截止 {materialTask.dueDate}</span>
          </div>
          <label className="material-step-select">
            <span>物料状态</span>
            <select
              value={materialStatus ?? "未开始"}
              disabled={!designApproved || materialArrived}
              onChange={(event) => {
                const next = event.target.value as MaterialProductionStatus;
                if (next === "物料到货") {
                  requestMaterialArrival(materialTask.id);
                } else {
                  updateMaterialTaskStatus(materialTask.id, next);
                }
              }}
            >
              {materialProductionSteps.map((step) => (
                <option key={step} value={step}>{step}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="operation-flow-actions">
        <small>
          {materialArrived
            ? "物料已到货，系统会生成门店领取任务"
            : reviewing
              ? "设计稿已提交，等待项目总审核"
              : rejected
                ? "按项目总意见修改后重新提交"
                : designApproved
                  ? materialTask ? `下一步：推进物料到${nextMaterialStatus}` : "设计稿已通过"
                  : started ? "下一步：提交设计稿给项目总审核" : "下一步：标记开始制作"}
        </small>
        <div className="node-actions">
          <button onClick={() => openActivity(task.activityId)}>活动详情</button>
          <button className={canStart ? "primary" : ""} disabled={!canStart} onClick={() => updateTaskStatus(task.id, "进行中")}>
            {task.status === "进行中" ? "制作中" : task.status === "已完成" ? "制作已提交" : "标记开始制作"}
          </button>
          <button disabled={!canSubmit} onClick={() => requestUpload(task.activityId)}>
            {reviewing ? "项目总审核中" : rejected ? "重新提交审核" : designApproved ? "审核已通过" : "提交项目总审核"}
          </button>
        </div>
      </div>
    </article>
  );
}

function DesignerDeadlineChart({ tasks, activities }: { tasks: Task[]; activities: Activity[] }) {
  const deadlineRows = tasks
    .filter((task) => task.status !== "已完成")
    .map((task) => {
      const daysLeft = daysBetween(TODAY, task.dueDate);
      const activity = activities.find((item) => item.id === task.activityId);
      const urgency = daysLeft < 0 ? "overdue" : daysLeft <= 3 ? "soon" : "normal";
      return {
        task,
        activity,
        daysLeft,
        urgency,
        width: `${Math.max(8, Math.min(100, 100 - Math.max(daysLeft, 0) * 12))}%`
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 6);

  return (
    <section className="panel">
      <div className="panel-title">
        <h3>临期任务提醒</h3>
        <span>按截止日期排序</span>
      </div>
      <div className="designer-deadline-chart">
        {deadlineRows.length > 0 ? (
          deadlineRows.map(({ task, activity, daysLeft, urgency, width }) => (
            <div className={`deadline-chart-row ${urgency}`} key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <span>{activity?.name} · {task.type} · 截止 {task.dueDate}</span>
              </div>
              <div className="deadline-bar">
                <i style={{ width }} />
              </div>
              <b>{daysLeft < 0 ? `逾期 ${Math.abs(daysLeft)} 天` : daysLeft === 0 ? "今天截止" : `${daysLeft} 天后`}</b>
            </div>
          ))
        ) : (
          <p className="body-copy">当前没有临近截止的设计任务。</p>
        )}
      </div>
    </section>
  );
}

function MaterialQuotePanel({
  materialTasks,
  activities,
  quotes,
  submitQuote,
  openActivity
}: {
  materialTasks: Task[];
  activities: Activity[];
  quotes: MaterialQuote[];
  submitQuote: (quote: Omit<MaterialQuote, "id">) => void;
  openActivity: (id: string) => void;
}) {
  const [taskId, setTaskId] = useState(materialTasks[0]?.id ?? "");
  const selectedTask = materialTasks.find((task) => task.id === taskId) ?? materialTasks[0];
  const selectedActivity = activities.find((activity) => activity.id === selectedTask?.activityId);
  const [supplier, setSupplier] = useState("忻州快印工场");
  const [materialName, setMaterialName] = useState("桌面台卡 / 门店海报");
  const [deadline, setDeadline] = useState(selectedTask?.dueDate ?? TODAY);
  const [amount, setAmount] = useState(12000);
  const [note, setNote] = useState("包含设计文件制作、打样、印刷和同城配送。");

  useEffect(() => {
    if (!selectedTask) return;
    setDeadline(selectedTask.dueDate);
  }, [selectedTask?.id]);

  const canSubmit = Boolean(selectedTask && supplier.trim() && materialName.trim() && amount > 0);

  return (
    <section className="panel">
      <div className="panel-title">
        <h3>供应商和报价记录</h3>
        <span>只做留档，不再走项目总审核</span>
      </div>

      <div className="material-quote-layout">
        <div className="material-quote-form">
          <label>
            <span>物料任务</span>
            <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
              {materialTasks.map((task) => {
                const activity = activities.find((item) => item.id === task.activityId);
                return <option value={task.id} key={task.id}>{activity?.name} · {task.title}</option>;
              })}
            </select>
          </label>
          <label>
            <span>供应商</span>
            <input value={supplier} onChange={(event) => setSupplier(event.target.value)} />
          </label>
          <label>
            <span>物料名称</span>
            <input value={materialName} onChange={(event) => setMaterialName(event.target.value)} />
          </label>
          <label>
            <span>制作/到货截止</span>
            <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
          </label>
          <label>
            <span>报价金额</span>
            <input inputMode="numeric" value={amount} onChange={(event) => setAmount(Number(event.target.value) || 0)} />
          </label>
          <label className="full-span">
            <span>报价说明</span>
            <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <div className="node-actions full-span">
            {selectedTask && <button onClick={() => openActivity(selectedTask.activityId)}>活动</button>}
            <button
              className="primary"
              disabled={!canSubmit}
              onClick={() =>
                selectedTask &&
                submitQuote({
                  activityId: selectedTask.activityId,
                  taskTitle: selectedTask.title,
                  supplier,
                  materialName,
                  deadline,
                  amount,
                  note,
                  status: "已记录"
                })
              }
            >
              保存报价记录
            </button>
          </div>
        </div>
        <div className="material-quote-list">
          {quotes.map((quote) => {
            const activity = activities.find((item) => item.id === quote.activityId);
            return (
              <article className="material-quote-card" key={quote.id}>
                <strong>{quote.materialName}</strong>
                <span>{activity?.name} · {quote.supplier}</span>
                <em>截止 {quote.deadline}</em>
                <b>{yuan(quote.amount)}</b>
                <small>{quote.status}</small>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function OperationApprovalPanel({
  title,
  subtitle,
  submissions,
  activities,
  approveOperationSubmission,
  rejectOperationSubmission
}: {
  title: string;
  subtitle: string;
  submissions: OperationSubmission[];
  activities: Activity[];
  approveOperationSubmission: (submissionId: string, comment?: string) => void;
  rejectOperationSubmission: (submissionId: string, comment?: string) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </div>
      <div className="operation-approval-list">
        {submissions.length > 0 ? submissions.map((submission) => {
          const activity = activities.find((item) => item.id === submission.activityId);
          const finalReview = isOperationFinalReview(submission.status);
          return (
            <article className="operation-approval-card" key={submission.id}>
              <div>
                <span>{submission.type}</span>
                <strong>{submission.title}</strong>
                <em>{activity?.brand} · {activity?.name} · {submission.owner} · {submission.status}</em>
              </div>
              <p>{submission.contentPlan}</p>
              <small>对标：{submission.benchmarkLinks}</small>
              {submission.budget ? <b>{yuan(submission.budget)}</b> : null}
              {finalReview && (
                <small className="wechat-remind">
                  💬 请先在微信查看运营提交的视频/素材，确认无误后再点「复核通过，节点完成」。
                </small>
              )}
              <div className="node-actions">
                <button
                  className="primary"
                  onClick={() =>
                    approveOperationSubmission(
                      submission.id,
                      finalReview ? "项目总复核通过，运营节点完成。" : "项目总审核通过，可以进入下一步。"
                    )
                  }
                >
                  {finalReview ? "复核通过，节点完成" : "通过"}
                </button>
                <button onClick={() => rejectOperationSubmission(submission.id)}>
                  {finalReview ? "退回补充结果" : "驳回修改"}
                </button>
              </div>
            </article>
          );
        }) : (
            <p className="body-copy">暂时没有运营提报需要审核。</p>
        )}
      </div>
    </section>
  );
}

function OperationsWorkbench({
  tasks,
  activities,
  storeAppointments,
  operationSubmissions,
  submitOperationSubmission,
  submitOperationCompletionReview,
  requestDesignForOperation,
  submitStoreAppointment,
  openActivity,
  goTasks
}: {
  tasks: Task[];
  activities: Activity[];
  storeAppointments: StoreContentAppointment[];
  operationSubmissions: OperationSubmission[];
  submitOperationSubmission: (input: OperationSubmissionInput) => void;
  submitOperationCompletionReview: (submissionId: string) => void;
  requestDesignForOperation: (submissionId: string) => void;
  submitStoreAppointment: (input: StoreAppointmentInput) => void;
  openActivity: (id: string) => void;
  goTasks: () => void;
}) {
  const activeTasks = tasks.filter((task) => task.status !== "已完成");
  const rejectedSubmissions = operationSubmissions.filter((item) => item.status === "驳回修改");
  const pendingReview = operationSubmissions.filter((item) => item.status === "待项目总审核");
  const approvedBookable = operationSubmissions.filter(
    (item) => item.status === "审核通过可执行" && (item.type === "短视频计划" || item.type === "直播计划")
  );
  const finalReview = operationSubmissions.filter((item) => item.status === "执行完成待项目总复核");
  const adReview = operationSubmissions.filter(
    (item) => item.type === "投流计划" && !isOperationComplete(item.status) && item.status !== "驳回修改"
  );
  const [appointmentActivityId, setAppointmentActivityId] = useState<string | null>(null);

  useEffect(() => {
    function onOpenAppointment(event: Event) {
      setAppointmentActivityId((event as CustomEvent<string>).detail ?? "");
    }
    window.addEventListener("app:store-appointment", onOpenAppointment);
    return () => window.removeEventListener("app:store-appointment", onOpenAppointment);
  }, []);

  return (
    <section className="role-workspace operation-workbench">
      {rejectedSubmissions.length > 0 && (
        <div className="approval-alert">
          <span className="approval-alert-icon" aria-hidden>🔔</span>
          <div>
            <strong>有 {rejectedSubmissions.length} 项提报被项目总驳回</strong>
            <p>请到左侧「我的任务」按项目总意见修改后重新提交。</p>
          </div>
        </div>
      )}
      <section className="panel operation-focus-panel">
        <div>
          <p className="eyebrow">运营工作台</p>
          <h3>按项目要求提报、预约和回传结果</h3>
          <span>接到项目总任务后先提报计划；方案通过后预约门店；拍摄、直播或投流执行完毕后交项目总复核。</span>
        </div>
        <div className="designer-focus-stats">
          <article><span>派发任务</span><strong>{activeTasks.length}</strong></article>
          <article><span>待审方案</span><strong>{pendingReview.length}</strong></article>
          <article><span>可预约</span><strong>{approvedBookable.length}</strong></article>
          <article><span>待复核</span><strong>{finalReview.length}</strong></article>
          <article><span>投流相关</span><strong>{adReview.length}</strong></article>
        </div>
      </section>

      <OperationWorkflowPanel
        tasks={tasks}
        activities={activities}
        appointments={storeAppointments}
        operationSubmissions={operationSubmissions}
        focusSubmission={() => goTasks()}
        submitOperationCompletionReview={submitOperationCompletionReview}
        openActivity={openActivity}
      />

      <OperationReviewPipelinePanel
        activities={activities}
        appointments={storeAppointments}
        operationSubmissions={operationSubmissions}
        requestDesignForOperation={requestDesignForOperation}
        submitOperationCompletionReview={submitOperationCompletionReview}
        openActivity={openActivity}
      />

      {appointmentActivityId !== null && (
        <StoreAppointmentDialog
          initialActivityId={appointmentActivityId}
          activities={activities}
          operationSubmissions={operationSubmissions}
          submitStoreAppointment={submitStoreAppointment}
          onClose={() => setAppointmentActivityId(null)}
        />
      )}
    </section>
  );
}

function OperationWorkflowPanel({
  tasks,
  activities,
  appointments,
  operationSubmissions,
  focusSubmission,
  submitOperationCompletionReview,
  openActivity
}: {
  tasks: Task[];
  activities: Activity[];
  appointments: StoreContentAppointment[];
  operationSubmissions: OperationSubmission[];
  focusSubmission?: (activityId: string) => void;
  submitOperationCompletionReview: (submissionId: string) => void;
  openActivity: (id: string) => void;
}) {
  const activeTasks = tasks
    .filter((task) => task.status !== "已完成")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return (
    <section className="panel operation-flow-panel">
      <div className="panel-title">
        <h3>运营任务工作流</h3>
        <span>不手动完成，最终由项目总复核</span>
      </div>
      <div className="operation-flow-list">
        {activeTasks.length > 0 ? activeTasks.map((task) => {
          const activity = activities.find((item) => item.id === task.activityId);
          const submissions = operationSubmissions.filter((submission) => submission.activityId === task.activityId);
          const approvedSubmission = submissions.find((submission) => submission.status === "审核通过可执行");
          const waitingDirectionReview = submissions.some(
            (submission) => submission.status === "待项目总审核"
          );
          const waitingFinalReview = submissions.some((submission) => isOperationFinalReview(submission.status));
          const hasRejected = submissions.some((submission) => submission.status === "驳回修改");
          const completed = submissions.length > 0 && submissions.every((submission) => isOperationComplete(submission.status));
          const activityAppointments = appointments.filter((appointment) => appointment.activityId === task.activityId);
          const confirmedAppointment = activityAppointments.some((appointment) => appointment.status === "已确认");
          const needsAppointment = approvedSubmission ? needsStoreAppointment(approvedSubmission.type) : false;
          const canSubmitFinalReview = Boolean(approvedSubmission && (!needsAppointment || confirmedAppointment));
          const flowSteps = [
            { label: "接收任务", detail: `截止 ${task.dueDate}`, state: "done" },
            {
              label: "提报计划",
              detail: submissions.length > 0 ? `${submissions.length} 个方案` : "待填写",
              state: submissions.length > 0 ? "done" : "active"
            },
            {
              label: "方案审核",
              detail: hasRejected ? "退回修改" : waitingDirectionReview ? "审核中" : submissions.length > 0 ? "已通过" : "未提交",
              state: hasRejected ? "blocked" : waitingDirectionReview ? "active" : submissions.length > 0 ? "done" : "todo"
            },
            {
              label: "预约/执行",
              detail: needsAppointment
                ? confirmedAppointment ? "门店已确认" : "待门店确认"
                : approvedSubmission ? "可执行" : "待审核通过",
              state: completed || waitingFinalReview ? "done" : approvedSubmission ? "active" : "todo"
            },
            {
              label: "项目总复核",
              detail: completed ? "已完成" : waitingFinalReview ? "等待复核" : "待回传结果",
              state: completed ? "done" : waitingFinalReview ? "active" : "todo"
            }
          ];

          return (
            <article className={`operation-flow-card ${hasRejected ? "blocked" : waitingFinalReview ? "reviewing" : completed ? "done" : ""}`} key={task.id}>
              <div className="operation-flow-head">
                <div>
                  <strong>{task.title}</strong>
                  <span>{activity?.brand} · {activity?.name} · {task.type}</span>
                  <TaskStandard text={task.standard} />
                </div>
                <b>{completed ? "运营节点完成" : waitingFinalReview ? "待项目总复核" : task.status}</b>
              </div>

              <div className="operation-flow-steps">
                {flowSteps.map((step) => (
                  <div className={`operation-flow-step ${step.state}`} key={step.label}>
                    <i />
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                ))}
              </div>

              <div className="operation-flow-actions">
                <small>
                  {approvedSubmission
                    ? `${approvedSubmission.type} · ${approvedSubmission.title}`
                    : submissions[0]
                      ? `${submissions[0].type} · ${submissions[0].status}`
                      : "先在下方提交短视频、直播、达人或投流计划"}
                </small>
                <div className="node-actions">
                  {activity && <button onClick={() => openActivity(activity.id)}>活动详情</button>}
                  {approvedSubmission && canSubmitFinalReview ? (
                    <button className="primary" onClick={() => submitOperationCompletionReview(approvedSubmission.id)}>
                      执行完成，交项目总复核
                    </button>
                  ) : activity && submissions.length === 0 && focusSubmission ? (
                    <button className="primary" onClick={() => focusSubmission(activity.id)}>
                      去提报这个项目
                    </button>
                  ) : (
                    <button disabled>
                      {completed
                        ? "节点已完成"
                        : waitingFinalReview
                          ? "等待项目总复核"
                          : approvedSubmission && needsAppointment && !confirmedAppointment
                            ? "待店长确认预约"
                            : hasRejected
                              ? "按意见修改后重提"
                              : submissions.length > 0
                                ? "等待审核通过"
                                : "先提交计划"}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        }) : (
          <p className="body-copy">暂时没有项目总派发给运营的任务。</p>
        )}
      </div>
    </section>
  );
}

function OperationSubmissionPanel({
  activities,
  tasks,
  appointments,
  operationSubmissions,
  selectedActivityId,
  setSelectedActivityId,
  submitOperationSubmission,
  submitOperationCompletionReview,
  requestDesignForOperation
}: {
  activities: Activity[];
  tasks: Task[];
  appointments: StoreContentAppointment[];
  operationSubmissions: OperationSubmission[];
  selectedActivityId: string;
  setSelectedActivityId: (activityId: string) => void;
  submitOperationSubmission: (input: OperationSubmissionInput) => void;
  submitOperationCompletionReview: (submissionId: string) => void;
  requestDesignForOperation: (submissionId: string) => void;
}) {
  const operationTasks = tasks
    .filter((task) => task.type.includes("内容") || task.type.includes("投流") || task.type.includes("达人"))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const operationProjectIds = new Set([
    ...operationTasks.map((task) => task.activityId),
    ...operationSubmissions.map((submission) => submission.activityId)
  ]);
  const focusedActivities = activities.filter(
    (activity) => operationProjectIds.has(activity.id) && activity.status !== "已取消"
  );
  const availableActivities = focusedActivities.length > 0
    ? focusedActivities
    : activities.filter((activity) => activity.status !== "已取消");
  const [type, setType] = useState<OperationSubmission["type"]>("短视频计划");
  const [title, setTitle] = useState("活动短视频内容计划");
  const [benchmarkLinks, setBenchmarkLinks] = useState("抖音/小红书对标链接或账号：");
  const [contentPlan, setContentPlan] = useState("内容结构、拍摄场景、门店配合、发布时间和预期结果。");
  const [budget, setBudget] = useState(8000);
  const [needDesign, setNeedDesign] = useState(false);
  const [designRequest, setDesignRequest] = useState("直播商品图：套餐卖点、价格权益、门店信息。");
  const selectedActivity =
    availableActivities.find((activity) => activity.id === selectedActivityId) ?? availableActivities[0];
  const selectedTask = selectedActivity
    ? operationTasks.find((task) => task.activityId === selectedActivity.id && task.status !== "已完成") ??
      operationTasks.find((task) => task.activityId === selectedActivity.id)
    : undefined;
  const selectedStores = selectedActivity
    ? stores.filter((store) => selectedActivity.storeIds.includes(store.id))
    : [];
  const needsBudget = type === "投流计划" || type === "达人邀请";
  // 同一项目、同一类型若已有「未驳回且未完成」的提报（即还在审核或执行中），
  // 不允许重复提交，避免一个提案没审核就提交多份。
  const duplicateSubmission = operationSubmissions.find(
    (submission) =>
      submission.activityId === selectedActivity?.id &&
      submission.type === type &&
      submission.status !== "驳回修改" &&
      submission.status !== "执行复核通过"
  );
  const canSubmit = Boolean(
    selectedActivity && title.trim() && benchmarkLinks.trim() && contentPlan.trim() && !duplicateSubmission
  );
  const operationTypes: OperationSubmission["type"][] = ["短视频计划", "直播计划", "投流计划", "达人邀请"];

  useEffect(() => {
    if (availableActivities.length > 0 && !availableActivities.some((activity) => activity.id === selectedActivityId)) {
      setSelectedActivityId(availableActivities[0].id);
    }
  }, [availableActivities, selectedActivityId, setSelectedActivityId]);

  useEffect(() => {
    const prefix = selectedActivity?.name ?? "活动";
    if (type === "直播计划") {
      setTitle(`${prefix}直播计划和门店配合方案`);
    } else if (type === "投流计划") {
      setTitle(`${prefix}抖音平台投流计划`);
    } else if (type === "达人邀请") {
      setTitle(`${prefix}达人邀请名单和合作计划`);
    } else {
      setTitle(`${prefix}短视频内容计划`);
    }
  }, [type, selectedActivity?.id]);

  return (
    <section className="panel operation-submission-panel" id="operation-submission-panel">
      <div className="panel-title">
        <h3>按项目提报运营计划</h3>
        <span>先选择项目，再提交短视频、直播、投流或达人计划</span>
      </div>

      <div className="operation-project-layout">
        <aside className="operation-project-list">
          {availableActivities.map((activity) => {
            const task = operationTasks.find((item) => item.activityId === activity.id && item.status !== "已完成") ??
              operationTasks.find((item) => item.activityId === activity.id);
            const submissions = operationSubmissions.filter((submission) => submission.activityId === activity.id);
            const hasActiveSubmission = submissions.some((submission) => !isOperationComplete(submission.status));
            return (
              <button
                className={`operation-project-card ${activity.id === selectedActivity?.id ? "active" : ""}`}
                key={activity.id}
                onClick={() => setSelectedActivityId(activity.id)}
              >
                <span>{activity.brand}</span>
                <strong>{activity.name}</strong>
                <em>{task?.title ?? "已有运营提报记录"}</em>
                <small>{submissions.length} 条提报 · {hasActiveSubmission ? "推进中" : task ? task.status : "已完成"}</small>
              </button>
            );
          })}
        </aside>

        <div className="operation-project-main">
          <div className="operation-project-context">
            <div>
              <p className="eyebrow">当前提报项目</p>
              <h4>{selectedActivity?.name ?? "暂无项目"}</h4>
              <span>
                {selectedActivity
                  ? `${selectedActivity.brand} · ${selectedActivity.startDate} 至 ${selectedActivity.endDate} · ${selectedStores.length} 家门店`
                  : "请先选择项目"}
              </span>
            </div>
            <p>{selectedTask?.standard ?? "这个项目已有运营提报记录，可以继续补充直播、短视频、达人或投流计划。"}</p>
          </div>

          <div className="operation-type-tabs">
            {operationTypes.map((item) => (
              <button
                className={type === item ? "active" : ""}
                key={item}
                onClick={() => setType(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="operation-review-form" id="operation-project-form">
          <label className="full-span">
            <span>提报标题</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="full-span">
            <span>对标视频/内容</span>
            <textarea
              rows={3}
              value={benchmarkLinks}
              onChange={(event) => setBenchmarkLinks(event.target.value)}
              placeholder="放对标视频链接、账号名称、参考内容方向"
            />
          </label>
          <label className="full-span">
            <span>执行计划</span>
            <textarea
              rows={4}
              value={contentPlan}
              onChange={(event) => setContentPlan(event.target.value)}
              placeholder="写清楚内容、门店配合、发布时间、投流目标或直播安排"
            />
          </label>
          {needsBudget && (
            <label>
              <span>{type === "投流计划" ? "投流预算" : "达人预算"}</span>
              <input inputMode="numeric" value={budget} onChange={(event) => setBudget(Number(event.target.value) || 0)} />
            </label>
          )}
          {type === "直播计划" && (
            <label className="operation-checkbox">
              <input checked={needDesign} type="checkbox" onChange={(event) => setNeedDesign(event.target.checked)} />
              <span>本次直播需要设计商品图</span>
            </label>
          )}
          {type === "直播计划" && needDesign && (
            <label className="full-span">
              <span>给设计部的商品图需求</span>
              <textarea rows={3} value={designRequest} onChange={(event) => setDesignRequest(event.target.value)} />
            </label>
          )}
          {duplicateSubmission && (
            <p className="form-hint full-span">
              该项目的「{type}」已有一条提报（{duplicateSubmission.status}），审核或执行完成前不能重复提交。如需修改请到对应卡片处理。
            </p>
          )}
          <button
            className="primary full-span"
            disabled={!canSubmit}
            onClick={() => {
              if (!selectedActivity) return;
              submitOperationSubmission({
                activityId: selectedActivity.id,
                type,
                title,
                owner: OPERATIONS_OWNER_NAME,
                benchmarkLinks,
                contentPlan,
                budget: needsBudget ? budget : undefined,
                needDesign: type === "直播计划" ? needDesign : false,
                designRequest: type === "直播计划" && needDesign ? designRequest : undefined
              });
              setBenchmarkLinks("抖音/小红书对标链接或账号：");
              setContentPlan("内容结构、拍摄场景、门店配合、发布时间和预期结果。");
              setNeedDesign(false);
            }}
          >
            {!selectedActivity
              ? "请选择项目后提交"
              : duplicateSubmission
                ? `「${type}」已提交，待处理`
                : `提交「${selectedActivity.name}」给项目总审核`}
          </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function OperationReviewPipelinePanel({
  activities,
  appointments,
  operationSubmissions,
  requestDesignForOperation,
  submitOperationCompletionReview,
  openActivity
}: {
  activities: Activity[];
  appointments: StoreContentAppointment[];
  operationSubmissions: OperationSubmission[];
  requestDesignForOperation: (submissionId: string) => void;
  submitOperationCompletionReview: (submissionId: string) => void;
  openActivity: (id: string) => void;
}) {
  const reviewSubmissions = operationSubmissions.filter(
    (submission) =>
      submission.status === "待项目总审核" ||
      submission.status === "驳回修改"
  );
  const approvedSubmissions = operationSubmissions.filter((submission) => submission.status === "审核通过可执行");
  const finalReviewSubmissions = operationSubmissions.filter((submission) => isOperationFinalReview(submission.status));
  const pipelineTotal = reviewSubmissions.length + approvedSubmissions.length + finalReviewSubmissions.length;

  return (
    <section className="panel operation-pipeline-panel">
      <div className="panel-title">
        <h3>运营计划流转</h3>
        <span>{pipelineTotal} 条推进中的运营计划</span>
      </div>
      <div className="operation-pipeline-rail">
        <span>项目提报</span>
        <i />
        <span>审核确认</span>
        <i />
        <span>预约执行</span>
        <i />
        <span>复核完成</span>
      </div>
      <div className="operation-pipeline-grid">
        <OperationPipelineColumn
          title="审核中/需修改"
          subtitle={`${reviewSubmissions.length} 条`}
          hint="提交后自动进入这里，等待项目总给结论。"
          emptyText="暂无待审核计划。"
          submissions={reviewSubmissions}
          activities={activities}
          appointments={appointments}
          requestDesignForOperation={requestDesignForOperation}
          submitOperationCompletionReview={submitOperationCompletionReview}
          openActivity={openActivity}
        />
        <OperationPipelineColumn
          title="已通过待预约"
          subtitle={`${approvedSubmissions.length} 条`}
          hint="审核通过后自动进入这里，短视频和直播下一步约门店。"
          emptyText="暂无已通过待预约计划。"
          submissions={approvedSubmissions}
          activities={activities}
          appointments={appointments}
          requestDesignForOperation={requestDesignForOperation}
          submitOperationCompletionReview={submitOperationCompletionReview}
          openActivity={openActivity}
          ready
        />
        <OperationPipelineColumn
          title="执行后待复核"
          subtitle={`${finalReviewSubmissions.length} 条`}
          hint="运营回传执行结果后，等项目总复核完成节点。"
          emptyText="暂无待复核计划。"
          submissions={finalReviewSubmissions}
          activities={activities}
          appointments={appointments}
          requestDesignForOperation={requestDesignForOperation}
          submitOperationCompletionReview={submitOperationCompletionReview}
          openActivity={openActivity}
        />
      </div>
    </section>
  );
}

function OperationPipelineColumn({
  title,
  subtitle,
  hint,
  emptyText,
  submissions,
  activities,
  appointments,
  requestDesignForOperation,
  submitOperationCompletionReview,
  openActivity,
  ready = false
}: {
  title: string;
  subtitle: string;
  hint: string;
  emptyText: string;
  submissions: OperationSubmission[];
  activities: Activity[];
  appointments: StoreContentAppointment[];
  requestDesignForOperation: (submissionId: string) => void;
  submitOperationCompletionReview: (submissionId: string) => void;
  openActivity: (id: string) => void;
  ready?: boolean;
}) {
  return (
    <div className={`operation-pipeline-column ${ready ? "ready" : ""}`}>
      <div className="operation-pipeline-title">
        <div>
          <strong>{title}</strong>
          <small>{hint}</small>
        </div>
        <span>{subtitle}</span>
      </div>
      <div className="operation-pipeline-list">
        {submissions.length > 0 ? submissions.map((submission) => {
          const activity = activities.find((item) => item.id === submission.activityId);
          const canRequestDesign =
            submission.type === "直播计划" && submission.needDesign && submission.status === "审核通过可执行";
          const hasConfirmedAppointment = hasConfirmedOperationAppointment(submission, appointments);
          const appointmentRequired = needsStoreAppointment(submission.type);
          const canSubmitFinalReview =
            submission.status === "审核通过可执行" &&
            (!appointmentRequired || hasConfirmedAppointment);
          const nextAction =
            submission.status === "驳回修改"
              ? "按审核意见修改后重新提交"
              : submission.status === "待项目总审核"
                ? "等待项目总审核"
                : isOperationFinalReview(submission.status)
                  ? "等待项目总复核执行结果"
                  : appointmentRequired && !hasConfirmedAppointment
                    ? "下一步：预约门店"
                    : "下一步：执行完成后回传结果";
          return (
            <article className={`operation-pipeline-card ${ready ? "ready" : ""} ${submission.status === "驳回修改" ? "blocked" : ""}`} key={submission.id}>
              <div className="card-head compact">
                <span>{submission.type}</span>
                <b>{submission.status}</b>
              </div>
              <strong>{submission.title}</strong>
              <em>{activity?.brand} · {activity?.name} · {submission.submittedAt}</em>
              <p>{submission.contentPlan}</p>
              <div className="operation-next-action">
                <b>{nextAction}</b>
                {submission.budget ? <span>{yuan(submission.budget)}</span> : null}
              </div>
              {submission.reviewComment ? <small>审核意见：{submission.reviewComment}</small> : null}
              <div className="node-actions">
                {activity && <button onClick={() => openActivity(activity.id)}>活动详情</button>}
                {submission.status === "驳回修改" && (
                  <button className="primary" onClick={() => requestOperationResubmit(submission.id)}>
                    修改重提
                  </button>
                )}
                {canRequestDesign && (
                  <button onClick={() => requestDesignForOperation(submission.id)}>发给设计做商品图</button>
                )}
                {canSubmitFinalReview && (
                  <button className="primary" onClick={() => submitOperationCompletionReview(submission.id)}>
                    执行完成，交项目总复核
                  </button>
                )}
                {submission.status === "审核通过可执行" && appointmentRequired && !hasConfirmedAppointment && (
                  <button className="primary" onClick={() => requestStoreAppointment(submission.activityId)}>
                    去预约门店
                  </button>
                )}
                {isOperationFinalReview(submission.status) && (
                  <button disabled>等待项目总复核</button>
                )}
              </div>
            </article>
          );
        }) : (
          <p className="operation-pipeline-empty">{emptyText}</p>
        )}
      </div>
    </div>
  );
}

function StoreAppointmentDialog({
  initialActivityId,
  activities,
  operationSubmissions,
  submitStoreAppointment,
  onClose
}: {
  initialActivityId: string;
  activities: Activity[];
  operationSubmissions: OperationSubmission[];
  submitStoreAppointment: (input: StoreAppointmentInput) => void;
  onClose: () => void;
}) {
  const approvedPlans = operationSubmissions.filter(
    (submission) =>
      submission.status === "审核通过可执行" &&
      (submission.type === "短视频计划" || submission.type === "直播计划")
  );
  const approvedActivityIds = new Set(approvedPlans.map((submission) => submission.activityId));
  const bookableActivities = activities.filter(
    (activity) => activity.storeIds.length > 0 && approvedActivityIds.has(activity.id)
  );
  const [activityId, setActivityId] = useState(
    bookableActivities.some((activity) => activity.id === initialActivityId)
      ? initialActivityId
      : bookableActivities[0]?.id ?? ""
  );
  const selectedActivity = bookableActivities.find((activity) => activity.id === activityId) ?? bookableActivities[0];
  const activityStores = selectedActivity ? stores.filter((store) => selectedActivity.storeIds.includes(store.id)) : [];
  const approvedTypes = selectedActivity
    ? approvedPlans
        .filter((submission) => submission.activityId === selectedActivity.id)
        .map((submission) => (submission.type === "直播计划" ? "直播配合" : "短视频拍摄") as StoreContentAppointment["type"])
    : [];
  const [storeId, setStoreId] = useState(activityStores[0]?.id ?? "");
  const [type, setType] = useState<StoreContentAppointment["type"]>(approvedTypes[0] ?? "短视频拍摄");
  const [title, setTitle] = useState("门店短视频素材配合");
  const [detail, setDetail] = useState("请店长安排可拍摄区域、员工口径和主推菜品，现场配合运营完成素材采集。");
  const [slotOne, setSlotOne] = useState("06-23 10:00-11:00");
  const [slotTwo, setSlotTwo] = useState("06-23 15:00-16:00");
  const [slotThree, setSlotThree] = useState("06-24 14:00-15:00");
  const canSubmit = Boolean(selectedActivity && storeId && approvedTypes.includes(type) && title.trim() && detail.trim() && slotOne.trim());

  useEffect(() => {
    if (!selectedActivity) return;
    const firstStoreId = stores.find((store) => selectedActivity.storeIds.includes(store.id))?.id ?? "";
    if (!selectedActivity.storeIds.includes(storeId)) {
      setStoreId(firstStoreId);
    }
    const firstType = approvedTypes[0];
    if (firstType && !approvedTypes.includes(type)) {
      setType(firstType);
    }
  }, [selectedActivity?.id, storeId, type, approvedTypes.join("|")]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card appointment-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>预约门店拍摄/直播</h3>
          <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {bookableActivities.length === 0 ? (
          <p className="body-copy">暂无已通过的短视频或直播计划，需先提交项目总审核。</p>
        ) : (
          <>
            <div className="appointment-form">
              <label>
                <span>关联项目</span>
                <select value={selectedActivity?.id ?? ""} onChange={(event) => setActivityId(event.target.value)}>
                  {bookableActivities.map((activity) => (
                    <option value={activity.id} key={activity.id}>{activity.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>预约门店</span>
                <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
                  {activityStores.map((store) => (
                    <option value={store.id} key={store.id}>{store.name} · {store.manager}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>配合类型</span>
                <select value={type} onChange={(event) => setType(event.target.value as StoreContentAppointment["type"])}>
                  {approvedTypes.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>预约标题</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="full-span">
                <span>门店配合内容</span>
                <textarea rows={3} value={detail} onChange={(event) => setDetail(event.target.value)} />
              </label>
              <label><span>候选时间 1</span><input value={slotOne} onChange={(event) => setSlotOne(event.target.value)} /></label>
              <label><span>候选时间 2</span><input value={slotTwo} onChange={(event) => setSlotTwo(event.target.value)} /></label>
              <label><span>候选时间 3</span><input value={slotThree} onChange={(event) => setSlotThree(event.target.value)} /></label>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={onClose}>取消</button>
              <button
                className="primary"
                type="button"
                disabled={!canSubmit}
                onClick={() => {
                  if (!selectedActivity) return;
                  submitStoreAppointment({
                    activityId: selectedActivity.id,
                    storeId,
                    type,
                    title,
                    requestedBy: OPERATIONS_OWNER_NAME,
                    detail,
                    candidateSlots: [slotOne, slotTwo, slotThree].map((slot) => slot.trim()).filter(Boolean)
                  });
                  onClose();
                }}
              >
                发送给店长确认
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StoreManagerWorkbench({
  tasks,
  activities,
  appointments,
  currentUser,
  confirmStoreAppointment,
  openActivity,
  goTasks
}: {
  tasks: Task[];
  activities: Activity[];
  appointments: StoreContentAppointment[];
  currentUser: User;
  confirmStoreAppointment: (appointmentId: string, selectedSlot: string) => void;
  openActivity: (id: string) => void;
  goTasks: () => void;
}) {
  const currentStore = stores.find((store) => store.manager === currentUser.name);
  const storeAppointments = currentStore
    ? appointments.filter((appointment) => appointment.storeId === currentStore.id)
    : [];
  const pendingAppointments = storeAppointments.filter((appointment) => appointment.status === "待店长选择");
  const confirmedAppointments = storeAppointments.filter((appointment) => appointment.status === "已确认");
  const activeTasks = tasks
    .filter((task) => task.status !== "已完成")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const urgentTasks = activeTasks.filter((task) => task.dueDate <= addDays(TODAY, 3));

  return (
    <section className="role-workspace">
      <div className="metric-grid compact-metrics">
        <article className="metric-card"><span>待完成任务</span><strong>{activeTasks.length}</strong></article>
        <article className="metric-card"><span>三天内截止</span><strong>{urgentTasks.length}</strong></article>
        <article className="metric-card"><span>待确认预约</span><strong>{pendingAppointments.length}</strong></article>
        <article className="metric-card"><span>已确认日程</span><strong>{confirmedAppointments.length}</strong></article>
        <article className="metric-card"><span>本周数据</span><strong>待填</strong></article>
      </div>

      <section className="panel">
        <div className="panel-title">
          <h3>{currentStore?.name ?? "门店"}今日待办</h3>
          <span>项目总下派给店长的节点</span>
        </div>
        <div className="project-task-list">
          {activeTasks.length > 0 ? activeTasks.map((task) => {
            const activity = activities.find((item) => item.id === task.activityId);
            const isDataTask = task.type.includes("数据") || task.title.includes("数据");
            return (
              <article className="project-task-card" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <span>{activity?.name} · 截止 {task.dueDate}</span>
                  <TaskStandard text={task.standard} />
                </div>
                <div className="node-actions">
                  <button onClick={() => openActivity(task.activityId)}>活动详情</button>
                  <button className="primary" onClick={goTasks}>
                    {isDataTask ? "去我的任务填数据" : "去我的任务汇报"}
                  </button>
                </div>
              </article>
            );
          }) : (
            <p className="body-copy">今天没有项目总下派给本店的执行任务。</p>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h3>拍摄和直播预约</h3>
          <span>运营发起，店长确认时间</span>
        </div>
        <div className="store-appointment-list">
          {storeAppointments.length > 0 ? storeAppointments.map((appointment) => {
            const activity = activities.find((item) => item.id === appointment.activityId);
            return (
              <article className="store-appointment-card" key={appointment.id}>
                <div>
                  <b>{appointment.type}</b>
                  <strong>{appointment.title}</strong>
                  <span>{activity?.name} · {appointment.requestedBy}</span>
                  <p>{appointment.detail}</p>
                </div>
                {appointment.status === "已确认" ? (
                  <div className="confirmed-calendar-box">
                    <em>已确认：{appointment.selectedSlot}</em>
                    <a
                      download={`${appointment.title}.ics`}
                      href={appointmentCalendarHref(appointment, activity, currentStore)}
                    >
                      添加到手机日历
                    </a>
                  </div>
                ) : (
                  <div className="slot-choice-row">
                    {appointment.candidateSlots.map((slot) => (
                      <button key={slot} onClick={() => confirmStoreAppointment(appointment.id, slot)}>
                        同意 {slot}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            );
          }) : (
            <p className="body-copy">暂时没有短视频或直播预约需要确认。</p>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h3>{currentStore?.name ?? "门店"}执行标准</h3>
          <span>按标准完成后，到「我的任务」提交汇报和数据</span>
        </div>
        <div className="store-execution-grid">
            {[
              {
                title: "员工培训",
                detail: "活动口径、套餐内容、核销方式、生日卡/礼盒销售话术必须同步到当班员工。"
              },
              {
                title: "物料陈列",
                detail: "门口海报、桌面台卡、菜单夹页、收银提示牌按要求摆放，避免遮挡和过期物料混放。"
              },
              {
                title: "现场照片",
                detail: "上传门头、入口、桌面、收银台和重点物料照片，能看清位置和实际效果。"
              },
              {
                title: "问题反馈",
                detail: "缺物料、顾客疑问、员工不清楚、套餐核销异常，要当天写进汇报。"
              }
            ].map((item) => (
              <div className="store-execution-card" key={item.title}>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
            ))}
        </div>
      </section>
    </section>
  );
}

function StoreDailyDataPanel({
  currentStore,
  activities,
  submitStoreReport
}: {
  currentStore?: { id: string; name: string };
  activities: Activity[];
  submitStoreReport: (report: StoreReport) => void;
}) {
  const storeActivities = currentStore
    ? activities.filter((activity) => activity.storeIds.includes(currentStore.id) && activity.status !== "已取消")
    : [];
  const [activityId, setActivityId] = useState(storeActivities[0]?.id ?? "");
  const selectedActivity = storeActivities.find((activity) => activity.id === activityId) ?? storeActivities[0];
  const reportItems = getActivityReportItems(selectedActivity);
  const [reportDate, setReportDate] = useState(TODAY);
  const [itemValues, setItemValues] = useState<Record<string, { quantity: string; amount: string }>>({});
  const [visits, setVisits] = useState("");
  const [note, setNote] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const storeReportsForActivity =
    selectedActivity && currentStore
      ? storeReports
          .filter((report) => report.storeId === currentStore.id && report.activityId === selectedActivity.id)
          .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
      : [];
  const canSubmit =
    Boolean(selectedActivity) &&
    !isUploading &&
    (reportItems.some((item) => itemValues[item.key]?.quantity || itemValues[item.key]?.amount) || visits.trim() || note.trim());
  const comparisonDate = addDays(reportDate, -1);
  const comparisonRows = selectedActivity
    ? storeReports
        .filter((report) => report.activityId === selectedActivity.id && report.submittedAt === comparisonDate)
        .map((report) => ({
          report,
          store: stores.find((store) => store.id === report.storeId)
        }))
        .sort((a, b) => b.report.revenue - a.report.revenue)
    : [];
  const ownRank = comparisonRows.findIndex((row) => row.report.storeId === currentStore?.id) + 1;
  const maxRevenue = Math.max(1, ...comparisonRows.map((row) => row.report.revenue));

  // 日历：按所选活动的日期范围铺格子，标出今天、所选日、已填报日。
  const periodStart = selectedActivity?.startDate ?? "";
  const periodEnd = selectedActivity?.endDate ?? "";
  const calendarDays = useMemo(() => {
    if (!periodStart || !periodEnd) return [] as string[];
    const gridStart = shiftDate(periodStart, -mondayIndex(periodStart));
    const gridEnd = shiftDate(periodEnd, 6 - mondayIndex(periodEnd));
    const days: string[] = [];
    for (let d = gridStart; d <= gridEnd; d = shiftDate(d, 1)) days.push(d);
    return days;
  }, [periodStart, periodEnd]);
  const submittedDates = new Set(
    storeReportsForActivity.map((report) => report.submittedAt).filter(Boolean) as string[]
  );

  useEffect(() => {
    if (!selectedActivity && storeActivities[0]) {
      setActivityId(storeActivities[0].id);
    }
  }, [selectedActivity?.id, storeActivities[0]?.id]);

  // 切换活动时，把填报日期收敛到活动周期内（优先今天）。
  useEffect(() => {
    if (!periodStart || !periodEnd) return;
    setReportDate((current) => {
      if (current >= periodStart && current <= periodEnd) return current;
      return TODAY >= periodStart && TODAY <= periodEnd ? TODAY : periodStart;
    });
  }, [periodStart, periodEnd]);

  function updateItemValue(key: string, field: "quantity" | "amount", value: string) {
    setItemValues((current) => ({
      ...current,
      [key]: {
        quantity: current[key]?.quantity ?? "",
        amount: current[key]?.amount ?? "",
        [field]: value
      }
    }));
  }

  function submitDailyReport() {
    if (!selectedActivity || !currentStore) return;
    let totalQuantity = 0;
    let totalAmount = 0;
    const summaryParts = reportItems
      .map((item) => {
        const value = itemValues[item.key];
        const quantity = Number(value?.quantity || 0);
        const amount = Number(value?.amount || 0);
        totalQuantity += quantity;
        totalAmount += amount;
        if (!value?.quantity && !value?.amount) return null;
        return `${item.label} ${quantity} 份 / ${amount} 元`;
      })
      .filter(Boolean);
    const noteText = [summaryParts.join("；"), note.trim()].filter(Boolean).join(" ｜ ");

    setIsUploading(true);
    setUploadError("");
    Promise.all(
      photoFiles.map((file) => uploadMarketingFile(file, selectedActivity.id, "store-reports"))
    )
      .then((uploaded) => {
        submitStoreReport({
          // 同一门店+活动+日期固定 id，重复提交即覆盖更新。
          id: `sr-${currentStore.id}-${selectedActivity.id}-${reportDate}`,
          activityId: selectedActivity.id,
          storeId: currentStore.id,
          packageSales: totalQuantity,
          revenue: totalAmount,
          visits: Number(visits || 0),
          beforeValue: 0,
          lastYearValue: 0,
          note: noteText,
          submittedAt: reportDate,
          files: uploaded
        });
        setItemValues({});
        setVisits("");
        setNote("");
        setPhotoFiles([]);
      })
      .catch((error) => {
        setUploadError(error instanceof Error ? error.message : "照片上传失败，请重试");
      })
      .finally(() => setIsUploading(false));
  }

  return (
    <article className="panel">
      <div className="panel-title">
        <h3>每日活动数据填报</h3>
        <span>按活动类型显示填报项</span>
      </div>
      <div className="daily-report-form">
        <label className="full-span">
          <span>活动</span>
          <select value={selectedActivity?.id ?? ""} onChange={(event) => setActivityId(event.target.value)}>
            {storeActivities.map((activity) => (
              <option value={activity.id} key={activity.id}>{activity.name}</option>
            ))}
          </select>
        </label>
        {periodStart && periodEnd ? (
          <div className="daily-calendar full-span">
            <div className="daily-calendar-head">
              <strong>点日期填报</strong>
              <span>
                {periodStart} ~ {periodEnd}
                <i className="cal-legend done">已填</i>
                <i className="cal-legend selected">填写中</i>
                <i className="cal-legend today">今天</i>
              </span>
            </div>
            <div className="daily-calendar-weekdays">
              {["一", "二", "三", "四", "五", "六", "日"].map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>
            <div className="daily-calendar-grid">
              {calendarDays.map((day) => {
                const inPeriod = day >= periodStart && day <= periodEnd;
                const dayNum = Number(day.slice(8, 10));
                const className = [
                  "daily-cal-day",
                  inPeriod ? "" : "out",
                  day === TODAY ? "today" : "",
                  day === reportDate ? "selected" : "",
                  submittedDates.has(day) ? "done" : ""
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    type="button"
                    className={className}
                    key={day}
                    disabled={!inPeriod}
                    onClick={() => setReportDate(day)}
                    title={day}
                  >
                    {dayNum === 1 && <em>{Number(day.slice(5, 7))}月</em>}
                    <b>{dayNum}</b>
                    {submittedDates.has(day) && <i className="cal-check">✓</i>}
                  </button>
                );
              })}
            </div>
            <p className="daily-calendar-current">
              正在填写：<b>{reportDate}</b>
              {submittedDates.has(reportDate) ? "（这天已提交过，可覆盖更新）" : ""}
            </p>
          </div>
        ) : (
          <label className="full-span">
            <span>填报日期</span>
            <input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
          </label>
        )}
        <div className="daily-report-items full-span">
          {reportItems.map((item) => (
            <div className="daily-report-item" key={item.key}>
              <strong>{item.label}</strong>
              <label>
                <span>销量</span>
                <input
                  inputMode="numeric"
                  value={itemValues[item.key]?.quantity ?? ""}
                  onChange={(event) => updateItemValue(item.key, "quantity", event.target.value)}
                  placeholder="例如 36"
                />
              </label>
              <label>
                <span>销售额</span>
                <input
                  inputMode="decimal"
                  value={itemValues[item.key]?.amount ?? ""}
                  onChange={(event) => updateItemValue(item.key, "amount", event.target.value)}
                  placeholder="例如 5688"
                />
              </label>
            </div>
          ))}
        </div>
        <label>
          <span>今日活动客流</span>
          <input inputMode="numeric" value={visits} onChange={(event) => setVisits(event.target.value)} placeholder="例如 126" />
        </label>
        <label>
          <span>现场照片</span>
          <input
            accept="image/*"
            capture="environment"
            multiple
            type="file"
            onChange={(event) => {
              setPhotoFiles(Array.from(event.target.files ?? []));
              setUploadError("");
            }}
          />
        </label>
        <label className="full-span">
          <span>问题和顾客反馈</span>
          <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {photoFiles.length > 0 && (
          <div className="upload-preview full-span">
            {photoFiles.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}
          </div>
        )}
        {uploadError && <p className="form-error light full-span">{uploadError}</p>}
        <button className="primary full-span" disabled={!canSubmit} onClick={submitDailyReport}>
          {isUploading ? "照片上传中..." : "提交今日数据"}
        </button>
      </div>
      <div className="daily-report-history">
        <strong>本店该活动最近提交</strong>
        {storeReportsForActivity.length > 0 ? storeReportsForActivity.slice(0, 4).map((report) => (
          <span key={report.id}>
            {report.submittedAt} · 销量 {report.packageSales} · {yuan(report.revenue)} · 客流 {report.visits}
            {(report.files?.length ?? 0) > 0 && (
              <i className="report-photo-strip">
                {report.files!.map((file) => (
                  <a href={file.url} target="_blank" rel="noreferrer" key={file.path}>
                    <img src={file.url} alt={file.name} />
                  </a>
                ))}
              </i>
            )}
          </span>
        )) : (
          <span>这个活动还没有提交过数据。</span>
        )}
      </div>
      <div className="store-comparison-panel">
        <div className="store-comparison-head">
          <div>
            <strong>昨日同活动门店对比</strong>
            <span>{comparisonDate} · {selectedActivity?.name ?? "未选择活动"}</span>
          </div>
          {ownRank > 0 && <b>本店第 {ownRank} 名</b>}
        </div>
        {comparisonRows.length > 0 ? (
          <div className="store-comparison-list">
            {comparisonRows.map(({ report, store }, index) => {
              const isOwnStore = report.storeId === currentStore?.id;
              return (
                <div className={isOwnStore ? "store-comparison-row own-store" : "store-comparison-row"} key={report.id}>
                  <span>第{index + 1}</span>
                  <div>
                    <strong>{store?.name}</strong>
                    <em>{isOwnStore ? "本店" : store?.manager}</em>
                  </div>
                  <small>销量 {report.packageSales}</small>
                  <b>{yuan(report.revenue)}</b>
                  <i style={{ width: `${Math.max(8, (report.revenue / maxRevenue) * 100)}%` }} />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="body-copy">这个活动昨天还没有门店数据，今天提交后明天就能形成对比。</p>
        )}
      </div>
    </article>
  );
}

function StoreTaskReportCard({
  task,
  activity,
  submitTaskReport
}: {
  task: Task;
  activity?: Activity;
  submitTaskReport: (taskId: string, note: string, files: UploadedFile[]) => void;
}) {
  const [reportText, setReportText] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const canSubmit = (reportText.trim().length > 0 || photoFiles.length > 0) && !isUploading;

  async function handleSubmit() {
    setIsUploading(true);
    setUploadError("");
    try {
      const uploaded: UploadedFile[] = [];
      for (const file of photoFiles) {
        uploaded.push(await uploadMarketingFile(file, task.activityId, "store-reports"));
      }
      submitTaskReport(task.id, reportText, uploaded);
      setReportText("");
      setPhotoFiles([]);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "照片上传失败，请重试");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <article className="store-task-card">
      <div className="store-task-main">
        <strong>{task.title}</strong>
        <span>{activity?.name} · 截止 {task.dueDate}</span>
        <TaskStandard text={task.standard} />
      </div>
      <div className="store-task-report">
        <label>
          <span>完成说明 / 现场反馈</span>
          <textarea
            rows={3}
            value={reportText}
            onChange={(event) => setReportText(event.target.value)}
            placeholder="例如：已培训 8 人，海报已放入口，台卡已摆桌，顾客反馈..."
          />
        </label>
        <label>
          <span>上传现场照片</span>
          <input
            accept="image/*"
            capture="environment"
            multiple
            type="file"
            onChange={(event) => {
              setPhotoFiles(Array.from(event.target.files ?? []));
              setUploadError("");
            }}
          />
        </label>
        {photoFiles.length > 0 && (
          <div className="upload-preview">
            {photoFiles.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}
          </div>
        )}
        {uploadError && <p className="form-error light">{uploadError}</p>}
        <button className="primary" disabled={!canSubmit} onClick={handleSubmit}>
          {isUploading ? "照片上传中..." : "提交汇报并自动完成任务"}
        </button>
      </div>
    </article>
  );
}

function DepartmentPanel({
  title,
  subtitle,
  tasks,
  activities,
  openActivity,
  updateTaskStatus
}: {
  title: string;
  subtitle: string;
  tasks: Task[];
  activities: Activity[];
  openActivity: (id: string) => void;
  updateTaskStatus?: (taskId: string, status: TaskStatus) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </div>
      <div className="task-strip">
        {tasks.map((task) => {
          const activity = activities.find((item) => item.id === task.activityId);
          return (
            <div className="task-line" key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <span>{activity?.name} · {task.owner} · {task.dueDate}</span>
              </div>
              <div className="task-actions">
                <b>{task.status}</b>
                <button onClick={() => openActivity(task.activityId)}>活动</button>
                {updateTaskStatus && task.status !== "已完成" && (
                  <button onClick={() => updateTaskStatus(task.id, getNextTaskStatus(task.status))}>
                    {getAdvanceLabel(task.status)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CalendarView({
  activities,
  month,
  setMonth,
  draggingActivityId,
  setDraggingActivityId,
  moveActivityDate,
  openActivity
}: {
  activities: Activity[];
  month: number;
  setMonth: (month: number) => void;
  draggingActivityId: string | null;
  setDraggingActivityId: (id: string | null) => void;
  moveActivityDate: (id: string, date: string) => void;
  openActivity: (id: string) => void;
}) {
  const calendarYear = Number(TODAY.slice(0, 4));
  const days = monthDays(calendarYear, month);

  return (
    <div className="page-stack">
      <div className="filter-row">
        <button onClick={() => setMonth(Math.max(1, month - 1))}>上个月</button>
        <strong>{calendarYear} 年 {month} 月</strong>
        <button onClick={() => setMonth(Math.min(12, month + 1))}>下个月</button>
        <span className="calendar-note">只显示已审核通过或已进入执行链路的活动</span>
      </div>
      <section className="calendar">
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
          <div className="weekday" key={day}>周{day}</div>
        ))}
        {days.map((cell, index) => (
          <div
            className={cell.date === TODAY ? "calendar-cell today" : "calendar-cell"}
            key={`${cell.date}-${index}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggingActivityId && cell.date) moveActivityDate(draggingActivityId, cell.date);
              setDraggingActivityId(null);
            }}
          >
            <span className="day-number">{cell.day}</span>
            {cell.date &&
              activities
                .filter((activity) => activity.startDate <= cell.date && activity.endDate >= cell.date)
                .map((activity) => (
                  <button
                    className="calendar-event"
                    style={{ background: brandColors[activity.brand] }}
                    draggable
                    key={activity.id}
                    onDragStart={() => setDraggingActivityId(activity.id)}
                    onClick={() => openActivity(activity.id)}
                  >
                    {activity.name}
                  </button>
                ))}
          </div>
        ))}
      </section>
    </div>
  );
}

function BoardView({
  activities,
  tasks,
  draggingActivityId,
  setDraggingActivityId,
  moveActivity,
  openActivity
}: {
  activities: Activity[];
  tasks: Task[];
  draggingActivityId: string | null;
  setDraggingActivityId: (id: string | null) => void;
  moveActivity: (id: string, status: ActivityStatus) => void;
  openActivity: (id: string) => void;
}) {
  return (
    <section className="board">
      {statuses.map((status) => (
        <div
          className="board-column"
          key={status}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (draggingActivityId) moveActivity(draggingActivityId, status);
            setDraggingActivityId(null);
          }}
        >
          <div className="column-title">
            <strong>{activityStatusText(status)}</strong>
            <span>{activities.filter((activity) => activity.status === status).length}</span>
          </div>
          {activities
            .filter((activity) => activity.status === status)
            .map((activity) => {
              const activityTasks = tasks.filter((task) => task.activityId === activity.id);
              const done = activityTasks.filter((task) => task.status === "已完成").length;
              const overdue = activityTasks.filter((task) => task.status === "已延期").length;
              return (
                <article
                  className="activity-card"
                  draggable
                  key={activity.id}
                  onDragStart={() => setDraggingActivityId(activity.id)}
                  onClick={() => openActivity(activity.id)}
                >
                  <div className="card-head">
                    <span>{activity.brand}</span>
                    <b>{activity.scale}</b>
                  </div>
                  <h3>{activity.name}</h3>
                  <p>{activity.startDate} 至 {activity.endDate}</p>
                  <div className="card-meta">
                    <span>{getActivityOwner(activity)}</span>
                    <span>{activity.storeIds.length} 家门店</span>
                  </div>
                  <div className="progress-line">
                    <i style={{ width: `${activityTasks.length ? (done / activityTasks.length) * 100 : 0}%` }} />
                  </div>
                  <div className="card-meta">
                    <span>完成 {done}/{activityTasks.length}</span>
                    <span>延期 {overdue}</span>
                  </div>
                </article>
              );
            })}
        </div>
      ))}
    </section>
  );
}

function NodeMonitor({
  activities,
  tasks,
  designAssets,
  materialTaskStatuses,
  operationSubmissions,
  openActivity
}: {
  activities: Activity[];
  tasks: Task[];
  designAssets: DesignAsset[];
  materialTaskStatuses: Record<string, MaterialProductionStatus>;
  operationSubmissions: OperationSubmission[];
  openActivity: (id: string) => void;
}) {
  const activityMonitors = activities
    .filter((activity) => activity.status !== "已取消")
    .map((activity) => {
      const nodes = getMonitorNodes(activity, tasks, designAssets, materialTaskStatuses, operationSubmissions);
      const health = getActivityHealth(nodes);
      const currentNode = nodes.find((node) => node.state === "延误") ?? nodes.find((node) => node.state === "进行中") ?? nodes.at(-1);
      return { activity, nodes, health, currentNode };
    })
    .sort((a, b) => {
      const priority = { danger: 0, active: 1, ok: 2 } as const;
      return priority[a.health.className as keyof typeof priority] - priority[b.health.className as keyof typeof priority];
    });

  const doneNodes = activityMonitors.reduce(
    (sum, item) => sum + item.nodes.filter((node) => node.state === "已完成").length,
    0
  );
  const activeNodes = activityMonitors.reduce(
    (sum, item) => sum + item.nodes.filter((node) => node.state === "进行中").length,
    0
  );
  const delayedNodes = activityMonitors.reduce(
    (sum, item) => sum + item.nodes.filter((node) => node.state === "延误").length,
    0
  );

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <article className="metric-card"><span>已完成节点</span><strong>{doneNodes}</strong></article>
        <article className="metric-card"><span>推进中节点</span><strong>{activeNodes}</strong></article>
        <article className="metric-card"><span>延误节点</span><strong>{delayedNodes}</strong></article>
      </section>

      <section className="monitor-list">
        {activityMonitors.map(({ activity, nodes, health, currentNode }) => (
          <article className="monitor-card" key={activity.id}>
            <div className="monitor-head">
              <div>
                <div className="card-head compact">
                  <span>{activity.brand}</span>
                  <b>{activityStatusText(activity.status)}</b>
                </div>
                <h3>{activity.name}</h3>
                <p>{activity.startDate} 至 {activity.endDate} · {getActivityOwner(activity)}</p>
              </div>
              <div className={`health-pill ${health.className}`}>
                <strong>{health.label}</strong>
                <span>{health.completion}%</span>
              </div>
            </div>

            <div className="monitor-progress">
              <i style={{ width: `${health.completion}%` }} />
            </div>

            <div className="current-node">
              <span>当前盯办</span>
              <strong>{currentNode?.label}</strong>
              <em>{currentNode?.owner} · 截止 {currentNode?.dueDate} · {currentNode?.reminder}</em>
            </div>

            <div className="node-track">
              {nodes.map((node) => (
                <div className={`node-item ${node.state}`} key={node.label}>
                  <span>{node.state}</span>
                  <strong>{node.label}</strong>
                  {node.detail && <b className="node-detail">{node.detail}</b>}
                  <em>{node.owner}</em>
                  <small>{node.dueDate}</small>
                </div>
              ))}
            </div>

            <div className="monitor-actions">
              <button onClick={() => openActivity(activity.id)}>进入活动详情</button>
              <button>发送钉钉提醒</button>
              {health.className === "danger" && <button className="primary">升级给品牌负责人</button>}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function DesignReviewPage({
  activities,
  designAssets,
  currentUser,
  submitDesignUpload,
  approveDesignAsset,
  rejectDesignAsset,
  openActivity
}: {
  activities: Activity[];
  designAssets: DesignAsset[];
  currentUser: User;
  submitDesignUpload: (input: DesignUploadInput) => void;
  approveDesignAsset: (assetId: string) => void;
  rejectDesignAsset: (assetId: string, comment: string) => void;
  openActivity: (id: string) => void;
}) {
  const [dismissedAssetIds, setDismissedAssetIds] = useState<string[]>([]);
  const [reviewFeedback, setReviewFeedback] = useState<{ kind: "approved" | "rejected"; title: string } | null>(null);
  const activityIds = new Set(activities.map((activity) => activity.id));
  const scopedAssets = designAssets.filter((asset) => activityIds.has(asset.activityId));
  const reviewableAssets = scopedAssets.filter(
    (asset) =>
      (asset.status === "待老板审核" || asset.status === "驳回修改") &&
      !dismissedAssetIds.includes(asset.id)
  );
  const pendingCount = scopedAssets.filter((asset) => asset.status === "待老板审核").length;
  const rejectedCount = scopedAssets.filter((asset) => asset.status === "驳回修改").length;
  const approvedCount = scopedAssets.filter((asset) => asset.status === "已通过").length;
  const inProgressCount = scopedAssets.filter((asset) => asset.status === "设计中").length;

  function closeReviewedAsset(asset: DesignAsset, kind: "approved" | "rejected") {
    setDismissedAssetIds((current) => (current.includes(asset.id) ? current : [...current, asset.id]));
    setReviewFeedback({ kind, title: asset.title });
    window.setTimeout(() => setReviewFeedback(null), 1800);
  }

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <article className="metric-card"><span>待审核</span><strong>{pendingCount}</strong></article>
        <article className="metric-card"><span>驳回修改</span><strong>{rejectedCount}</strong></article>
        <article className={`metric-card review-metric ${reviewFeedback?.kind === "approved" ? "pulse-approved" : ""}`}>
          <span>已通过</span>
          <strong>{approvedCount}</strong>
        </article>
        <article className="metric-card"><span>设计中</span><strong>{inProgressCount}</strong></article>
      </section>

      {reviewFeedback && (
        <div className={`review-feedback ${reviewFeedback.kind}`}>
          {reviewFeedback.kind === "approved" ? "已通过，已收进已通过统计" : "已驳回，已从当前待办收起"} · {reviewFeedback.title}
        </div>
      )}

      {currentUser.role === "设计人员" && (
        <DesignUploadPanel activities={activities} submitDesignUpload={submitDesignUpload} />
      )}

      <section className="review-grid">
        {reviewableAssets.length > 0 ? reviewableAssets.map((asset) => {
          const activity = activities.find((item) => item.id === asset.activityId);
          return (
            <DesignAssetCard
              asset={asset}
              activity={activity}
              currentUser={currentUser}
              approveDesignAsset={(assetId) => {
                approveDesignAsset(assetId);
                closeReviewedAsset(asset, "approved");
              }}
              rejectDesignAsset={(assetId, comment) => {
                rejectDesignAsset(assetId, comment);
                closeReviewedAsset(asset, "rejected");
              }}
              openActivity={openActivity}
              key={asset.id}
            />
          );
        }) : (
          <p className="body-copy review-empty">当前没有需要审核或修改后待复审的设计稿。</p>
        )}
      </section>
    </div>
  );
}

function DesignUploadPanel({
  activities,
  selectedActivityId,
  submitDesignUpload,
  asDialog = false,
  onClose
}: {
  activities: Activity[];
  selectedActivityId?: string;
  submitDesignUpload: (input: DesignUploadInput) => void;
  asDialog?: boolean;
  onClose?: () => void;
}) {
  const [activityId, setActivityId] = useState(selectedActivityId || activities[0]?.id || "");
  const [title, setTitle] = useState("活动主视觉设计稿");
  const [type, setType] = useState<DesignAsset["type"]>("海报");
  const [purpose, setPurpose] = useState("用于门店海报、平台商家页和社群转发。");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const canSubmit = activityId && title.trim() && purpose.trim() && selectedFiles.length > 0 && !isUploading;

  function fileKey(file: File) {
    return `${file.name}-${file.size}-${file.lastModified}`;
  }

  useEffect(() => {
    if (selectedActivityId && activities.some((activity) => activity.id === selectedActivityId)) {
      setActivityId(selectedActivityId);
      return;
    }
    if (!activities.some((activity) => activity.id === activityId)) {
      setActivityId(activities[0]?.id ?? "");
    }
  }, [activities, activityId, selectedActivityId]);

  async function handleSubmit() {
    setIsUploading(true);
    setUploadError("");
    setUploadProgress("");
    try {
      const uploadedFiles: UploadedFile[] = [];
      for (const [index, file] of selectedFiles.entries()) {
        setUploadProgress(`正在上传 ${index + 1}/${selectedFiles.length}：${file.name}`);
        try {
          uploadedFiles.push(await uploadMarketingFile(file, activityId, "design-assets"));
        } catch (error) {
          const reason = error instanceof Error ? error.message : "文件上传失败";
          throw new Error(`${file.name} 上传失败：${reason}`);
        }
      }
      submitDesignUpload({
        activityId,
        title,
        type,
        purpose,
        fileNames: uploadedFiles.map((file) => file.name),
        files: uploadedFiles
      });
      setSelectedFiles([]);
      setUploadProgress("");
      onClose?.();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "文件上传失败");
    } finally {
      setIsUploading(false);
    }
  }

  const formBody = (
    <div className="design-upload-form">
        <label>
          <span>所属活动</span>
          <select value={activityId} onChange={(event) => setActivityId(event.target.value)}>
            {activities.map((activity) => (
              <option value={activity.id} key={activity.id}>{activity.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>设计标题</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          <span>设计类型</span>
          <select value={type} onChange={(event) => setType(event.target.value as DesignAsset["type"])}>
            {(["海报", "菜单", "抖音商家页面", "团购封面", "门店物料"] as DesignAsset["type"][]).map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="full-span">
          <span>设计用途</span>
          <textarea rows={3} value={purpose} onChange={(event) => setPurpose(event.target.value)} />
        </label>
        <label className="full-span">
          <span>上传设计稿</span>
          <input
            accept="image/*,video/*,.pdf,.psd,.ai,.eps,.cdr,.zip,.rar,.7z"
            multiple
            type="file"
            onChange={(event) => {
              const incomingFiles = Array.from(event.target.files ?? []);
              setSelectedFiles((current) => {
                const existingKeys = new Set(current.map(fileKey));
                const nextFiles = incomingFiles.filter((file) => !existingKeys.has(fileKey(file)));
                return [...current, ...nextFiles];
              });
              setUploadError("");
              setUploadProgress("");
              event.currentTarget.value = "";
            }}
          />
        </label>
        {selectedFiles.length > 0 && (
          <div className="upload-preview full-span">
            <strong>已选择 {selectedFiles.length} 个文件</strong>
            {selectedFiles.map((file) => (
              <span className="selected-file-chip" key={fileKey(file)}>
                {file.name}
                <button
                  aria-label={`移除 ${file.name}`}
                  onClick={() => setSelectedFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)))}
                  type="button"
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}
        {isUploading && uploadProgress && <p className="form-hint full-span">{uploadProgress}</p>}
        {uploadError && <p className="form-error light full-span">{uploadError}</p>}
        <button className="primary" disabled={!canSubmit} onClick={handleSubmit}>
          {isUploading ? "正在上传..." : "提交给项目总审核"}
        </button>
      </div>
  );

  if (asDialog) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card design-upload-modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-head">
            <h3>提交设计稿给项目总审核</h3>
            <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">
              ×
            </button>
          </div>
          {formBody}
        </div>
      </div>
    );
  }

  return (
    <section className="panel" id="design-upload-panel">
      <div className="panel-title">
        <h3>提交项目总审核</h3>
        <span>一次可选多张设计稿</span>
      </div>
      {formBody}
    </section>
  );
}

function DesignAssetCard({
  asset,
  activity,
  currentUser,
  approveDesignAsset,
  rejectDesignAsset,
  openActivity
}: {
  asset: DesignAsset;
  activity?: Activity;
  currentUser: User;
  approveDesignAsset: (assetId: string) => void;
  rejectDesignAsset: (assetId: string, comment: string) => void;
  openActivity: (id: string) => void;
}) {
  const [comment, setComment] = useState(asset.reviewComment ?? "");
  const [annotationText, setAnnotationText] = useState("");
  const [annotations, setAnnotations] = useState<ReviewAnnotation[]>([]);
  const reviewerCanAct = Boolean(activity && canManageActivity(currentUser, activity));
  const canReview = reviewerCanAct && (asset.status === "待老板审核" || asset.status === "驳回修改");
  const uploadedFiles = asset.files ?? [];

  useEffect(() => {
    setComment(asset.reviewComment ?? "");
    setAnnotationText("");
    setAnnotations([]);
  }, [asset.id, asset.reviewComment]);

  function addAnnotation(event: MouseEvent<HTMLDivElement>, file: UploadedFile) {
    if (!canReview) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
    const nextNumber = annotations.length + 1;
    const text = annotationText.trim() || `第${nextNumber}处需要调整`;
    const line = `批注${nextNumber}（${file.name}）：${text}`;

    setAnnotations((current) => [
      ...current,
      {
        id: Date.now(),
        filePath: file.path,
        number: nextNumber,
        x,
        y,
        text
      }
    ]);
    setComment((current) => [current.trim(), line].filter(Boolean).join("\n"));
    setAnnotationText("");
  }

  function removeAnnotation(id: number) {
    setAnnotations((current) => current.filter((item) => item.id !== id));
  }

  return (
    <article className="review-card">
      <div className="review-card-head">
        <div>
          <div className="card-head compact">
            <span>{asset.type}</span>
            <b>V{asset.version}</b>
          </div>
          <h3>{asset.title}</h3>
          <p>{activity?.name} · {asset.designer} · {asset.submittedAt}</p>
        </div>
        <span className={`review-status ${asset.status}`}>
          {asset.status === "驳回修改" ? "修改后待复审" : designAssetStatusText(asset.status)}
        </span>
      </div>

      <div className="asset-purpose">
        <strong>设计用途</strong>
        <p>{asset.purpose ?? "用于活动相关门店物料、平台页面和内容传播。"}</p>
        {uploadedFiles.length === 0 && (asset.fileNames?.length ?? 0) > 0 && (
          <div>
            {asset.fileNames?.map((name) => <span key={name}>{name}</span>)}
          </div>
        )}
      </div>

      {canReview && uploadedFiles.some(isImageFile) && (
        <div className="annotation-helper">
          <label>
            <span>海报批注</span>
            <input
              value={annotationText}
              onChange={(event) => setAnnotationText(event.target.value)}
              placeholder="先写这处的修改意见，再点海报对应位置"
            />
          </label>
          <p>直接点击下方海报上的对应位置即可生成编号批注，批注会自动带入下方的修改意见。</p>
        </div>
      )}

      {uploadedFiles.length > 0 && (
        <div className="uploaded-file-grid">
          {uploadedFiles.map((file) => {
            const fileAnnotations = annotations.filter((item) => item.filePath === file.path);
            if (canReview && isImageFile(file)) {
              return (
                <div className="uploaded-file-card annotatable" key={file.path}>
                  <div className="annotate-surface" onClick={(event) => addAnnotation(event, file)}>
                    <img src={file.url} alt={file.name} />
                    {fileAnnotations.map((annotation) => (
                      <i
                        className="annotation-dot"
                        key={annotation.id}
                        style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}
                        title={annotation.text}
                      >
                        {annotation.number}
                      </i>
                    ))}
                  </div>
                  <span>{file.name}</span>
                  <a href={file.url} target="_blank" rel="noreferrer" className="open-original">
                    打开原图 ↗
                  </a>
                </div>
              );
            }
            return (
              <a href={file.url} target="_blank" rel="noreferrer" className="uploaded-file-card" key={file.path}>
                {isImageFile(file) ? (
                  <img src={file.url} alt={file.name} />
                ) : (
                  <div className="file-placeholder">{file.mimeType.includes("pdf") ? "PDF" : "文件"}</div>
                )}
                <span>{file.name}</span>
                <em>{formatFileSize(file.size)}</em>
              </a>
            );
          })}
        </div>
      )}

      {annotations.length > 0 && (
        <div className="annotation-list">
          <strong>已添加批注（点 × 可删除）</strong>
          {annotations.map((annotation) => (
            <span key={annotation.id}>
              批注{annotation.number}：{annotation.text}
              <button type="button" aria-label="删除该批注" onClick={() => removeAnnotation(annotation.id)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="review-comment-box">
        <label>
          <span>审核修改意见</span>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="例如：价格利益点放大、主菜图片换成更有食欲的、门店名称和活动时间要更醒目"
            disabled={!reviewerCanAct}
            rows={4}
          />
        </label>
        {asset.reviewComment && (
          <p>上次意见：{asset.reviewComment}</p>
        )}
      </div>

      <div className="monitor-actions">
        {activity && <button onClick={() => openActivity(activity.id)}>进入活动</button>}
        <button className="primary" disabled={!canReview} onClick={() => approveDesignAsset(asset.id)}>
          通过
        </button>
        <button disabled={!canReview} onClick={() => rejectDesignAsset(asset.id, comment)}>
          驳回继续修改
        </button>
      </div>
    </article>
  );
}

function TaskView({
  tasks,
  activities,
  designAssets,
  materialTaskStatuses,
  operationSubmissions,
  storeAppointments,
  currentUser,
  completeTask,
  updateTaskStatus,
  submitTaskReport,
  submitLaunchPlan,
  submitOperationSubmission,
  submitOperationCompletionReview,
  resubmitOperationSubmission,
  resubmitActivityProposal,
  getProposalRejectComment,
  approveOperationSubmission,
  rejectOperationSubmission,
  requestDesignForOperation,
  submitStoreReport,
  confirmStoreAppointment,
  approveActivity,
  rejectActivity,
  openActivity,
  goDashboard
}: {
  tasks: Task[];
  activities: Activity[];
  designAssets: DesignAsset[];
  materialTaskStatuses: Record<string, MaterialProductionStatus>;
  operationSubmissions: OperationSubmission[];
  storeAppointments: StoreContentAppointment[];
  currentUser: User;
  completeTask: (id: string) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  submitTaskReport: (taskId: string, note: string, files: UploadedFile[]) => void;
  submitLaunchPlan: (plan: LaunchPlanInput) => void;
  submitOperationSubmission: (input: OperationSubmissionInput) => void;
  submitOperationCompletionReview: (submissionId: string) => void;
  resubmitOperationSubmission: (
    submissionId: string,
    updates: Pick<OperationSubmission, "title" | "benchmarkLinks" | "contentPlan" | "budget">
  ) => void;
  resubmitActivityProposal: (
    activityId: string,
    updates: Pick<Activity, "name" | "startDate" | "endDate" | "budget" | "goal" | "plan" | "storeIds">
  ) => void;
  getProposalRejectComment: (activityId: string) => string;
  approveOperationSubmission: (submissionId: string, comment?: string) => void;
  rejectOperationSubmission: (submissionId: string, comment?: string) => void;
  requestDesignForOperation: (submissionId: string) => void;
  submitStoreReport: (report: StoreReport) => void;
  confirmStoreAppointment: (appointmentId: string, selectedSlot: string) => void;
  approveActivity: (id: string) => void;
  rejectActivity: (id: string, comment: string) => void;
  openActivity: (id: string) => void;
  goDashboard: () => void;
}) {
  if (currentUser.role === "老板") {
    return <BossReviewTaskList tasks={tasks} activities={activities} approveActivity={approveActivity} rejectActivity={rejectActivity} />;
  }

  if (currentUser.role === "品牌负责人") {
    return (
      <BrandLeadTaskView
        tasks={tasks}
        activities={activities}
        operationSubmissions={operationSubmissions}
        currentUser={currentUser}
        submitLaunchPlan={submitLaunchPlan}
        resubmitActivityProposal={resubmitActivityProposal}
        getProposalRejectComment={getProposalRejectComment}
        approveOperationSubmission={approveOperationSubmission}
        rejectOperationSubmission={rejectOperationSubmission}
        openActivity={openActivity}
        goDashboard={goDashboard}
      />
    );
  }

  if (currentUser.role === "内容及投放运营") {
    return (
      <OperationsTaskView
        tasks={tasks}
        activities={activities}
        operationSubmissions={operationSubmissions}
        appointments={storeAppointments}
        currentUser={currentUser}
        submitOperationSubmission={submitOperationSubmission}
        submitOperationCompletionReview={submitOperationCompletionReview}
        resubmitOperationSubmission={resubmitOperationSubmission}
        requestDesignForOperation={requestDesignForOperation}
        openActivity={openActivity}
        goDashboard={goDashboard}
      />
    );
  }

  if (currentUser.role === "设计人员") {
    return (
      <DesignerTaskView
        tasks={tasks}
        activities={activities}
        designAssets={designAssets}
        materialTaskStatuses={materialTaskStatuses}
        openActivity={openActivity}
        goDashboard={goDashboard}
      />
    );
  }

  if (currentUser.role === "店长") {
    return (
      <StoreManagerTaskView
        tasks={tasks}
        activities={activities}
        appointments={storeAppointments}
        currentUser={currentUser}
        confirmStoreAppointment={confirmStoreAppointment}
        updateTaskStatus={updateTaskStatus}
        submitTaskReport={submitTaskReport}
        submitStoreReport={submitStoreReport}
        openActivity={openActivity}
      />
    );
  }

  return (
    <section className="task-board">
      {taskBuckets.map((bucket) => (
        <div className="panel" key={bucket}>
          <div className="panel-title">
            <h3>{bucket}</h3>
            <span>{tasks.filter((task) => task.status === bucket).length}</span>
          </div>
          <div className="task-strip">
            {tasks
              .filter((task) => task.status === bucket)
              .map((task) => {
                const activity = activities.find((item) => item.id === task.activityId);
                return (
                  <div className="task-line" key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <span>{activity?.name} · {task.owner} · {task.dueDate}</span>
                    </div>
                    <div className="task-actions">
                      {task.status !== "已完成" && (
                        <>
                          <button onClick={() => updateTaskStatus(task.id, getNextTaskStatus(task.status))}>
                            {getAdvanceLabel(task.status)}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </section>
  );
}

function DesignerTaskView({
  tasks,
  activities,
  designAssets,
  materialTaskStatuses,
  openActivity,
  goDashboard
}: {
  tasks: Task[];
  activities: Activity[];
  designAssets: DesignAsset[];
  materialTaskStatuses: Record<string, MaterialProductionStatus>;
  openActivity: (id: string) => void;
  goDashboard: () => void;
}) {
  const designTasks = tasks.filter((task) => task.type.includes("设计"));
  const materialTasks = tasks.filter((task) => task.type.includes("物料"));
  const activeDesignTasks = designTasks.filter((task) => task.status !== "已完成");
  const assignedActivityIds = new Set(tasks.map((task) => task.activityId));
  const scopedAssets = designAssets.filter((asset) => assignedActivityIds.has(asset.activityId));
  const reviewingAssets = scopedAssets.filter((asset) => asset.status === "待老板审核");
  const rejectedAssets = scopedAssets.filter((asset) => asset.status === "驳回修改");
  const materialPending = materialTasks.filter(
    (task) => getMaterialProductionStatus(task, materialTaskStatuses) !== "物料到货"
  );
  const dueSoon = tasks.filter((task) => task.status !== "已完成" && daysBetween(TODAY, task.dueDate) <= 3);

  return (
    <div className="page-stack role-task-page">
      <section className="metric-grid">
        <article className="metric-card"><span>待设计单</span><strong>{activeDesignTasks.length}</strong></article>
        <article className="metric-card"><span>审核中</span><strong>{reviewingAssets.length}</strong></article>
        <article className="metric-card"><span>需修改</span><strong>{rejectedAssets.length}</strong></article>
        <article className="metric-card"><span>物料未到货</span><strong>{materialPending.length}</strong></article>
        <article className="metric-card"><span>临期</span><strong>{dueSoon.length}</strong></article>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h3>设计个人待办</h3>
          <span>设计稿和物料节点</span>
        </div>
        <div className="role-task-list">
          {designTasks.length > 0 ? designTasks.map((task) => {
            const activity = activities.find((item) => item.id === task.activityId);
            const latestAsset = getLatestDesignAsset(task.activityId, designAssets);
            const materialTask = materialTasks.find((item) => item.activityId === task.activityId);
            const materialStatus = materialTask ? getMaterialProductionStatus(materialTask, materialTaskStatuses) : undefined;
            const designApproved = isActivityDesignApproved(task.activityId, designAssets);
            const stateLabel =
              latestAsset?.status === "待老板审核"
                ? "等待项目总审核"
                : latestAsset?.status === "驳回修改"
                  ? "需要修改并重提"
                  : designApproved && materialTask && materialStatus !== "物料到货"
                    ? `物料制作：${materialStatus}`
                    : designApproved
                      ? "设计稿已通过"
                      : "待提交设计稿";
            const nextAction =
              latestAsset?.status === "待老板审核"
                ? "等审核结果"
                : latestAsset?.status === "驳回修改"
                  ? "修改后重新提交"
                  : designApproved && materialTask && materialStatus !== "物料到货"
                    ? "推进物料制作"
                    : "提交设计稿";

            return (
              <article className="role-task-card" key={task.id}>
                <div>
                  <b>{stateLabel}</b>
                  <strong>{task.title}</strong>
                  <span>{activity?.brand} · {activity?.name} · 截止 {task.dueDate}</span>
                  <TaskStandard text={task.standard} />
                  {materialTask && <small>物料节点：{materialTask.title} · {materialStatus}</small>}
                </div>
                <div className="node-actions">
                  <button onClick={() => openActivity(task.activityId)}>活动详情</button>
                  <button className="primary" onClick={goDashboard}>{nextAction}</button>
                </div>
              </article>
            );
          }) : (
            <p className="body-copy">暂时没有设计待办。</p>
          )}
        </div>
      </section>

      <DesignerDeadlineChart tasks={tasks} activities={activities} />
    </div>
  );
}

function StoreManagerTaskView({
  tasks,
  activities,
  appointments,
  currentUser,
  confirmStoreAppointment,
  updateTaskStatus,
  submitTaskReport,
  submitStoreReport,
  openActivity
}: {
  tasks: Task[];
  activities: Activity[];
  appointments: StoreContentAppointment[];
  currentUser: User;
  confirmStoreAppointment: (appointmentId: string, selectedSlot: string) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  submitTaskReport: (taskId: string, note: string, files: UploadedFile[]) => void;
  submitStoreReport: (report: StoreReport) => void;
  openActivity: (id: string) => void;
}) {
  function scrollToDailyData() {
    document.getElementById("store-daily-data-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const currentStore = stores.find((store) => store.manager === currentUser.name);
  const storeAppointments = currentStore
    ? appointments.filter((appointment) => appointment.storeId === currentStore.id)
    : [];
  const pendingAppointments = storeAppointments.filter((appointment) => appointment.status === "待店长选择");
  const confirmedAppointments = storeAppointments.filter((appointment) => appointment.status === "已确认");
  const activeTasks = tasks
    .filter((task) => task.status !== "已完成")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueToday = activeTasks.filter((task) => task.dueDate <= TODAY);
  const dataTasks = activeTasks.filter((task) => task.type.includes("数据") || task.title.includes("数据"));

  return (
    <div className="page-stack role-task-page">
      <section className="metric-grid">
        <article className="metric-card"><span>待执行</span><strong>{activeTasks.length}</strong></article>
        <article className="metric-card"><span>今天/逾期</span><strong>{dueToday.length}</strong></article>
        <article className="metric-card"><span>待确认预约</span><strong>{pendingAppointments.length}</strong></article>
        <article className="metric-card"><span>已确认日程</span><strong>{confirmedAppointments.length}</strong></article>
        <article className="metric-card"><span>数据填报</span><strong>{dataTasks.length}</strong></article>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h3>{currentStore?.name ?? "门店"}个人待办</h3>
          <span>执行、拍照、培训和数据填报</span>
        </div>
        <div className="store-task-board">
          {activeTasks.length > 0 ? activeTasks.map((task) => {
            const activity = activities.find((item) => item.id === task.activityId);
            const isDataTask = task.type.includes("数据") || task.title.includes("数据");
            if (isDataTask) {
              return (
                <article className="role-task-card" key={task.id}>
                  <div>
                    <b>需要数据填报</b>
                    <strong>{task.title}</strong>
                    <span>{activity?.name} · 截止 {task.dueDate}</span>
                    <TaskStandard text={task.standard} />
                  </div>
                  <div className="node-actions">
                    <button onClick={() => openActivity(task.activityId)}>活动详情</button>
                    <button className="primary" onClick={scrollToDailyData}>去填今日数据</button>
                  </div>
                </article>
              );
            }
            return (
              <StoreTaskReportCard
                activity={activity}
                key={task.id}
                task={task}
                submitTaskReport={submitTaskReport}
              />
            );
          }) : (
            <p className="body-copy">暂时没有门店执行待办。</p>
          )}
        </div>
      </section>

      <div id="store-daily-data-panel">
        <StoreDailyDataPanel
          currentStore={currentStore}
          activities={activities}
          submitStoreReport={submitStoreReport}
        />
      </div>

      <section className="panel">
        <div className="panel-title">
          <h3>拍摄和直播预约</h3>
          <span>确认后可添加到手机日历</span>
        </div>
        <div className="store-appointment-list">
          {storeAppointments.length > 0 ? storeAppointments.map((appointment) => {
            const activity = activities.find((item) => item.id === appointment.activityId);
            return (
              <article className="store-appointment-card" key={appointment.id}>
                <div>
                  <b>{appointment.type}</b>
                  <strong>{appointment.title}</strong>
                  <span>{activity?.name} · {appointment.requestedBy}</span>
                  <p>{appointment.detail}</p>
                </div>
                {appointment.status === "已确认" ? (
                  <div className="confirmed-calendar-box">
                    <em>已确认：{appointment.selectedSlot}</em>
                    <a download={`${appointment.title}.ics`} href={appointmentCalendarHref(appointment, activity, currentStore)}>
                      添加到手机日历
                    </a>
                  </div>
                ) : (
                  <div className="slot-choice-row">
                    {appointment.candidateSlots.map((slot) => (
                      <button key={slot} onClick={() => confirmStoreAppointment(appointment.id, slot)}>
                        同意 {slot}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            );
          }) : (
            <p className="body-copy">暂时没有运营预约需要确认。</p>
          )}
        </div>
      </section>
    </div>
  );
}

function OperationsTaskView({
  tasks,
  activities,
  operationSubmissions,
  appointments,
  currentUser,
  submitOperationSubmission,
  submitOperationCompletionReview,
  resubmitOperationSubmission,
  requestDesignForOperation,
  openActivity,
  goDashboard
}: {
  tasks: Task[];
  activities: Activity[];
  operationSubmissions: OperationSubmission[];
  appointments: StoreContentAppointment[];
  currentUser: User;
  submitOperationSubmission: (input: OperationSubmissionInput) => void;
  submitOperationCompletionReview: (submissionId: string) => void;
  resubmitOperationSubmission: (
    submissionId: string,
    updates: Pick<OperationSubmission, "title" | "benchmarkLinks" | "contentPlan" | "budget">
  ) => void;
  requestDesignForOperation: (submissionId: string) => void;
  openActivity: (id: string) => void;
  goDashboard: () => void;
}) {
  const [submissionActivityId, setSubmissionActivityId] = useState("");

  function focusSubmissionForm(activityId: string) {
    setSubmissionActivityId(activityId);
    window.setTimeout(() => {
      document.getElementById("operation-submission-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }
  const operationTasks = tasks
    .filter((task) => task.type.includes("内容") || task.type.includes("投流") || task.type.includes("达人"))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const activeTasks = operationTasks.filter((task) => task.status !== "已完成");
  const scopedSubmissions = operationSubmissions.filter((submission) => submission.owner === currentUser.name);
  const pendingReview = scopedSubmissions.filter((submission) => submission.status === "待项目总审核");
  const waitingFinalReview = scopedSubmissions.filter((submission) => isOperationFinalReview(submission.status));
  const completeSubmissions = scopedSubmissions.filter((submission) => isOperationComplete(submission.status));
  const needProposal = activeTasks.filter(
    (task) => !scopedSubmissions.some((submission) => submission.activityId === task.activityId)
  );
  const approvedSubmissions = scopedSubmissions.filter((submission) => submission.status === "审核通过可执行");
  const waitingAppointment = approvedSubmissions.filter(
    (submission) => needsStoreAppointment(submission.type) && !hasConfirmedOperationAppointment(submission, appointments)
  );
  const readyToReport = approvedSubmissions.filter(
    (submission) => !needsStoreAppointment(submission.type) || hasConfirmedOperationAppointment(submission, appointments)
  );

  return (
    <div className="page-stack operation-task-page">
      <section className="metric-grid">
        <article className="metric-card"><span>待提报计划</span><strong>{needProposal.length}</strong></article>
        <article className="metric-card"><span>待审核中</span><strong>{pendingReview.length}</strong></article>
        <article className="metric-card"><span>待预约门店</span><strong>{waitingAppointment.length}</strong></article>
        <article className="metric-card"><span>可回传结果</span><strong>{readyToReport.length}</strong></article>
        <article className="metric-card"><span>待项目总复核</span><strong>{waitingFinalReview.length}</strong></article>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h3>运营个人待办</h3>
          <span>只处理需要运营动作的事项</span>
        </div>
        <div className="operation-task-queue">
          {activeTasks.length > 0 ? activeTasks.map((task) => {
            const activity = activities.find((item) => item.id === task.activityId);
            const submissions = scopedSubmissions.filter((submission) => submission.activityId === task.activityId);
            const approvedSubmission = submissions.find((submission) => submission.status === "审核通过可执行");
            const finalReviewSubmission = submissions.find((submission) => isOperationFinalReview(submission.status));
            const completeSubmission = submissions.find((submission) => isOperationComplete(submission.status));
            const rejectedSubmission = submissions.find((submission) => submission.status === "驳回修改");
            const reviewingSubmission = submissions.find((submission) => submission.status === "待项目总审核");
            const appointmentReady = approvedSubmission
              ? !needsStoreAppointment(approvedSubmission.type) || hasConfirmedOperationAppointment(approvedSubmission, appointments)
              : false;
            const statusText = completeSubmission
              ? "运营节点已完成"
              : finalReviewSubmission
                ? "等待项目总复核"
                : rejectedSubmission
                  ? "被驳回，需重新提报"
                  : reviewingSubmission
                    ? reviewingSubmission.status
                    : approvedSubmission
                      ? appointmentReady ? "可回传执行结果" : "待预约或店长确认"
                      : "待提报运营计划";

            return (
              <article className="operation-task-card" key={task.id}>
                <div>
                  <b>{statusText}</b>
                  <strong>{task.title}</strong>
                  <span>{activity?.brand} · {activity?.name} · 截止 {task.dueDate}</span>
                  <TaskStandard text={task.standard} />
                </div>
                <div className="node-actions">
                  {activity && <button onClick={() => openActivity(activity.id)}>活动详情</button>}
                  {!submissions.length && (
                    <button className="primary" onClick={() => focusSubmissionForm(task.activityId)}>
                      去提报这个项目
                    </button>
                  )}
                  {rejectedSubmission && (
                    <button className="primary" onClick={() => requestOperationResubmit(rejectedSubmission.id)}>
                      按意见修改重提
                    </button>
                  )}
                  {reviewingSubmission && (
                    <button disabled>等待审核</button>
                  )}
                  {approvedSubmission && !appointmentReady && (
                    <button className="primary" onClick={goDashboard}>去首页预约门店</button>
                  )}
                  {approvedSubmission && appointmentReady && (
                    <button className="primary" onClick={() => submitOperationCompletionReview(approvedSubmission.id)}>
                      执行完成，交项目总复核
                    </button>
                  )}
                  {finalReviewSubmission && (
                    <button disabled>等待项目总复核</button>
                  )}
                  {completeSubmission && (
                    <button disabled>节点已完成</button>
                  )}
                </div>
              </article>
            );
          }) : (
            <p className="body-copy">暂时没有运营待处理任务。</p>
          )}
        </div>
      </section>

      <OperationSubmissionPanel
        activities={activities}
        tasks={tasks}
        appointments={appointments}
        operationSubmissions={operationSubmissions}
        selectedActivityId={submissionActivityId}
        setSelectedActivityId={setSubmissionActivityId}
        submitOperationSubmission={submitOperationSubmission}
        submitOperationCompletionReview={submitOperationCompletionReview}
        requestDesignForOperation={requestDesignForOperation}
      />

      <OperationReviewPipelinePanel
        activities={activities}
        appointments={appointments}
        operationSubmissions={scopedSubmissions}
        requestDesignForOperation={requestDesignForOperation}
        submitOperationCompletionReview={submitOperationCompletionReview}
        openActivity={openActivity}
      />
    </div>
  );
}

function OperationResubmitDialog({
  submission,
  activity,
  onClose,
  onSubmit
}: {
  submission: OperationSubmission;
  activity?: Activity;
  onClose: () => void;
  onSubmit: (updates: Pick<OperationSubmission, "title" | "benchmarkLinks" | "contentPlan" | "budget">) => void;
}) {
  const [title, setTitle] = useState(submission.title);
  const [benchmarkLinks, setBenchmarkLinks] = useState(submission.benchmarkLinks);
  const [contentPlan, setContentPlan] = useState(submission.contentPlan);
  const [budget, setBudget] = useState(submission.budget ? String(submission.budget) : "");
  const canSubmit = title.trim() && contentPlan.trim();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card appointment-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>重新提交运营提报</h3>
          <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <p className="modal-sub">
          {submission.type} · {activity?.name ?? "活动"}。请按项目总意见修改后重新提交审核。
        </p>
        {submission.reviewComment && (
          <div className="modal-store-list">
            <strong>项目总驳回意见</strong>
            <span>{submission.reviewComment}</span>
          </div>
        )}
        <div className="appointment-form">
          <label className="full-span">
            <span>提报标题</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="full-span">
            <span>对标内容/链接</span>
            <input value={benchmarkLinks} onChange={(event) => setBenchmarkLinks(event.target.value)} />
          </label>
          <label className="full-span">
            <span>内容方案</span>
            <textarea rows={4} value={contentPlan} onChange={(event) => setContentPlan(event.target.value)} />
          </label>
          <label>
            <span>预算（元，可选）</span>
            <input
              type="number"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              placeholder="如 5000"
            />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button
            className="primary"
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                title: title.trim(),
                benchmarkLinks: benchmarkLinks.trim(),
                contentPlan: contentPlan.trim(),
                budget: budget.trim() ? Number(budget) : undefined
              })
            }
          >
            重新提交审核
          </button>
        </div>
      </div>
    </div>
  );
}

function BrandLeadTaskView({
  tasks,
  activities,
  operationSubmissions,
  currentUser,
  submitLaunchPlan,
  resubmitActivityProposal,
  getProposalRejectComment,
  approveOperationSubmission,
  rejectOperationSubmission,
  openActivity,
  goDashboard
}: {
  tasks: Task[];
  activities: Activity[];
  operationSubmissions: OperationSubmission[];
  currentUser: User;
  submitLaunchPlan: (plan: LaunchPlanInput) => void;
  resubmitActivityProposal: (
    activityId: string,
    updates: Pick<Activity, "name" | "startDate" | "endDate" | "budget" | "goal" | "plan" | "storeIds">
  ) => void;
  getProposalRejectComment: (activityId: string) => string;
  approveOperationSubmission: (submissionId: string, comment?: string) => void;
  rejectOperationSubmission: (submissionId: string, comment?: string) => void;
  openActivity: (id: string) => void;
  goDashboard: () => void;
}) {
  const brand = getUserDefaultBrand(currentUser);
  const brandActivities = activities.filter((activity) => brand === "全部" || activity.brand === brand);
  const brandActivityIds = new Set(brandActivities.map((activity) => activity.id));
  const rejectedProposals = brandActivities.filter((activity) => activity.status === "驳回修改");
  const [proposalResubmitId, setProposalResubmitId] = useState<string | null>(null);
  const proposalResubmitTarget = rejectedProposals.find((activity) => activity.id === proposalResubmitId) ?? null;
  const pendingOperationReviews = operationSubmissions.filter(
    (submission) =>
      brandActivityIds.has(submission.activityId) &&
      (submission.status === "待项目总审核" || isOperationFinalReview(submission.status))
  );
  const scopedTasks = tasks.filter((task) => brandActivityIds.has(task.activityId));
  const launchTasks = scopedTasks.filter((task) => task.title.includes(LAUNCH_PLAN_TASK_MARKER) && task.status !== "已完成");
  const delayedTasks = scopedTasks.filter((task) => task.status !== "已完成" && (task.status === "已延期" || task.dueDate < TODAY));
  const dueSoonTasks = scopedTasks.filter((task) => {
    const days = daysBetween(TODAY, task.dueDate);
    return task.status !== "已完成" && days >= 0 && days <= 3;
  });
  const activeTasks = scopedTasks.filter((task) => task.status !== "已完成");
  const doneTasks = scopedTasks.filter((task) => task.status === "已完成");

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <article className="metric-card"><span>待排期分发</span><strong>{launchTasks.length}</strong></article>
        <article className="metric-card"><span>被驳回待修改</span><strong>{rejectedProposals.length}</strong></article>
        <article className="metric-card"><span>运营待审</span><strong>{pendingOperationReviews.length}</strong></article>
        <article className="metric-card"><span>延误任务</span><strong>{delayedTasks.length}</strong></article>
        <article className="metric-card"><span>三天内到期</span><strong>{dueSoonTasks.length}</strong></article>
      </section>

      {rejectedProposals.length > 0 && (
        <section className="panel">
          <div className="panel-title">
            <h3>老板驳回的提案</h3>
            <span>按意见修改后重新提交，不用新建项目</span>
          </div>
          <div className="project-task-list">
            {rejectedProposals.map((activity) => {
              const comment = getProposalRejectComment(activity.id);
              return (
                <article className="project-task-card priority" key={activity.id}>
                  <div>
                    <strong>{activity.name}</strong>
                    <span>{activity.brand} · {activity.startDate} 至 {activity.endDate} · 预算 {yuan(activity.budget)}</span>
                    {comment && <p>老板意见：{comment}</p>}
                  </div>
                  <div className="node-actions">
                    <button onClick={() => openActivity(activity.id)}>活动详情</button>
                    <button className="primary" onClick={() => setProposalResubmitId(activity.id)}>
                      按意见修改重提
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {pendingOperationReviews.length > 0 && (
        <OperationApprovalPanel
          title="运营提报审核和复核"
          subtitle="在这里查看并通过/驳回运营提交的短视频、直播、达人或投流计划"
          submissions={pendingOperationReviews}
          activities={activities}
          approveOperationSubmission={approveOperationSubmission}
          rejectOperationSubmission={rejectOperationSubmission}
        />
      )}

      {brandActivities.some((activity) => activity.status === "已通过待启动") ? (
        <LaunchPlanPanel
          activities={brandActivities}
          submitLaunchPlan={submitLaunchPlan}
          openActivity={openActivity}
        />
      ) : (
        <section className="panel">
          <div className="panel-title">
            <h3>审核通过后待排期</h3>
            <span>先处理这些项目</span>
          </div>
          <p className="body-copy">暂无老板已通过、等待你拆解节点的项目。</p>
        </section>
      )}

      <section className="two-column">
        <BrandLeadTaskSection
          title="延误任务"
          subtitle={`${delayedTasks.length} 项`}
          tasks={delayedTasks}
          activities={activities}
          openActivity={openActivity}
        />
        <BrandLeadTaskSection
          title="三天内到期"
          subtitle={`${dueSoonTasks.length} 项`}
          tasks={dueSoonTasks}
          activities={activities}
          openActivity={openActivity}
        />
      </section>

      <section className="panel">
        <div className="panel-title">
          <h3>本品牌全部待办</h3>
          <span>{brand === "全部" ? "全部品牌" : brand}</span>
        </div>
        <div className="task-table">
          {activeTasks.map((task) => {
            const activity = activities.find((item) => item.id === task.activityId);
            return (
              <div className="task-table-row" key={task.id}>
                <strong>{task.title}</strong>
                <span>{activity?.name}</span>
                <em>{task.type} · {task.owner}</em>
                <b>{task.dueDate}</b>
                <small>{task.status}</small>
                <div className="task-actions">
                  <button onClick={() => openActivity(task.activityId)}>查看节点</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {proposalResubmitTarget && (
        <ProposalResubmitDialog
          activity={proposalResubmitTarget}
          rejectComment={getProposalRejectComment(proposalResubmitTarget.id)}
          onClose={() => setProposalResubmitId(null)}
          onSubmit={(updates) => {
            resubmitActivityProposal(proposalResubmitTarget.id, updates);
            setProposalResubmitId(null);
          }}
        />
      )}
    </div>
  );
}

function ProposalResubmitDialog({
  activity,
  rejectComment,
  onClose,
  onSubmit
}: {
  activity: Activity;
  rejectComment: string;
  onClose: () => void;
  onSubmit: (
    updates: Pick<Activity, "name" | "startDate" | "endDate" | "budget" | "goal" | "plan" | "storeIds">
  ) => void;
}) {
  const [name, setName] = useState(activity.name);
  const [startDate, setStartDate] = useState(activity.startDate);
  const [endDate, setEndDate] = useState(activity.endDate);
  const [budget, setBudget] = useState(String(activity.budget));
  const [goal, setGoal] = useState(activity.goal);
  const [plan, setPlan] = useState(activity.plan);
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>(activity.storeIds);
  const brandStores = stores.filter((store) => store.brand === activity.brand);
  const canSubmit =
    name.trim() && selectedStoreIds.length > 0 && Number(budget) > 0 && startDate && endDate && startDate <= endDate;

  function toggleStore(storeId: string) {
    setSelectedStoreIds((current) =>
      current.includes(storeId) ? current.filter((id) => id !== storeId) : [...current, storeId]
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card appointment-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>修改提案并重新提交</h3>
          <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {rejectComment && (
          <div className="modal-store-list">
            <strong>老板驳回意见</strong>
            <span>{rejectComment}</span>
          </div>
        )}
        <div className="appointment-form">
          <label className="full-span">
            <span>活动名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>开始日期</span>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label>
            <span>结束日期</span>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          <label>
            <span>预算（元）</span>
            <input type="number" value={budget} onChange={(event) => setBudget(event.target.value)} />
          </label>
          <label className="full-span">
            <span>活动目标</span>
            <textarea rows={2} value={goal} onChange={(event) => setGoal(event.target.value)} />
          </label>
          <label className="full-span">
            <span>活动方案</span>
            <textarea rows={4} value={plan} onChange={(event) => setPlan(event.target.value)} />
          </label>
          <div className="full-span modal-store-list">
            <strong>参与门店（{selectedStoreIds.length} 家）</strong>
            {brandStores.map((store) => (
              <label key={store.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={selectedStoreIds.includes(store.id)}
                  onChange={() => toggleStore(store.id)}
                />
                <span>{store.name} · {store.manager}</span>
              </label>
            ))}
            {brandStores.length === 0 && <span>该品牌暂无门店，请先在基础资料里维护。</span>}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button
            className="primary"
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                startDate,
                endDate,
                budget: Number(budget),
                goal: goal.trim(),
                plan: plan.trim(),
                storeIds: selectedStoreIds
              })
            }
          >
            重新提交给老板审核
          </button>
        </div>
      </div>
    </div>
  );
}

function BrandLeadTaskSection({
  title,
  subtitle,
  tasks,
  activities,
  openActivity
}: {
  title: string;
  subtitle: string;
  tasks: Task[];
  activities: Activity[];
  openActivity: (id: string) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </div>
      <div className="project-task-list">
        {tasks.length > 0 ? (
          tasks.slice(0, 5).map((task) => {
            const activity = activities.find((item) => item.id === task.activityId);
            return (
              <article className="project-task-card" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <span>{activity?.name} · {task.type} · 截止 {task.dueDate}</span>
                  <TaskStandard text={task.standard} />
                </div>
                <div className="node-actions">
                  <button className="primary" onClick={() => openActivity(task.activityId)}>查看节点状态</button>
                </div>
              </article>
            );
          })
        ) : (
          <p className="body-copy">暂无任务。</p>
        )}
      </div>
    </section>
  );
}

function BossReviewTaskList({
  tasks,
  activities,
  approveActivity,
  rejectActivity
}: {
  tasks: Task[];
  activities: Activity[];
  approveActivity: (id: string) => void;
  rejectActivity: (id: string, comment: string) => void;
}) {
  const activeReviewTaskByActivity = new Map(
    tasks.filter((task) => task.status !== "已完成").map((task) => [task.activityId, task])
  );
  const pendingActivities = activities.filter((activity) => needsBossReview(activity.status));
  const pendingTickets = pendingActivities.map((activity) => ({
    activity,
    task:
      activeReviewTaskByActivity.get(activity.id) ??
      ({
        id: `review-${activity.id}`,
        activityId: activity.id,
        title: `老板审核：${activity.name}`,
        type: "审核",
        owner: getBossName(),
        dueDate: addDays(TODAY, 1),
        status: "等待处理",
        standard: "老板通过或驳回项目提报，确认预算和活动方向。",
        isKey: true
      } satisfies Task)
  }));
  const completedTickets = tasks.filter((task) => task.status === "已完成");

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <article className="metric-card"><span>待审核项目</span><strong>{pendingTickets.length}</strong></article>
        <article className="metric-card"><span>已收起项目</span><strong>{completedTickets.length}</strong></article>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h3>项目提报审核票</h3>
          <span>只显示品牌负责人提交的项目计划</span>
        </div>
        <div className="review-ticket-list">
          {pendingTickets.length > 0 ? pendingTickets.map(({ task, activity }) => (
            activity && (
              <BossReviewTicket
                task={task}
                activity={activity}
                approveActivity={approveActivity}
                rejectActivity={rejectActivity}
                key={task.id}
              />
            )
          )) : (
            <p className="body-copy">当前没有需要老板处理的项目提案，已通过或已驳回的项目会自动收起。</p>
          )}
        </div>
      </section>
    </div>
  );
}

function BossReviewTicket({
  task,
  activity,
  approveActivity,
  rejectActivity
}: {
  task: Task;
  activity: Activity;
  approveActivity: (id: string) => void;
  rejectActivity: (id: string, comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  const canAct = task.status !== "已完成" && needsBossReview(activity.status);

  return (
    <article className="review-ticket">
      <div>
        <strong>{activity.name}</strong>
        <span>{activity.brand} · {getActivityOwner(activity)} · {activity.startDate} 至 {activity.endDate}</span>
        <p>{activity.goal}</p>
      </div>
      <dl>
        <div><dt>预算</dt><dd>{yuan(activity.budget)}</dd></div>
        <div><dt>门店</dt><dd>{activity.storeIds.length} 家</dd></div>
        <div><dt>状态</dt><dd>{activityStatusText(activity.status)}</dd></div>
      </dl>
      <label>
        <span>修改建议</span>
        <textarea
          disabled={!canAct}
          rows={3}
          value={comment || (task.status === "已完成" ? task.standard : "")}
          onChange={(event) => setComment(event.target.value)}
          placeholder="例如：补充活动目标、费用明细、门店执行标准、投流预算依据"
        />
      </label>
      <div className="monitor-actions">
        <button className="primary" disabled={!canAct} onClick={() => approveActivity(activity.id)}>通过</button>
        <button disabled={!canAct} onClick={() => rejectActivity(activity.id, comment)}>驳回并给建议</button>
      </div>
    </article>
  );
}

function ActivityDetail({
  activity,
  activities,
  tasks,
  designAssets,
  allDesignAssets,
  materialTaskStatuses,
  operationSubmissions,
  costConfirmedActivityIds,
  approveActivity,
  rejectActivity,
  approveDesignAsset,
  rejectDesignAsset,
  confirmActivityCost,
  currentUser,
  selectActivity
}: {
  activity: Activity;
  activities: Activity[];
  tasks: Task[];
  designAssets: DesignAsset[];
  allDesignAssets: DesignAsset[];
  materialTaskStatuses: Record<string, MaterialProductionStatus>;
  operationSubmissions: OperationSubmission[];
  costConfirmedActivityIds: string[];
  approveActivity: (id: string) => void;
  rejectActivity: (id: string) => void;
  approveDesignAsset: (assetId: string) => void;
  rejectDesignAsset: (assetId: string, comment: string) => void;
  confirmActivityCost: (activityId: string) => void;
  currentUser: User;
  selectActivity: (id: string) => void;
}) {
  const activityReports = storeReports.filter((report) => report.activityId === activity.id);
  const previous = activity.previousActivityId
    ? activities.find((item) => item.id === activity.previousActivityId)
    : undefined;
  const costConfirmed = costConfirmedActivityIds.includes(activity.id);
  const costItems = getActivityCostItems(activity, operationSubmissions, costConfirmed);
  const costTotal = costItems.reduce((sum, item) => sum + item.amount, 0);
  const hasCostItems = costItems.some((item) => item.amount > 0);
  const monitorNodes = getMonitorNodes(activity, tasks, allDesignAssets, materialTaskStatuses, operationSubmissions);
  const canConfirmCost = canManageActivity(currentUser, activity);

  return (
    <div className="page-stack">
      <div className="filter-row">
        <select value={activity.id} onChange={(event) => selectActivity(event.target.value)}>
          {activities.map((item) => (
            <option value={item.id} key={item.id}>{item.name}</option>
          ))}
        </select>
        {needsBossReview(activity.status) && currentUser.role === "老板" && (
          <>
            <button className="primary" onClick={() => approveActivity(activity.id)}>
              通过，交给项目总排期
            </button>
            <button onClick={() => rejectActivity(activity.id)}>驳回修改</button>
          </>
        )}
      </div>

      <section className="detail-grid">
        <article className="panel">
          <div className="panel-title">
            <h3>基本信息</h3>
            <span>{activityStatusText(activity.status)}</span>
          </div>
          <dl className="info-list">
            <div><dt>活动名称</dt><dd>{activity.name}</dd></div>
            <div><dt>品牌</dt><dd>{activity.brand}</dd></div>
            <div><dt>活动类型</dt><dd>{activity.type}</dd></div>
            <div><dt>负责人</dt><dd>{getActivityOwner(activity)}</dd></div>
            <div><dt>时间</dt><dd>{activity.startDate} 至 {activity.endDate}</dd></div>
            <div><dt>预算</dt><dd>{yuan(activity.budget)}</dd></div>
          </dl>
        </article>

        <article className="panel">
          <div className="panel-title">
            <h3>活动方案</h3>
            <span>{activity.scale}</span>
          </div>
          <p className="body-copy">{activity.goal}</p>
          <p className="body-copy">{activity.plan}</p>
        </article>

        <article className="panel">
          <div className="panel-title">
            <h3>活动节点状态</h3>
            <span>{monitorNodes.filter((node) => node.state === "已完成").length}/{monitorNodes.length}</span>
          </div>
          <div className="detail-node-list">
            {monitorNodes.map((node) => (
              <div className={`detail-node-row ${node.state}`} key={node.label}>
                <strong>{node.label}</strong>
                <span>{node.owner}</span>
                <em>截止 {node.dueDate}</em>
                <b>{node.state}</b>
              </div>
            ))}
          </div>
        </article>

        <article className="panel full-span">
          <div className="panel-title">
            <h3>费用明细</h3>
            <span>{hasCostItems ? `${costConfirmed ? "费用已确认" : "待确认"} · 合计 ${yuan(costTotal)}` : "暂无费用明细"}</span>
          </div>
          <div className="cost-detail-list">
            {hasCostItems ? (
              costItems.filter((item) => item.amount > 0).map((item) => (
                <div className="cost-detail-row" key={item.category}>
                  <strong>{item.category}</strong>
                  <span>{item.owner}</span>
                  <p>{item.note}</p>
                  <b>{yuan(item.amount)}</b>
                  <em>{item.status}</em>
                </div>
              ))
            ) : (
              <p className="body-copy">设计、物料、达人、投流等费用真实填报后，会在这里汇总。</p>
            )}
          </div>
          {canConfirmCost && (
            <div className="cost-detail-actions">
              <p>请核对物料、探店达人、广告投流和其他费用。确认无误后，点击费用确认。</p>
              <button className="primary" disabled={costConfirmed || !hasCostItems} onClick={() => confirmActivityCost(activity.id)}>
                {!hasCostItems ? "暂无费用可确认" : costConfirmed ? "费用已确认" : "确认费用"}
              </button>
            </div>
          )}
        </article>

        <article className="panel full-span">
          <div className="panel-title">
            <h3>设计内容审核</h3>
            <span>海报、菜单、抖音商家页</span>
          </div>
          <div className="review-grid compact-grid">
            {designAssets.length > 0 ? (
              designAssets.map((asset) => (
                <DesignAssetCard
                  asset={asset}
                  activity={activity}
                  currentUser={currentUser}
                  approveDesignAsset={approveDesignAsset}
                  rejectDesignAsset={rejectDesignAsset}
                  openActivity={() => undefined}
                  key={asset.id}
                />
              ))
            ) : (
              <p className="body-copy">当前活动还没有设计内容提交审核。</p>
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-title">
            <h3>参与门店</h3>
            <span>{activity.storeIds.length} 家</span>
          </div>
          <div className="store-tags">
            {activity.storeIds.map((id) => {
              const store = stores.find((item) => item.id === id);
              return <span key={id}>{store?.name}</span>;
            })}
          </div>
        </article>

        <article className="panel">
          <div className="panel-title">
            <h3>门店数据</h3>
            <span>{activityReports.length} 家已提交</span>
          </div>
          <div className="rank-list">
            {activityReports.length > 0 ? (
              activityReports.map((report) => {
                const store = stores.find((item) => item.id === report.storeId);
                return (
                  <div className="rank-row readonly" key={report.id}>
                    <span>{report.packageSales}</span>
                    <strong>{store?.name}</strong>
                    <em>客流 {report.visits}</em>
                    <b>{yuan(report.revenue)}</b>
                    {(report.files?.length ?? 0) > 0 && (
                      <i className="report-photo-strip">
                        {report.files!.map((file) => (
                          <a href={file.url} target="_blank" rel="noreferrer" key={file.path}>
                            <img src={file.url} alt={file.name} />
                          </a>
                        ))}
                      </i>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="body-copy">暂无门店填报数据。</p>
            )}
          </div>
        </article>

        {tasks.some((task) => (task.reportFiles?.length ?? 0) > 0) && (
          <article className="panel">
            <div className="panel-title">
              <h3>门店执行汇报照片</h3>
              <span>店长提交的现场完成凭证</span>
            </div>
            <div className="report-evidence-list">
              {tasks
                .filter((task) => (task.reportFiles?.length ?? 0) > 0)
                .map((task) => (
                  <div className="report-evidence-row" key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <em>{task.owner} · {task.status}</em>
                    </div>
                    <i className="report-photo-strip">
                      {task.reportFiles!.map((file) => (
                        <a href={file.url} target="_blank" rel="noreferrer" key={file.path}>
                          <img src={file.url} alt={file.name} />
                        </a>
                      ))}
                    </i>
                  </div>
                ))}
            </div>
          </article>
        )}

        <article className="panel">
          <div className="panel-title">
            <h3>复盘和历史</h3>
            <span>{previous ? "有关联活动" : "暂无历史"}</span>
          </div>
          {previous ? (
            <p className="body-copy">
              上一年度活动：{previous.name}。历史问题：物料到店偏晚，部分门店套餐口径不统一。下一年建议：提前完成物料，增加儿童餐和短视频预热。
            </p>
          ) : (
            <p className="body-copy">活动完成后可填写亮点、问题、顾客反馈和下一年度建议。</p>
          )}
        </article>
      </section>
    </div>
  );
}

function IdeaPool({
  ideas,
  convertIdeaToActivity
}: {
  ideas: Idea[];
  convertIdeaToActivity: (ideaId: string) => void;
}) {
  return (
    <section className="idea-grid">
      {ideas.map((idea) => (
        <article className="panel" key={idea.id}>
          <div className="panel-title">
            <h3>{idea.title}</h3>
            <span>{idea.status}</span>
          </div>
          <dl className="info-list">
            <div><dt>来源平台</dt><dd>{idea.platform}</dd></div>
            <div><dt>适用品牌</dt><dd>{idea.brands.join("、")}</dd></div>
            <div><dt>初步预算</dt><dd>{yuan(idea.budget)}</dd></div>
          </dl>
          <p className="body-copy">{idea.suggestion}</p>
          <button
            className="primary"
            disabled={idea.status === "已转活动"}
            onClick={() => convertIdeaToActivity(idea.id)}
          >
            {idea.status === "已转活动" ? "已转为活动" : "转换为正式活动"}
          </button>
        </article>
      ))}
    </section>
  );
}

function Analytics({ activities }: { activities: Activity[] }) {
  const visibleActivityIds = new Set(activities.map((activity) => activity.id));
  const scopedReports = storeReports.filter((report) => visibleActivityIds.has(report.activityId));
  const totals = scopedReports.reduce(
    (sum, report) => ({
      revenue: sum.revenue + report.revenue,
      before: sum.before + report.beforeValue,
      lastYear: sum.lastYear + report.lastYearValue,
      visits: sum.visits + report.visits
    }),
    { revenue: 0, before: 0, lastYear: 0, visits: 0 }
  );
  const beforeChange = totals.before ? ((totals.revenue - totals.before) / totals.before) * 100 : 0;
  const lastYearChange = totals.lastYear ? ((totals.revenue - totals.lastYear) / totals.lastYear) * 100 : 0;

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <article className="metric-card"><span>活动营业额</span><strong>{yuan(totals.revenue)}</strong></article>
        <article className="metric-card"><span>到店客流</span><strong>{totals.visits}</strong></article>
        <article className="metric-card"><span>活动前对比</span><strong>{beforeChange.toFixed(1)}%</strong></article>
        <article className="metric-card"><span>去年同期对比</span><strong>{lastYearChange.toFixed(1)}%</strong></article>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h3>门店排名</h3>
          <span>按营业额</span>
        </div>
        <div className="rank-list">
          {scopedReports.length > 0 ? (
            scopedReports
              .slice()
              .sort((a, b) => b.revenue - a.revenue)
              .map((report, index) => {
              const activity = activities.find((item) => item.id === report.activityId);
              const store = stores.find((item) => item.id === report.storeId);
              return (
                <div className="rank-row readonly" key={report.id}>
                  <span>{index + 1}</span>
                  <strong>{store?.name}</strong>
                  <em>{activity?.brand} · {report.note}</em>
                  <b>{yuan(report.revenue)}</b>
                </div>
              );
            })
          ) : (
            <p className="body-copy">暂无门店填报数据，活动执行后由店长每日上报。</p>
          )}
        </div>
      </section>
    </div>
  );
}

function LocalSetup() {
  return (
    <section className="setup-grid">
      <article className="panel">
        <div className="panel-title">
          <h3>当前试用阶段</h3>
          <span>Supabase 云端同步</span>
        </div>
        <p className="body-copy">
          未配置 Supabase 时继续使用本地演示数据；配置后，活动、任务、设计稿、运营提报和门店预约会通过 /api/marketing-state 同步到云端 PostgreSQL。
        </p>
      </article>
      <article className="panel">
        <div className="panel-title">
          <h3>后续上云路线</h3>
          <span>腾讯云兼容</span>
        </div>
        <p className="body-copy">
          数据库用标准 PostgreSQL，文件只保存对象路径。之后迁到 TencentDB for PostgreSQL 和 COS 时，页面不用大改。
        </p>
      </article>
      <article className="panel">
        <div className="panel-title">
          <h3>本地命令</h3>
          <span>开发启动</span>
        </div>
        <pre className="code-block">npm.cmd install{`\n`}npm.cmd run dev</pre>
      </article>
    </section>
  );
}
