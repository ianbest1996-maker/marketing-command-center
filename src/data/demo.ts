import type {
  Activity,
  ActivityStatus,
  DesignAsset,
  Idea,
  OperationSubmission,
  Store,
  StoreContentAppointment,
  StoreReport,
  Task,
  User
} from "@/types";

export const users: User[] = [
  { id: "u1", name: "闫总", role: "老板" },
  { id: "u2", name: "段强建", role: "品牌负责人" },
  { id: "u3", name: "彭天成", role: "品牌负责人" },
  { id: "u4", name: "李小建", role: "品牌负责人" },
  { id: "u5", name: "陈设计", role: "设计人员" },
  { id: "u6", name: "刘运营", role: "内容及投放运营" },
  { id: "u8", name: "张店长", role: "店长" },
  { id: "u9", name: "孙店长", role: "店长" }
];

export const stores: Store[] = [
  { id: "s1", name: "中餐解放路店", brand: "中餐", manager: "张店长" },
  { id: "s2", name: "中餐万达店", brand: "中餐", manager: "孙店长" },
  { id: "s3", name: "中餐高铁店", brand: "中餐", manager: "何店长" },
  { id: "s4", name: "知福居火锅旗舰店", brand: "火锅", manager: "曹店长" },
  { id: "s5", name: "知福居火锅万象城店", brand: "火锅", manager: "吕店长" },
  { id: "s6", name: "知福居火锅开发区店", brand: "火锅", manager: "高店长" },
  { id: "s7", name: "天然居虾锅总店", brand: "虾锅", manager: "马店长" },
  { id: "s8", name: "天然居虾锅北城店", brand: "虾锅", manager: "吴店长" },
  { id: "s9", name: "天然居虾锅南城店", brand: "虾锅", manager: "郑店长" }
];

export const statuses: ActivityStatus[] = [
  "灵感池",
  "方案准备",
  "待老板审核",
  "驳回修改",
  "已通过待启动",
  "设计和物料",
  "平台和内容准备",
  "门店执行准备",
  "活动进行中",
  "数据收集中",
  "待复盘",
  "已完成",
  "已取消"
];

