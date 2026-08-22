// 「아르스 Ars」 텍스트 어드벤처 전용 AI 판정 엔드포인트.
// 앱용 ai-analyze.js와 완전히 분리한다 — 게임 트래픽이 앱의 무료 체험 쿼터를
// 태우면 게임을 한 사람이 이미 체험을 소진한 채 앱에 도착해 퍼널이 자멸한다.
// 앱과 다른 점: Haiku(비용 1/10), 짧은 고정 JSON(도구 호출로 스키마 강제),
// 게임 전용 시크릿, 게임 전용 일일 카운터, CORS 화이트리스트.
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

const MODEL = "claude-haiku-4-5-20251001";
const PROMPT_VERSION = "2026-08-22.1";
const DAILY_MAX = 5; // 1플레이당 1회 호출 → 하루 5판까지

const ORIGINS = (process.env.GAME_ORIGINS || "https://ars-ep1-v2.vercel.app,https://art-link.kr")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const FIELDS = {
  연기: "연기", 도예: "도예/조각", 조각: "도예/조각", 문학: "문학",
  보컬: "보컬", 무용: "무용", 음악: "음악", 영화: "영화",
};

// 심의청 관측관의 판정문. 코칭이 아니라 등재 서식이다 — 길면 게임 톤이 깨진다.
const SYSTEM = `너는 지구 표본 관측 시스템의 창작물 판정 모듈이다. 예술고 학생이 제출한 그날의 창작 기록을 읽고 등급을 매긴다.

판정 기준
- 완성도만 높고 그 사람의 것이 없는 기록은 높은 등급이 아니라 "무응답"이다. 정돈될수록 신호가 약해진다.
- 서툴러도 자기 몸을 통과한 흔적(구체적인 실패·수정·망설임)이 있으면 등급이 올라간다.
- 추상적인 다짐("열심히 했다", "좋았다")만 있으면 "재제출".
- 기록이 너무 짧거나 창작과 무관하면 "무응답".

문체 규칙
- comment는 한 문장, 45자 이내. 관측 기록의 어투로 건조하게 쓴다. 격려·칭찬·이모지·조언 금지.
- 학생을 부르지 않는다. "당신", "너" 같은 호칭을 쓰지 않는다.
- 예: "손끝의 망설임이 기록에 남았음 · 신호 안정", "구성은 정돈되었으나 발신원이 검출되지 않음".`;

const TOOL = {
  name: "record_judgment",
  description: "판정 결과를 관측 서식에 기록한다.",
  input_schema: {
    type: "object",
    properties: {
      grade: { type: "string", enum: ["최우수", "우수", "보류", "재제출", "무응답"] },
      score: { type: "integer", minimum: 1, maximum: 10, description: "광량 환산용 신호 강도" },
      comment: { type: "string", description: "판정 사유. 한 문장, 45자 이내." },
    },
    required: ["grade", "score", "comment"],
  },
};

// 식별자 — 게임은 브라우저에서 도는 정적 페이지라 토큰이 노출된다.
// 진짜 방어선은 이 IP 기준 일일 카운터다. 식별 불가면 통과가 아니라 거부.
function identify(req) {
  const dev = req.headers["x-game-id"];
  if (typeof dev === "string" && dev.length > 3 && dev.length <= 128) return dev;
  const fwd = req.headers["x-forwarded-for"];
  const raw = typeof fwd === "string" ? fwd.split(",")[0] : req.headers["x-real-ip"];
  const ip = typeof raw === "string" ? raw.trim() : "";
  return ip ? "ip:" + ip.slice(0, 120) : null;
}

const kstDay = () =>
  new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// 쿼터 판정은 실패 시 거부한다(fail-closed). 게임에는 "무응답" 폴백이 있어
// 막혀도 진행되지만, 통과시키면 그 순간 무제한이 된다.
async function checkQuota(key) {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("game_ai_usage")
    .select("count")
    .eq("key", key)
    .eq("day", kstDay())
    .maybeSingle();
  if (error) {
    console.error("[game-judge] quota check failed:", error.message);
    return false;
  }
  return (data?.count || 0) < DAILY_MAX;
}

async function consume(key) {
  const day = kstDay();
  const { data } = await supabase
    .from("game_ai_usage")
    .select("count")
    .eq("key", key)
    .eq("day", day)
    .maybeSingle();
  const { error } = await supabase.from("game_ai_usage").upsert(
    { key, day, count: (data?.count || 0) + 1, updated_at: new Date().toISOString() },
    { onConflict: "key,day" }
  );
  if (error) console.error("[game-judge] consume failed:", key, error.message);
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Game-Token, X-Game-Id");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (origin && !ORIGINS.includes(origin)) return res.status(403).json({ error: "origin_not_allowed" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "API key not configured" });

  const secret = process.env.GAME_APP_SECRET || "";
  if (secret && req.headers["x-game-token"] !== secret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const key = identify(req);
  if (!key) return res.status(400).json({ error: "unidentified" });
  if (!(await checkQuota(key))) {
    return res.status(429).json({ error: "quota_exceeded", max: DAILY_MAX });
  }

  const { text, field } = req.body || {};
  if (typeof text !== "string" || text.trim().length < 2) {
    return res.status(200).json({ grade: "무응답", score: 1, comment: "신호 해석 불가", meta: { model: null } });
  }

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      temperature: 0.6,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [
        {
          role: "user",
          content: `전공: ${FIELDS[field] || "미상"}\n제출 기록:\n${text.slice(0, 2000)}`,
        },
      ],
    });
    const use = msg.content.find((c) => c.type === "tool_use");
    if (!use) throw new Error("no tool_use in response");
    console.log("[game-judge] usage:", JSON.stringify(msg.usage));
    await consume(key);
    const { grade, score, comment } = use.input;
    return res.status(200).json({
      grade,
      score,
      comment: String(comment).slice(0, 60),
      meta: { model: MODEL, promptVersion: PROMPT_VERSION },
    });
  } catch (e) {
    // 장애를 오류 화면으로 흘리지 않는다 — 게임에서는 이것도 캐논이다.
    console.error("[game-judge] error:", e.message);
    return res.status(200).json({ grade: "무응답", score: 1, comment: "신호 해석 불가", meta: { error: true } });
  }
}
