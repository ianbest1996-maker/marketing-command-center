export type Role =
  | "老板"
  | "品牌负责人"
  | "设计人员"
  | "内容及投放运营"
  | "店长";

export type Brand = "中餐" | "火锅" | "虾锅";

export type ActivityType = "固定节日活动" | "品牌年度活动" | "临时营销活动";

export type ActivityScale = "大型活动" | "普通活动" | "节日氛围活动";

export type ActivityStatus =
  | "灵感池"
  | "方案准备"
  | "待老板审核"
  | "驳回修改"
  | "已通过待启动"
  | "设计和物料"
  | "平台和内容准备"
  | "门店执行准备"
  | "活动进行中"
  | "数据收集中"
  | "待复盘"
  | "已完成"
  | "已取消";

export type TaskStatus = "等待处理" | "待开始" | "进行中" | "已完成" | "已延期";

export type DesignAssetStatus = "设计中" | "待老板审核" | "已通过" | "驳回修改";

export type DesignAssetType = "海报" | "菜单" | "抖音商家页面" | "团购封面" | "门店物料";

export interface UploadedFile {
  name: string;
  path: string;
  url: string;
  mimeType: string;
  size: number;
}

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface Store {
  id: string;
  name: string;
  brand: Brand;
  manager: string;
}

export interface Activity {
  id: string;
  name: string;
  type: ActivityType;
  brand: Brand;
  storeIds: string[];
  scale: ActivityScale;
  owner: string;
  startDate: string;
  endDate: string;
  prepStartDate: string;
  goal: string;
  plan: string;
  budget: number;
  actualCost: number;
  status: ActivityStatus;
  previousActivityId?: string;
  // 活动复盘归档内容（项目总在活动详情填写）。
  reviewSummary?: string;
}

// 设计部记录的物料供应商报价（留档用）。
export interface MaterialQuote {
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

export interface Task {
  id: string;
  activityId: string;
  title: string;
  type: string;
  owner: string;
  storeId?: string;
  dueDate: string;
  status: TaskStatus;
  standard: string;
  isKey: boolean;
  // 任务完成汇报附带的照片（如门店现场照），真实存储于对象存储。
  reportFiles?: UploadedFile[];
}

export interface DesignAsset {
  id: string;
  activityId: string;
  title: string;
  type: DesignAssetType;
  purpose?: string;
  fileNames?: string[];
  files?: UploadedFile[];
  designer: string;
  version: number;
  status: DesignAssetStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewer?: string;
  reviewComment?: string;
  previewTitle: string;
  previewSubtitle: string;
  previewCta: string;
}

export interface StoreReport {
  id: string;
  activityId: string;
  storeId: string;
  packageSales: number;
  revenue: number;
  visits: number;
  beforeValue: number;
  lastYearValue: number;
  note: string;
  submittedAt?: string;
  // 每日数据附带的现场照片。
  files?: UploadedFile[];
}

export type StoreContentAppointmentType = "短视频拍摄" | "直播配合";

export type StoreContentAppointmentStatus = "待店长选择" | "已确认" | "需改期";

export interface StoreContentAppointment {
  id: string;
  activityId: string;
  storeId: string;
  type: StoreContentAppointmentType;
  title: string;
  requestedBy: string;
  detail: string;
  candidateSlots: string[];
  selectedSlot?: string;
  status: StoreContentAppointmentStatus;
  createdAt: string;
}

export type OperationSubmissionType = "短视频计划" | "直播计划" | "投流计划" | "达人邀请";

export type OperationSubmissionStatus =
  | "草稿"
  | "待项目总审核"
  | "审核通过可执行"
  | "执行完成待项目总复核"
  | "执行复核通过"
  | "驳回修改";

export interface OperationSubmission {
  id: string;
  activityId: string;
  type: OperationSubmissionType;
  title: string;
  owner: string;
  benchmarkLinks: string;
  contentPlan: string;
  budget?: number;
  needDesign?: boolean;
  designRequest?: string;
  status: OperationSubmissionStatus;
  submittedAt: string;
  reviewComment?: string;
}

export interface Idea {
  id: string;
  title: string;
  platform: string;
  url: string;
  brands: Brand[];
  budget: number;
  suggestion: string;
  status: "待评估" | "已通过" | "已转活动";
}

export interface MarketingState {
  brandLeaders?: Record<Brand, string>;
  users: User[];
  stores: Store[];
  activities: Activity[];
  tasks: Task[];
  designAssets: DesignAsset[];
  ideas: Idea[];
  storeAppointments: StoreContentAppointment[];
  operationSubmissions: OperationSubmission[];
  storeReports: StoreReport[];
  materialQuotes: MaterialQuote[];
  costConfirmedActivityIds: string[];
  materialTaskStatuses: Record<string, string>;
}

// 增量同步：只描述「这次改了哪些条目」，避免每次保存都整库覆盖。
export interface CollectionDelta<T> {
  upserts: T[];
  deleteIds: string[];
}

export interface MarketingStateDelta {
  brandLeaders?: Record<Brand, string>;
  users?: CollectionDelta<User>;
  stores?: CollectionDelta<Store>;
  activities?: CollectionDelta<Activity>;
  tasks?: CollectionDelta<Task>;
  designAssets?: CollectionDelta<DesignAsset>;
  ideas?: CollectionDelta<Idea>;
  storeAppointments?: CollectionDelta<StoreContentAppointment>;
  operationSubmissions?: CollectionDelta<OperationSubmission>;
  storeReports?: CollectionDelta<StoreReport>;
  materialQuotes?: CollectionDelta<MaterialQuote>;
  costConfirmedActivityIds?: { added: string[]; removed: string[] };
  materialTaskStatuses?: { upserts: Record<string, string>; deleteIds: string[] };
}