export const initialActivities: Activity[] = [
  {
    id: "a1",
    name: "2026端午门店氛围活动",
    type: "固定节日活动",
    brand: "中餐",
    storeIds: ["s1", "s2", "s3"],
    scale: "节日氛围活动",
    owner: "段强建",
    startDate: "2026-06-15",
    endDate: "2026-06-22",
    prepStartDate: "2026-06-01",
    goal: "提升端午期间门店到店客流和家宴套餐销量。",
    plan: "统一端午主视觉，门店布置粽子和家宴氛围，各门店独立填报套餐销量和现场照片。",
    budget: 60000,
    actualCost: 42300,
    status: "活动进行中",
    previousActivityId: "a8"
  },
  {
    id: "a2",
    name: "2026火锅冬季暖锅节",
    type: "品牌年度活动",
    brand: "火锅",
    storeIds: ["s4", "s5", "s6"],
    scale: "大型活动",
    owner: "彭天成",
    startDate: "2026-11-15",
    endDate: "2026-12-31",
    prepStartDate: "2026-09-15",
    goal: "建立冬季火锅强心智，带动会员储值和套餐销售。",
    plan: "围绕鲜切牛肉和酸菜锅底做内容种草，配合达人探店、会员储值券和门店暖冬布置。",
    budget: 120000,
    actualCost: 0,
    status: "已通过待启动"
  },
  {
    id: "a3",
    name: "虾锅夏季啤酒夜宵季",
    type: "品牌年度活动",
    brand: "虾锅",
    storeIds: ["s7", "s8", "s9"],
    scale: "普通活动",
    owner: "李小建",
    startDate: "2026-07-01",
    endDate: "2026-08-31",
    prepStartDate: "2026-06-01",
    goal: "做强虾锅夏季夜宵场景，提升 21 点后营业额。",
    plan: "推出啤酒虾锅双人和四人套餐，配合夜宵短视频、达人探店和门店现场氛围。",
    budget: 90000,
    actualCost: 15600,
    status: "平台和内容准备"
  },
  {
    id: "a4",
    name: "中餐升学宴推广",
    type: "临时营销活动",
    brand: "中餐",
    storeIds: ["s1", "s2"],
    scale: "普通活动",
    owner: "段强建",
    startDate: "2026-07-15",
    endDate: "2026-08-20",
    prepStartDate: "2026-06-20",
    goal: "获取暑期升学宴和谢师宴预订线索。",
    plan: "先在核心门店测试升学宴套餐，内容重点展示包间、菜品和服务仪式感。",
    budget: 70000,
    actualCost: 0,
    status: "待老板审核"
  },
  {
    id: "a5",
    name: "抖音爆款牛肉双人套餐临时测试",
    type: "临时营销活动",
    brand: "火锅",
    storeIds: ["s4", "s5", "s6"],
    scale: "普通活动",
    owner: "彭天成",
    startDate: "2026-06-24",
    endDate: "2026-06-30",
    prepStartDate: "2026-06-11",
    goal: "验证抖音低价双人套餐对新客到店的带动。",
    plan: "选择 3 家火锅门店上架双人套餐，配合短视频和本地达人探店。",
    budget: 18000,
    actualCost: 6200,
    status: "设计和物料"
  },
  {
    id: "a6",
    name: "虾锅618团购冲刺活动",
    type: "固定节日活动",
    brand: "虾锅",
    storeIds: ["s7", "s8", "s9"],
    scale: "节日氛围活动",
    owner: "李小建",
    startDate: "2026-06-18",
    endDate: "2026-06-23",
    prepStartDate: "2026-06-04",
    goal: "提高虾锅团购券销量和周末到店客流。",
    plan: "618 当天加推团购券，投流预算集中在 6 月 18 日至 20 日。",
    budget: 45000,
    actualCost: 38200,
    status: "数据收集中"
  },
  {
    id: "a7",
    name: "五一家庭聚餐活动",
    type: "固定节日活动",
    brand: "火锅",
    storeIds: ["s4", "s5", "s6"],
    scale: "普通活动",
    owner: "彭天成",
    startDate: "2026-05-01",
    endDate: "2026-05-05",
    prepStartDate: "2026-04-01",
    goal: "五一期间提升家庭聚餐客流。",
    plan: "上线家庭套餐，门店布置五一主题台卡，平台发布假期聚餐内容。",
    budget: 50000,
    actualCost: 46800,
    status: "已完成"
  },
  {
    id: "a8",
    name: "2025中餐端午家宴套餐",
    type: "品牌年度活动",
    brand: "中餐",
    storeIds: ["s1", "s2", "s3"],
    scale: "普通活动",
    owner: "段强建",
    startDate: "2025-05-25",
    endDate: "2025-06-02",
    prepStartDate: "2025-04-20",
    goal: "提升端午家庭聚餐预订和套餐销售。",
    plan: "4-6 人家宴套餐，搭配粽子伴手礼和包间预订权益。",
    budget: 48000,
    actualCost: 51200,
    status: "已完成"
  }
];

export const initialTasks: Task[] = [
  { id: "t1", activityId: "a1", title: "端午主视觉设计", type: "设计", owner: "陈设计", dueDate: "2026-06-10", status: "已完成", standard: "主视觉、菜单、台卡全部上传。", isKey: true },
  { id: "t2", activityId: "a1", title: "门店海报物料到店确认", type: "物料", owner: "陈设计", dueDate: "2026-06-18", status: "进行中", standard: "所有门店确认物料到店。", isKey: true },
  { id: "t3", activityId: "a1", title: "高铁店现场布置和照片上传", type: "门店执行", owner: "何店长", storeId: "s3", dueDate: "2026-06-19", status: "已延期", standard: "上传不少于 3 张现场照片。", isKey: true },
  { id: "t4", activityId: "a4", title: "老板审核升学宴方案", type: "审核", owner: "闫总", dueDate: "2026-06-20", status: "等待处理", standard: "通过或驳回活动。", isKey: true },
  { id: "t5", activityId: "a5", title: "测试套餐上线素材设计", type: "设计", owner: "陈设计", dueDate: "2026-06-19", status: "已延期", standard: "完成团购封面和门店海报。", isKey: true },
  { id: "t6", activityId: "a6", title: "618门店数据回收", type: "数据", owner: "李小建", dueDate: "2026-06-23", status: "待开始", standard: "所有虾锅门店完成数据填报。", isKey: true },
  { id: "t7", activityId: "a3", title: "夜宵短视频脚本", type: "内容", owner: "刘运营", dueDate: "2026-06-21", status: "进行中", standard: "完成 5 条脚本和拍摄清单。", isKey: true },
  { id: "t8", activityId: "a1", title: "解放路店员工培训和物料拍照", type: "门店执行", owner: "张店长", storeId: "s1", dueDate: "2026-06-22", status: "待开始", standard: "完成端午套餐口径培训，上传海报、台卡、菜单摆放照片。", isKey: true },
  { id: "t9", activityId: "a1", title: "万达店员工培训和物料拍照", type: "门店执行", owner: "孙店长", storeId: "s2", dueDate: "2026-06-22", status: "进行中", standard: "完成端午套餐口径培训，上传海报、台卡、菜单摆放照片。", isKey: true }
];

