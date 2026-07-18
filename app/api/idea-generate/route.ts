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

  const brandContext: Record<string, string> = {
    中餐:
      "中餐品牌：主打正餐、家宴、宴席（升学宴/谢师宴/生日宴/家庭聚餐/商务宴请），" +
      "卖点是包间、菜品仪式感、人均性价比，适合小红书图文和抖音上菜/宴席场景。",
    火锅:
      "火锅品牌：主打社交聚餐、朋友局、家庭局，卖点是锅底特色、涮品新鲜、氛围热闹，" +
      "适合抖音出锅/涮煮画面、团购套餐、夜宵和晚市。",
    虾锅:
      "虾锅品牌：主打夜宵、啤酒场、年轻人聚会，卖点是麻辣鲜香、大份实惠、出片，" +
      "适合抖音出锅/开吃、小红书打卡、晚市和宵夜时段。"
  };

  const systemPrompt =
    "你是一位服务本地连锁餐饮的资深营销策划，操盘过大量门店级落地活动。" +
    "这家集团有中餐、火锅、虾锅三个品牌，你要针对指定品牌产出真正能执行的营销灵感。" +
    `本次品牌背景：${brandContext[brand] ?? ""}` +
    "要求：①每条灵感要具体到「做什么内容/给什么优惠/在什么时段」，能直接排成一次活动，" +
    "拒绝「提升品牌影响力」「加强用户互动」这类空话；" +
    "②做法建议里尽量点明拍摄要点或钩子（如出锅镜头、探店视角、套餐价格锚点）；" +
    "③来源平台只能从这些里选：小红书、抖音、大众点评、美团、朋友圈、线下观察，且要和内容形式匹配；" +
    "④预算单位人民币元，符合中小餐饮门店一次活动的合理投入（通常几千到两三万）；" +
    "⑤4 条之间角度要有差异（内容种草 / 到店优惠 / 达人探店 / 私域朋友圈等），不要雷同。" +
    '严格只输出 JSON，格式为 {"ideas":[{"title":"简短有记忆点的标题","platform":"来源平台",' +
    '"brands":["适用品牌"],"budget":数字,"suggestion":"两三句具体可执行的做法"}]}，' +
    "共 4 条，不要输出 JSON 以外的任何内容。";

  const userPrompt =
    `品牌：${brand}\n` +
    `主题/方向：${theme || "近期（结合当前季节和节点）适合这个品牌做的本地营销活动"}\n` +
    "请按要求生成 4 条互不雷同的灵感。";

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
        model: process.env.MOONSHOT_MODEL || "kimi-k2-0905-preview",
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
