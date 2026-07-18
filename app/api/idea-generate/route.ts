import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/server/session";

export const dynamic = "force-dynamic";

const BRANDS = ["中餐", "火锅", "虾锅"] as const;
const PLATFORMS = ["小红书", "抖音", "大众点评", "美团", "朋友圈", "线下观察"] as const;

type GeneratedIdea = {
  title: string;
  platform: string;
  brands: string[];
  budget: number;
  url: string;
  suggestion: string;
};

function clampPlatform(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  const hit = PLATFORMS.find((item) => text.includes(item));
  return hit ?? "小红书";
}

function clampBrands(value: unknown, fallback: string): string[] {
  const list = Array.isArray(value) ? value : [];
  const cleaned = list
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => (BRANDS as readonly string[]).includes(item));
  return cleaned.length > 0 ? cleaned : [fallback];
}

function clampBudget(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return 8000;
  return Math.round(Math.min(Math.max(num, 500), 500000));
}

// 调用 Kimi（Moonshot，OpenAI 兼容接口）为餐饮营销生成灵感。
// 需要在服务器环境变量里配置 MOONSHOT_API_KEY（可选 MOONSHOT_MODEL 指定模型）。
export async function POST(request: Request) {
  if (!getSessionFromRequest(request)) {
    return NextResponse.json({ error: "未登录或登录已过期。" }, { status: 401 });
  }

  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "尚未配置 AI 服务（缺少 MOONSHOT_API_KEY），请联系管理员。" },
      { status: 503 }
    );
  }

  let body: { theme?: unknown; brand?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });
  }

  const theme = typeof body.theme === "string" ? body.theme.trim().slice(0, 200) : "";
  const brandInput = typeof body.brand === "string" ? body.brand.trim() : "";
  const brand = (BRANDS as readonly string[]).includes(brandInput) ? brandInput : "中餐";

  const systemPrompt =
    "你是一位资深餐饮品牌营销策划，服务对象是一家有中餐、火锅、虾锅三个品牌的连锁餐饮集团。" +
    "请针对给定品牌和主题，产出可落地的门店营销灵感。" +
    "每条灵感要具体、接地气、能直接转成一次营销活动，避免空话套话。" +
    "只能从这些平台里选来源：小红书、抖音、大众点评、美团、朋友圈、线下观察。" +
    "预算单位是人民币元，给一个符合中小餐饮门店的合理数字。" +
    '严格只输出 JSON，格式为 {"ideas":[{"title":"简短标题","platform":"来源平台",' +
    '"brands":["适用品牌"],"budget":数字,"suggestion":"两三句可执行的做法建议"}]}，' +
    "生成 4 条，不要输出 JSON 以外的任何内容。";

  const userPrompt = `品牌：${brand}\n主题/方向：${theme || "近期适合做的本地营销活动"}\n请生成 4 条灵感。`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch("https://api.moonshot.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.MOONSHOT_MODEL || "moonshot-v1-8k",
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return NextResponse.json(
        { error: `AI 服务返回错误（${response.status}）。${detail.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";

    let parsed: { ideas?: unknown };
    try {
      parsed = JSON.parse(content) as { ideas?: unknown };
    } catch {
      return NextResponse.json({ error: "AI 返回内容无法解析，请重试。" }, { status: 502 });
    }

    const rawList = Array.isArray(parsed.ideas) ? parsed.ideas : [];
    const ideas: GeneratedIdea[] = rawList
      .slice(0, 6)
      .map((item) => {
        const record = (item ?? {}) as Record<string, unknown>;
        const title = typeof record.title === "string" ? record.title.trim().slice(0, 60) : "";
        const suggestion =
          typeof record.suggestion === "string" ? record.suggestion.trim().slice(0, 400) : "";
        return {
          title,
          platform: clampPlatform(record.platform),
          brands: clampBrands(record.brands, brand),
          budget: clampBudget(record.budget),
          url: "",
          suggestion
        };
      })
      .filter((idea) => idea.title && idea.suggestion);

    if (ideas.length === 0) {
      return NextResponse.json({ error: "这次没有生成有效灵感，请调整主题后重试。" }, { status: 502 });
    }

    return NextResponse.json({ ideas });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    const message = aborted ? "AI 服务响应超时，请重试。" : "AI 服务暂时不可用，请稍后再试。";
    console.error(error);
    return NextResponse.json({ error: message }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
