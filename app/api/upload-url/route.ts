import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/session";

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

function safePathPart(value: string) {
  return value
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function getSafeExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match ? `.${match[1]}` : "";
}

function encodeStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

// 签发「直传地址」：浏览器拿到后把文件字节直接 PUT 到 Supabase Storage，
// 不再经过 Vercel 函数，从而绕开 ~4.5MB 的 Serverless 请求体上限。
export async function POST(request: Request) {
  if (!getSessionFromRequest(request)) {
    return NextResponse.json({ error: "未登录或登录已过期。" }, { status: 401 });
  }

  try {
    const { url, serviceRoleKey } = getSupabaseConfig();

    let body: { fileName?: unknown; activityId?: unknown; area?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });
    }

    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    if (!fileName) {
      return NextResponse.json({ error: "缺少文件名。" }, { status: 400 });
    }

    const activityId = safePathPart(String(body.activityId ?? "general")) || "general";
    const area = safePathPart(String(body.area ?? "misc")) || "misc";
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;

    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).slice(2, 10);
    const storageFileName = `${timestamp}-${randomPart}${getSafeExtension(fileName)}`;
    const objectPath = `${area}/${activityId}/${storageFileName}`;

    const signResponse = await fetch(
      `${url}/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${encodeStoragePath(objectPath)}`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );

    if (!signResponse.ok) {
      const detail = await signResponse.text().catch(() => "");
      return NextResponse.json(
        { error: `无法生成上传地址：${detail || `状态码 ${signResponse.status}`}` },
        { status: 500 }
      );
    }

    const signed = (await signResponse.json()) as { url?: string };
    if (!signed.url) {
      return NextResponse.json({ error: "上传地址无效。" }, { status: 500 });
    }

    return NextResponse.json({
      uploadUrl: `${url}/storage/v1${signed.url}`,
      path: objectPath,
      fileUrl: `/api/storage-file?path=${encodeURIComponent(objectPath)}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.error(error);
    return NextResponse.json({ error: `上传服务不可用：${message}` }, { status: 500 });
  }
}