export const initialDesignAssets: DesignAsset[] = [
  {
    id: "d1",
    activityId: "a1",
    title: "端午家宴主海报",
    type: "海报",
    purpose: "门店入口海报、朋友圈转发和大众点评活动图",
    fileNames: ["端午家宴主海报-门店版.jpg", "端午家宴主海报-朋友圈版.jpg"],
    designer: "陈设计",
    version: 2,
    status: "待老板审核",
    submittedAt: "2026-06-20",
    previewTitle: "端午家宴",
    previewSubtitle: "三代同堂  团圆一桌",
    previewCta: "提前预订包间"
  },
  {
    id: "d2",
    activityId: "a1",
    title: "端午套餐菜单",
    type: "菜单",
    purpose: "堂食菜单夹页和包间点餐推荐",
    fileNames: ["端午套餐菜单-4人餐.jpg", "端午套餐菜单-8人餐.jpg"],
    designer: "陈设计",
    version: 1,
    status: "已通过",
    submittedAt: "2026-06-18",
    reviewedAt: "2026-06-19",
    reviewer: "闫总",
    reviewComment: "菜品结构清楚，可以下发门店。",
    previewTitle: "家宴套餐",
    previewSubtitle: "4-6人餐 / 8-10人餐",
    previewCta: "粽香伴手礼"
  },
  {
    id: "d3",
    activityId: "a5",
    title: "抖音双人套餐商家页",
    type: "抖音商家页面",
    purpose: "抖音团购商家页首屏和套餐详情图",
    fileNames: ["抖音双人套餐首屏.jpg", "抖音双人套餐详情1.jpg", "抖音双人套餐详情2.jpg"],
    designer: "陈设计",
    version: 1,
    status: "驳回修改",
    submittedAt: "2026-06-19",
    reviewedAt: "2026-06-20",
    reviewer: "闫总",
    reviewComment: "价格利益点不够醒目，套餐内容需要放到首屏，图片换成更有食欲的牛肉特写。",
    previewTitle: "鲜切牛肉双人餐",
    previewSubtitle: "抖音团购限时上架",
    previewCta: "立即抢购"
  },
  {
    id: "d4",
    activityId: "a6",
    title: "618虾锅团购封面",
    type: "团购封面",
    purpose: "抖音团购封面、美团套餐封面和门店收银台提示图",
    fileNames: ["618虾锅团购封面.jpg", "618虾锅套餐详情.jpg"],
    designer: "陈设计",
    version: 3,
    status: "待老板审核",
    submittedAt: "2026-06-20",
    previewTitle: "618虾锅冲刺",
    previewSubtitle: "双人套餐 限时团购",
    previewCta: "今晚开吃"
  },
  {
    id: "d5",
    activityId: "a3",
    title: "夏季夜宵门店台卡",
    type: "门店物料",
    purpose: "门店桌面台卡、吧台物料和夜宵氛围露出",
    fileNames: ["夜宵台卡正面.jpg", "夜宵台卡背面.jpg", "吧台立牌.jpg"],
    designer: "陈设计",
    version: 1,
    status: "设计中",
    submittedAt: "2026-06-20",
    previewTitle: "夜宵啤酒季",
    previewSubtitle: "虾锅 + 鲜啤 + 朋友局",
    previewCta: "21点后开场"
  }
];

export const reports: StoreReport[] = [
  { id: "r1", activityId: "a1", storeId: "s1", packageSales: 138, revenue: 42800, visits: 610, beforeValue: 36200, lastYearValue: 33500, note: "家庭客较多，粽子伴手礼受欢迎。", submittedAt: "2026-06-20" },
  { id: "r2", activityId: "a1", storeId: "s2", packageSales: 121, revenue: 38900, visits: 540, beforeValue: 35100, lastYearValue: 32200, note: "商场客流好，包间咨询多。", submittedAt: "2026-06-20" },
  { id: "r3", activityId: "a6", storeId: "s7", packageSales: 232, revenue: 51800, visits: 720, beforeValue: 41000, lastYearValue: 38600, note: "团购券核销集中在晚市。", submittedAt: "2026-06-20" },
  { id: "r4", activityId: "a6", storeId: "s9", packageSales: 176, revenue: 39200, visits: 530, beforeValue: 31800, lastYearValue: 29000, note: "夜市客流明显增加。", submittedAt: "2026-06-20" }
];

