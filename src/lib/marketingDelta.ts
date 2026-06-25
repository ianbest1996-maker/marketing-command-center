import type {
  Brand,
  CollectionDelta,
  MarketingState,
  MarketingStateDelta
} from "@/types";

type Identifiable = { id: string };

// 比较两份集合，得出新增/修改的条目（upserts）和被删除的 id（deleteIds）。
// 判等用 JSON 序列化，足够覆盖本系统里的纯数据对象。
function diffCollection<T extends Identifiable>(
  prev: T[],
  next: T[]
): CollectionDelta<T> | undefined {
  const prevById = new Map(prev.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));

  const upserts: T[] = [];
  for (const item of next) {
    const previous = prevById.get(item.id);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(item)) {
      upserts.push(item);
    }
  }

  const deleteIds: string[] = [];
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) deleteIds.push(id);
  }

  if (upserts.length === 0 && deleteIds.length === 0) return undefined;
  return { upserts, deleteIds };
}

function diffStringSet(prev: string[], next: string[]) {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const added = next.filter((id) => !prevSet.has(id));
  const removed = prev.filter((id) => !nextSet.has(id));
  if (added.length === 0 && removed.length === 0) return undefined;
  return { added, removed };
}

function diffStringRecord(prev: Record<string, string>, next: Record<string, string>) {
  const upserts: Record<string, string> = {};
  for (const [key, value] of Object.entries(next)) {
    if (prev[key] !== value) upserts[key] = value;
  }
  const deleteIds = Object.keys(prev).filter((key) => !(key in next));
  if (Object.keys(upserts).length === 0 && deleteIds.length === 0) return undefined;
  return { upserts, deleteIds };
}

function brandLeadersChanged(prev: Record<Brand, string> | undefined, next: Record<Brand, string> | undefined) {
  return JSON.stringify(prev ?? {}) !== JSON.stringify(next ?? {});
}

export function computeMarketingStateDelta(
  prev: MarketingState,
  next: MarketingState
): MarketingStateDelta {
  const delta: MarketingStateDelta = {};

  if (brandLeadersChanged(prev.brandLeaders, next.brandLeaders) && next.brandLeaders) {
    delta.brandLeaders = next.brandLeaders;
  }

  const users = diffCollection(prev.users, next.users);
  if (users) delta.users = users;

  const stores = diffCollection(prev.stores, next.stores);
  if (stores) delta.stores = stores;

  const activities = diffCollection(prev.activities, next.activities);
  if (activities) delta.activities = activities;

  const tasks = diffCollection(prev.tasks, next.tasks);
  if (tasks) delta.tasks = tasks;

  const designAssets = diffCollection(prev.designAssets, next.designAssets);
  if (designAssets) delta.designAssets = designAssets;

  const ideas = diffCollection(prev.ideas, next.ideas);
  if (ideas) delta.ideas = ideas;

  const storeAppointments = diffCollection(prev.storeAppointments, next.storeAppointments);
  if (storeAppointments) delta.storeAppointments = storeAppointments;

  const operationSubmissions = diffCollection(prev.operationSubmissions, next.operationSubmissions);
  if (operationSubmissions) delta.operationSubmissions = operationSubmissions;

  const storeReports = diffCollection(prev.storeReports ?? [], next.storeReports ?? []);
  if (storeReports) delta.storeReports = storeReports;

  const costConfirmedActivityIds = diffStringSet(
    prev.costConfirmedActivityIds,
    next.costConfirmedActivityIds
  );
  if (costConfirmedActivityIds) delta.costConfirmedActivityIds = costConfirmedActivityIds;

  const materialTaskStatuses = diffStringRecord(
    prev.materialTaskStatuses,
    next.materialTaskStatuses
  );
  if (materialTaskStatuses) delta.materialTaskStatuses = materialTaskStatuses;

  return delta;
}

export function isEmptyDelta(delta: MarketingStateDelta) {
  return Object.keys(delta).length === 0;
}
