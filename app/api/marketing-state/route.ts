import { NextResponse } from "next/server";
import type { MarketingState } from "@/types";
import type { MarketingStateDelta } from "@/types";
import {
  SupabaseConfigError,
  applyMarketingStateDelta,
  isSupabaseConfigured,
  readMarketingState,
  writeMarketingState
} from "@/server/supabaseMarketingRepository";
import { getSessionFromRequest } from "@/server/session";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "未登录或登录已过期。" }, { status: 401 });
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
  if (!getSessionFromRequest(request)) {
    return unauthorized();
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
  if (!getSessionFromRequest(request)) {
    return unauthorized();
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false }, { status: 503 });
  }

  try {
    const delta = (await request.json()) as MarketingStateDelta;
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
