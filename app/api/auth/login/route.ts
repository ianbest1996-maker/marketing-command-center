import { NextResponse } from "next/server";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE_NAME } from "@/server/session";
import { isSupabaseConfigured, readMarketingState } from "@/server/supabaseMarketingRepository";

export const dynamic = "force-dynamic";

// 试用口令。生产环境请在部署平台设置 APP_LOGIN_PASSWORD 覆盖默认值。
function getLoginPassword() {
  return process.env.APP_LOGIN_PASSWORD || "123456";
}

export async function POST(request: Request) {
  let body: { userId?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!userId) {
    return NextResponse.json({ error: "缺少账号信息。" }, { status: 400 });
  }

  if (password !== getLoginPassword()) {
    return NextResponse.json({ error: "账号或口令不正确。" }, { status: 401 });
  }

  // 已接入云端时，校验该账号确实存在，并绑定真实角色，避免伪造身份。
  let role: string | undefined;
  if (isSupabaseConfigured()) {
    try {
      const state = await readMarketingState();
      const user = state.users.find((item) => item.id === userId);
      if (!user) {
        return NextResponse.json({ error: "账号不存在。" }, { status: 401 });
      }
      role = user.role;
    } catch (error) {
      console.error(error);
      return NextResponse.json({ error: "登录服务暂时不可用，请稍后再试。" }, { status: 500 });
    }
  }

  const token = createSessionToken({ userId, role });
  const response = NextResponse.json({ ok: true, userId, role });
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
  return response;
}
