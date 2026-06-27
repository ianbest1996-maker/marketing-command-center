import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/session";
import { cosPresignedUrl, isCosConfigured } from "@/server/cosClient";

export const dynamic = "force-dynamic";

const DEFAULT_BUCKET = "marketing-files";

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase is not configured.");
  }

  return { url, serviceRoleKey };
}

function encodeStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function GET(request: Request) {
  if (!getSessionFromRequest(request)) {
    return NextResponse.json({ error: "未登录或登录已过期。" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const rawPath = searchParams.get("path") ?? "";
    const path = rawPath.replace(/^\/+/, "");
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;

    if (!path || path.includes("..")) {
      return NextResponse.json({ error: "文件路径无效" }, { status: 400 });
    }

    // 国内：腾讯云 COS —— 生成临时签名地址并重定向，文件不经过本服务。
    if (isCosConfigured()) {
      const signedUrl = await cosPresignedUrl(path, "GET");
      return NextResponse.redirect(signedUrl);
    }

    const { url, serviceRoleKey } = getSupabaseConfig();
    const response = await fetch(
      `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );

    if (!response.ok || !response.body) {
      return NextResponse.json({ error: "文件不存在或无法读取" }, { status: response.status || 404 });
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": "inline"
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "文件服务不可用" }, { status: 500 });
  }
}