export const initialStoreAppointments: StoreContentAppointment[] = [
  {
    id: "sa1",
    activityId: "a4",
    storeId: "s1",
    type: "短视频拍摄",
    title: "升学宴包间和上菜仪式实拍",
    requestedBy: "刘运营",
    detail: "需要店长安排包间、服务员口径和 2 道主推菜，拍摄 30 秒短视频素材。",
    candidateSlots: ["06-23 10:00-11:00", "06-23 15:00-16:00", "06-24 14:00-15:00"],
    status: "待店长选择",
    createdAt: "2026-06-21"
  },
  {
    id: "sa2",
    activityId: "a1",
    storeId: "s1",
    type: "直播配合",
    title: "端午家宴晚市直播连线",
    requestedBy: "刘运营",
    detail: "晚市高峰展示包间和家宴套餐，店长提前安排一桌可拍摄区域。",
    candidateSlots: ["06-22 18:30-19:30", "06-23 18:30-19:30"],
    selectedSlot: "06-22 18:30-19:30",
    status: "已确认",
    createdAt: "2026-06-20"
  },
  {
    id: "sa3",
    activityId: "a4",
    storeId: "s2",
    type: "短视频拍摄",
    title: "谢师宴菜单讲解素材",
    requestedBy: "刘运营",
    detail: "拍摄店长介绍套餐亮点、停车和包间信息，用于抖音本地生活素材。",
    candidateSlots: ["06-24 11:00-12:00", "06-24 16:00-17:00", "06-25 10:30-11:30"],
    status: "待店长选择",
    createdAt: "2026-06-21"
  }
];

export const initialOperationSubmissions: OperationSubmission[] = [
  {
    id: "op1",
    activityId: "a4",
    type: "短视频计划",
    title: "升学宴包间短视频内容计划",
    owner: "刘运营",
    benchmarkLinks: "抖音：本地升学宴包间案例；小红书：谢师宴菜单实拍笔记",
    contentPlan: "对标本地宴席号，拍包间、上菜仪式、菜单价格和停车信息，计划 3 条短视频。",
    status: "审核通过可执行",
    submittedAt: "2026-06-20",
    reviewComment: "项目总已通过，可以和门店预约拍摄时间。"
  },
  {
    id: "op2",
    activityId: "a1",
    type: "直播计划",
    title: "端午家宴晚市直播计划",
    owner: "刘运营",
    benchmarkLinks: "抖音：本地餐饮晚市直播间；大众点评：家宴套餐讲解图",
    contentPlan: "直播 60 分钟，讲解端午套餐、包间权益和伴手礼，需要门店预留可拍区域。",
    needDesign: true,
    designRequest: "需要设计 3 张直播商品图：家宴套餐、包间权益、粽子伴手礼。",
    status: "待项目总审核",
    submittedAt: "2026-06-21"
  },
  {
    id: "op3",
    activityId: "a6",
    type: "投流计划",
    title: "虾锅618团购冲刺投流计划",
    owner: "刘运营",
    benchmarkLinks: "抖音本地生活：夜宵团购素材；巨量本地推：套餐转化案例",
    contentPlan: "投放团购封面和门店夜宵素材，重点看曝光、点击、成交额和 ROI。",
    budget: 12800,
    status: "待项目总审核",
    submittedAt: "2026-06-21"
  }
];

export const ideas: Idea[] = [
  { id: "i1", title: "抖音爆款牛肉双人套餐测试", platform: "抖音", url: "https://example.com/douyin/hotpot-combo", brands: ["火锅"], budget: 18000, suggestion: "先选 3 家火锅门店测试 7 天。", status: "已转活动" },
  { id: "i2", title: "虾锅啤酒夜宵挑战赛", platform: "小红书", url: "https://example.com/xhs/beer-night", brands: ["虾锅"], budget: 26000, suggestion: "结合本地啤酒节，增加门店现场照片上传任务。", status: "已通过" },
  { id: "i3", title: "中餐谢师宴短视频系列", platform: "抖音", url: "https://example.com/douyin/teacher-banquet", brands: ["中餐"], budget: 35000, suggestion: "先做 3 条真实宴席短视频。", status: "待评估" }
];
