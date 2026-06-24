import type {
  Activity,
  Brand,
  DesignAsset,
  Idea,
  MarketingState,
  MarketingStateDelta,
  OperationSubmission,
  Store,
  StoreContentAppointment,
  Task,
  UploadedFile,
  User
} from "@/types";

const DEFAULT_BRAND_LEADERS: Record<Brand, string> = {
  中餐: "段强建",
  火锅: "彭天成",
  虾锅: "李小建"
};

const MANAGED_BRANDS: Brand[] = ["中餐", "火锅", "虾锅"];

class SupabaseConfigError extends Error {
  constructor() {
    super("Supabase is not configured.");
  }
}

type AnyRow = Record<string, unknown>;

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new SupabaseConfigError();
  }

  return { url, serviceRoleKey };
}

async function supabaseRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${message}`);
  }

  if (response.status === 204) return null as T;

  const text = await response.text();
  if (!text.trim()) return null as T;

  return JSON.parse(text) as T;
}

async function readTable<T extends AnyRow>(table: string, order = "id.asc") {
  return supabaseRequest<T[]>(`${table}?select=*&order=${order}`);
}

async function clearTable(table: string, key = "id") {
  await supabaseRequest(`${table}?${key}=neq.__never__`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
}

async function upsertRows(table: string, rows: AnyRow[], onConflict = "id") {
  if (rows.length === 0) return;

  await supabaseRequest(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
}

// 按 id 删除指定行（PostgREST 的 in 过滤），不再整表清空。
async function deleteByIds(table: string, ids: string[], column = "id") {
  if (ids.length === 0) return;
  const list = ids.map((id) => encodeURIComponent(id)).join(",");
  await supabaseRequest(`${table}?${column}=in.(${list})`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
}

// 删除单个父行可能因外键失败（例如门店仍被活动引用），此处吞掉外键冲突，
// 让其余同步照常进行，与旧版「门店只增不删」的行为保持一致的安全性。
async function deleteByIdsSafe(table: string, ids: string[], column = "id") {
  try {
    await deleteByIds(table, ids, column);
  } catch (error) {
    console.error(`删除 ${table} 中的部分记录失败（可能仍被引用）：`, error);
  }
}

function toUser(row: AnyRow): User {
  return {
    id: String(row.id),
    name: String(row.name),
    role: row.role as User["role"]
  };
}

function fromUser(user: User): AnyRow {
  return {
    id: user.id,
    name: user.name,
    role: user.role
  };
}

function toStore(row: AnyRow): Store {
  return {
    id: String(row.id),
    name: String(row.name),
    brand: row.brand as Store["brand"],
    manager: String(row.manager)
  };
}

function fromStore(store: Store): AnyRow {
  return {
    id: store.id,
    name: store.name,
    brand: store.brand,
    manager: store.manager
  };
}

function normalizeBrandLeaders(input?: Partial<Record<Brand, string>>) {
  const next = { ...DEFAULT_BRAND_LEADERS };
  MANAGED_BRANDS.forEach((brand) => {
    const owner = input?.[brand]?.trim();
    if (owner) next[brand] = owner;
  });
  return next;
}

function deriveBrandLeaders(brandRows: AnyRow[], activityRows: AnyRow[]) {
  const fromBrandRows = Object.fromEntries(
    brandRows
      .map((row) => [String(row.name), row.owner ? String(row.owner) : ""])
      .filter(([brand, owner]) => MANAGED_BRANDS.includes(brand as Brand) && owner)
  ) as Partial<Record<Brand, string>>;

  const next = normalizeBrandLeaders(fromBrandRows);
  MANAGED_BRANDS.forEach((brand) => {
    if (fromBrandRows[brand]) return;
    const owners = activityRows
      .filter((row) => row.brand === brand && row.owner)
      .map((row) => String(row.owner));
    const ownerCounts = new Map<string, number>();
    owners.forEach((owner) => ownerCounts.set(owner, (ownerCounts.get(owner) ?? 0) + 1));
    const mostUsedOwner = [...ownerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (mostUsedOwner) next[brand] = mostUsedOwner;
  });

  return next;
}

async function upsertBrandLeaders(brandLeaders?: Record<Brand, string>) {
  const rows = MANAGED_BRANDS.map((brand) => ({
    name: brand,
    owner: brandLeaders?.[brand] ?? DEFAULT_BRAND_LEADERS[brand]
  }));

  try {
    await upsertRows("brands", rows, "name");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("owner")) throw error;
    await upsertRows("brands", rows.map(({ name }) => ({ name })), "name");
  }
}

function toActivity(row: AnyRow, storeIds: string[]): Activity {
  return {
    id: String(row.id),
    name: String(row.name),
    type: row.type as Activity["type"],
    brand: row.brand as Activity["brand"],
    storeIds,
    scale: row.scale as Activity["scale"],
    owner: String(row.owner),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    prepStartDate: String(row.prep_start_date),
    goal: String(row.goal),
    plan: String(row.plan),
    budget: Number(row.budget),
    actualCost: Number(row.actual_cost),
    status: row.status as Activity["status"],
    previousActivityId: row.previous_activity_id ? String(row.previous_activity_id) : undefined
  };
}

function fromActivity(activity: Activity): AnyRow {
  return {
    id: activity.id,
    name: activity.name,
    type: activity.type,
    brand: activity.brand,
    scale: activity.scale,
    owner: activity.owner,
    start_date: activity.startDate,
    end_date: activity.endDate,
    prep_start_date: activity.prepStartDate,
    goal: activity.goal,
    plan: activity.plan,
    budget: activity.budget,
    actual_cost: activity.actualCost,
    status: activity.status,
    previous_activity_id: activity.previousActivityId ?? null
  };
}

function toTask(row: AnyRow): Task {
  return {
    id: String(row.id),
    activityId: String(row.activity_id),
    title: String(row.title),
    type: String(row.type),
    owner: String(row.owner),
    storeId: row.store_id ? String(row.store_id) : undefined,
    dueDate: String(row.due_date),
    status: row.status as Task["status"],
    standard: String(row.standard),
    isKey: Boolean(row.is_key)
  };
}

function fromTask(task: Task): AnyRow {
  return {
    id: task.id,
    activity_id: task.activityId,
    title: task.title,
    type: task.type,
    owner: task.owner,
    store_id: task.storeId ?? null,
    due_date: task.dueDate,
    status: task.status,
    standard: task.standard,
    is_key: task.isKey
  };
}

function toDesignAsset(row: AnyRow): DesignAsset {
  const files = Array.isArray(row.files)
    ? row.files.map((file) => file as UploadedFile)
    : [];

  return {
    id: String(row.id),
    activityId: String(row.activity_id),
    title: String(row.title),
    type: row.type as DesignAsset["type"],
    purpose: row.purpose ? String(row.purpose) : undefined,
    fileNames: Array.isArray(row.file_names) ? row.file_names.map(String) : [],
    files,
    designer: String(row.designer),
    version: Number(row.version),
    status: row.status as DesignAsset["status"],
    submittedAt: String(row.submitted_at),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined,
    reviewer: row.reviewer ? String(row.reviewer) : undefined,
    reviewComment: row.review_comment ? String(row.review_comment) : undefined,
    previewTitle: String(row.preview_title),
    previewSubtitle: String(row.preview_subtitle),
    previewCta: String(row.preview_cta)
  };
}

function fromDesignAsset(asset: DesignAsset): AnyRow {
  return {
    id: asset.id,
    activity_id: asset.activityId,
    title: asset.title,
    type: asset.type,
    purpose: asset.purpose ?? null,
    file_names: asset.fileNames ?? [],
    files: asset.files ?? [],
    designer: asset.designer,
    version: asset.version,
    status: asset.status,
    submitted_at: asset.submittedAt,
    reviewed_at: asset.reviewedAt ?? null,
    reviewer: asset.reviewer ?? null,
    review_comment: asset.reviewComment ?? null,
    preview_title: asset.previewTitle,
    preview_subtitle: asset.previewSubtitle,
    preview_cta: asset.previewCta
  };
}

function toAppointment(row: AnyRow): StoreContentAppointment {
  return {
    id: String(row.id),
    activityId: String(row.activity_id),
    storeId: String(row.store_id),
    type: row.type as StoreContentAppointment["type"],
    title: String(row.title),
    requestedBy: String(row.requested_by),
    detail: String(row.detail),
    candidateSlots: Array.isArray(row.candidate_slots) ? row.candidate_slots.map(String) : [],
    selectedSlot: row.selected_slot ? String(row.selected_slot) : undefined,
    status: row.status as StoreContentAppointment["status"],
    createdAt: String(row.created_at)
  };
}

function fromAppointment(appointment: StoreContentAppointment): AnyRow {
  return {
    id: appointment.id,
    activity_id: appointment.activityId,
    store_id: appointment.storeId,
    type: appointment.type,
    title: appointment.title,
    requested_by: appointment.requestedBy,
    detail: appointment.detail,
    candidate_slots: appointment.candidateSlots,
    selected_slot: appointment.selectedSlot ?? null,
    status: appointment.status,
    created_at: appointment.createdAt
  };
}

function toOperationSubmission(row: AnyRow): OperationSubmission {
  return {
    id: String(row.id),
    activityId: String(row.activity_id),
    type: row.type as OperationSubmission["type"],
    title: String(row.title),
    owner: String(row.owner),
    benchmarkLinks: String(row.benchmark_links),
    contentPlan: String(row.content_plan),
    budget: row.budget === null || row.budget === undefined ? undefined : Number(row.budget),
    needDesign: Boolean(row.need_design),
    designRequest: row.design_request ? String(row.design_request) : undefined,
    status: row.status as OperationSubmission["status"],
    submittedAt: String(row.submitted_at),
    reviewComment: row.review_comment ? String(row.review_comment) : undefined
  };
}

function fromOperationSubmission(submission: OperationSubmission): AnyRow {
  return {
    id: submission.id,
    activity_id: submission.activityId,
    type: submission.type,
    title: submission.title,
    owner: submission.owner,
    benchmark_links: submission.benchmarkLinks,
    content_plan: submission.contentPlan,
    budget: submission.budget ?? null,
    need_design: submission.needDesign ?? false,
    design_request: submission.designRequest ?? null,
    status: submission.status,
    submitted_at: submission.submittedAt,
    review_comment: submission.reviewComment ?? null
  };
}

function toIdea(row: AnyRow, brands: string[]): Idea {
  return {
    id: String(row.id),
    title: String(row.title),
    platform: String(row.platform),
    url: String(row.url ?? ""),
    brands: brands as Idea["brands"],
    budget: Number(row.budget),
    suggestion: String(row.suggestion),
    status: row.status as Idea["status"]
  };
}

function fromIdea(idea: Idea): AnyRow {
  return {
    id: idea.id,
    title: idea.title,
    platform: idea.platform,
    url: idea.url,
    budget: idea.budget,
    suggestion: idea.suggestion,
    status: idea.status
  };
}

export function isSupabaseConfigured() {
  try {
    getSupabaseConfig();
    return true;
  } catch {
    return false;
  }
}

export async function readMarketingState(): Promise<MarketingState> {
  const [
    brandRows,
    userRows,
    storeRows,
    activityRows,
    activityStoreRows,
    taskRows,
    designAssetRows,
    ideaRows,
    ideaBrandRows,
    appointmentRows,
    operationSubmissionRows,
    materialStatusRows,
    costConfirmationRows
  ] = await Promise.all([
    readTable<AnyRow>("brands", "name.asc"),
    readTable<AnyRow>("app_users"),
    readTable<AnyRow>("stores"),
    readTable<AnyRow>("activities"),
    readTable<AnyRow>("activity_stores", "activity_id.asc"),
    readTable<AnyRow>("tasks"),
    readTable<AnyRow>("design_assets"),
    readTable<AnyRow>("ideas"),
    readTable<AnyRow>("idea_brands", "idea_id.asc"),
    readTable<AnyRow>("store_appointments"),
    readTable<AnyRow>("operation_submissions"),
    readTable<AnyRow>("material_task_statuses", "task_id.asc"),
    readTable<AnyRow>("cost_confirmations", "activity_id.asc")
  ]);

  const activityStores = new Map<string, string[]>();
  activityStoreRows.forEach((row) => {
    const activityId = String(row.activity_id);
    activityStores.set(activityId, [...(activityStores.get(activityId) ?? []), String(row.store_id)]);
  });

  const ideaBrands = new Map<string, string[]>();
  ideaBrandRows.forEach((row) => {
    const ideaId = String(row.idea_id);
    ideaBrands.set(ideaId, [...(ideaBrands.get(ideaId) ?? []), String(row.brand)]);
  });

  return {
    brandLeaders: deriveBrandLeaders(brandRows, activityRows),
    users: userRows.map(toUser),
    stores: storeRows.map(toStore),
    activities: activityRows.map((row) => toActivity(row, activityStores.get(String(row.id)) ?? [])),
    tasks: taskRows.map(toTask),
    designAssets: designAssetRows.map(toDesignAsset),
    ideas: ideaRows.map((row) => toIdea(row, ideaBrands.get(String(row.id)) ?? [])),
    storeAppointments: appointmentRows.map(toAppointment),
    operationSubmissions: operationSubmissionRows.map(toOperationSubmission),
    costConfirmedActivityIds: costConfirmationRows.map((row) => String(row.activity_id)),
    materialTaskStatuses: Object.fromEntries(
      materialStatusRows.map((row) => [String(row.task_id), String(row.status)])
    )
  };
}

export async function writeMarketingState(state: MarketingState) {
  await upsertBrandLeaders(state.brandLeaders);
  await upsertRows("app_users", (state.users ?? []).map(fromUser));
  await upsertRows("stores", (state.stores ?? []).map(fromStore));

  await clearTable("cost_confirmations", "activity_id");
  await clearTable("material_task_statuses", "task_id");
  await clearTable("operation_submissions");
  await clearTable("store_appointments");
  await clearTable("design_assets");
  await clearTable("tasks");
  await clearTable("activity_stores", "activity_id");
  await clearTable("activities");
  await clearTable("idea_brands", "idea_id");
  await clearTable("ideas");

  await upsertRows("activities", state.activities.map(fromActivity));
  await upsertRows(
    "activity_stores",
    state.activities.flatMap((activity) =>
      activity.storeIds.map((storeId) => ({ activity_id: activity.id, store_id: storeId }))
    ),
    "activity_id,store_id"
  );
  await upsertRows("tasks", state.tasks.map(fromTask));
  await upsertRows("design_assets", state.designAssets.map(fromDesignAsset));
  await upsertRows("ideas", state.ideas.map(fromIdea));
  await upsertRows(
    "idea_brands",
    state.ideas.flatMap((idea) => idea.brands.map((brand) => ({ idea_id: idea.id, brand }))),
    "idea_id,brand"
  );
  await upsertRows("store_appointments", state.storeAppointments.map(fromAppointment));
  await upsertRows("operation_submissions", state.operationSubmissions.map(fromOperationSubmission));
  await upsertRows(
    "material_task_statuses",
    Object.entries(state.materialTaskStatuses).map(([taskId, status]) => ({ task_id: taskId, status })),
    "task_id"
  );
  await upsertRows(
    "cost_confirmations",
    state.costConfirmedActivityIds.map((activityId) => ({
      activity_id: activityId,
      confirmed_at: new Date().toISOString()
    })),
    "activity_id"
  );
}

// 重新同步某个活动的门店关联（只动这一个活动的 join 行，互不影响）。
async function resyncActivityStores(activity: Activity) {
  await supabaseRequest(
    `activity_stores?activity_id=eq.${encodeURIComponent(activity.id)}`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } }
  );
  await upsertRows(
    "activity_stores",
    activity.storeIds.map((storeId) => ({ activity_id: activity.id, store_id: storeId })),
    "activity_id,store_id"
  );
}

// 重新同步某条灵感的品牌关联。
async function resyncIdeaBrands(idea: Idea) {
  await supabaseRequest(`idea_brands?idea_id=eq.${encodeURIComponent(idea.id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
  await upsertRows(
    "idea_brands",
    idea.brands.map((brand) => ({ idea_id: idea.id, brand })),
    "idea_id,brand"
  );
}

// 增量写入：只处理「这次实际改动」的条目，避免并发用户互相覆盖。
// 删除父级（活动/任务/灵感）时由数据库外键级联清理子表。
export async function applyMarketingStateDelta(delta: MarketingStateDelta) {
  if (delta.brandLeaders) {
    await upsertBrandLeaders(delta.brandLeaders);
  }

  if (delta.users) {
    await upsertRows("app_users", delta.users.upserts.map(fromUser));
    await deleteByIds("app_users", delta.users.deleteIds);
  }

  if (delta.stores) {
    await upsertRows("stores", delta.stores.upserts.map(fromStore));
    // 门店可能仍被活动/任务引用（无级联），删除失败时保留该行。
    await deleteByIdsSafe("stores", delta.stores.deleteIds);
  }

  if (delta.activities) {
    await upsertRows("activities", delta.activities.upserts.map(fromActivity));
    for (const activity of delta.activities.upserts) {
      await resyncActivityStores(activity);
    }
    // 删除活动会级联清理 activity_stores / tasks / design_assets 等子表。
    await deleteByIds("activities", delta.activities.deleteIds);
  }

  if (delta.tasks) {
    await upsertRows("tasks", delta.tasks.upserts.map(fromTask));
    await deleteByIds("tasks", delta.tasks.deleteIds);
  }

  if (delta.designAssets) {
    await upsertRows("design_assets", delta.designAssets.upserts.map(fromDesignAsset));
    await deleteByIds("design_assets", delta.designAssets.deleteIds);
  }

  if (delta.ideas) {
    await upsertRows("ideas", delta.ideas.upserts.map(fromIdea));
    for (const idea of delta.ideas.upserts) {
      await resyncIdeaBrands(idea);
    }
    await deleteByIds("ideas", delta.ideas.deleteIds);
  }

  if (delta.storeAppointments) {
    await upsertRows("store_appointments", delta.storeAppointments.upserts.map(fromAppointment));
    await deleteByIds("store_appointments", delta.storeAppointments.deleteIds);
  }

  if (delta.operationSubmissions) {
    await upsertRows(
      "operation_submissions",
      delta.operationSubmissions.upserts.map(fromOperationSubmission)
    );
    await deleteByIds("operation_submissions", delta.operationSubmissions.deleteIds);
  }

  if (delta.materialTaskStatuses) {
    await upsertRows(
      "material_task_statuses",
      Object.entries(delta.materialTaskStatuses.upserts).map(([taskId, status]) => ({
        task_id: taskId,
        status
      })),
      "task_id"
    );
    await deleteByIds("material_task_statuses", delta.materialTaskStatuses.deleteIds, "task_id");
  }

  if (delta.costConfirmedActivityIds) {
    await upsertRows(
      "cost_confirmations",
      delta.costConfirmedActivityIds.added.map((activityId) => ({
        activity_id: activityId,
        confirmed_at: new Date().toISOString()
      })),
      "activity_id"
    );
    await deleteByIds("cost_confirmations", delta.costConfirmedActivityIds.removed, "activity_id");
  }
}

export { SupabaseConfigError };
