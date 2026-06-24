import { NextResponse } from "next/server";
import type { MarketingState, MarketingStateDelta } from "@/types";
import {
  SupabaseConfigError,
  applyMarketingStateDelta,
  isSupabaseConfigured,
  readMarketingState,
  writeMarketingState
} from "@/server/supabaseMarketingRepository";
import { getSessionFromRequest } from "@/server/session";

export const dynamic = "force-dynamic";

// 仅老板可维护的「基础资料」：人员/账号、门店、品牌负责人。
const ADMIN_ROLE = "老板";

function unauthorized() {
  return NextResponse.json({ error: "未登录或登录已过期。" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: "无权进行此操作。" }, { status: 403 });
}

// 这份增量是否改动了只有老板能维护的基础资料。
function deltaTouchesAdminData(delta: MarketingStateDelta) {
  return Boolean(delta.users || delta.stores || delta.brandLeaders);
}

export async function GET(request: Request) {
  if (!getSessionFromRequest(request)) {
    return unauthorized();
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false }, { status: 503 });
  }

  try {
    const state = await readMarketingState();
    return NextResponse.json({ configured: true, state });
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      return NextResponse.json({ configured: false }, { status: 503 });
    }

    console.error(error);
    return NextResponse.json({ error: "读取云端数据失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return unauthorized();
  }

  // 整库覆盖式写入风险最高，仅限老板。
  if (session.role !== ADMIN_ROLE) {
    return forbidden();
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false }, { status: 503 });
  }

  try {
    const state = (await request.json()) as MarketingState;
    await writeMarketingState(state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      return NextResponse.json({ configured: false }, { status: 503 });
    }

    console.error(error);
    return NextResponse.json({ error: "保存云端数据失败" }, { status: 500 });
  }
}

// 增量保存：只写入本次改动的条目，避免多人同时编辑时互相覆盖。
export async function PATCH(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return unauthorized();
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false }, { status: 503 });
  }

  try {
    const delta = (await request.json()) as MarketingStateDelta;

    // 非老板不得改动人员/门店/品牌负责人等基础资料。
    if (deltaTouchesAdminData(delta) && session.role !== ADMIN_ROLE) {
      return forbidden();
    }

    await applyMarketingStateDelta(delta);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      return NextResponse.json({ configured: false }, { status: 503 });
    }

    console.error(error);
    return NextResponse.json({ error: "保存云端数据失败" }, { status: 500 });
  }
}
