import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/session";

export const dynamic = "force-dynamic";

const DEFAULT_BUCKET = "marketing-files";
const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

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

export async function POST(request: Request) {
  if (!getSessionFromRequest(request)) {
    return NextResponse.json({ error: "未登录或登录已过期。" }, { status: 401 });
  }

  try {
    const { url, serviceRoleKey } = getSupabaseConfig();
    const formData = await request.formData();
    const file = formData.get("file");
    const activityId = safePathPart(String(formData.get("activityId") ?? "general")) || "general";
    const area = safePathPart(String(formData.get("area") ?? "misc")) || "misc";
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "没有收到文件，请重新选择后再提交。" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `单个文件不能超过 ${MAX_FILE_SIZE_MB}MB，请压缩后再上传。` },
        { status: 413 }
      );
    }

    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).slice(2, 10);
    const storageFileName = `${timestamp}-${randomPart}${getSafeExtension(file.name)}`;
    const objectPath = `${area}/${activityId}/${storageFileName}`;
    const encodedObjectPath = encodeStoragePath(objectPath);

    const uploadResponse = await fetch(
      `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedObjectPath}`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": file.type || "application/octet-stream",
          "x-upsert": "true"
        },
        body: await file.arrayBuffer()
      }
    );

    if (!uploadResponse.ok) {
      const detail = await uploadResponse.text().catch(() => "");
      return NextResponse.json(
        { error: `云端文件存储失败：${detail || `状态码 ${uploadResponse.status}`}` },
        { status: 500 }
      );
    }

    const fileUrl = `/api/storage-file?path=${encodeURIComponent(objectPath)}`;

    return NextResponse.json({
      file: {
        name: file.name,
        path: objectPath,
        url: fileUrl,
        mimeType: file.type || "application/octet-stream",
        size: file.size
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.error(error);
    return NextResponse.json({ error: `上传服务不可用：${message}` }, { status: 500 });
  }
}
