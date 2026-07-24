import Anthropic from "@anthropic-ai/sdk";

// AI 맞춤 오디션 대본 생성 — 기승전결 2분 독백
// POST { gender:"남"|"여", age:"10대 후반"|"20대 초반"|"20대 중반"|"30대", genre, situation?, tone? }
// 무료 정책: 횟수 제한은 앱(로컬)에서 관리, 서버는 일일 총량 안전장치만 둔다.

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const APP_TOKEN = process.env.APP_SECRET || "";

// 인스턴스 단위 일일 총량 캡 (남용 안전장치 — 정확한 과금 통제는 구독 도입 때 DB로)
const DAILY_CAP = 500;
let dayKey = "";
let dayCount = 0;

const GENRES = new Set([
  "멜로", "가족", "청춘", "스릴러", "사회물", "블랙코미디",
  "코미디", "미스터리", "도전", "휴먼", "액션", "사극",
]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (APP_TOKEN && req.headers["x-app-token"] !== APP_TOKEN)
    return res.status(401).json({ error: "Unauthorized" });
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: "API key not configured" });

  const today = new Date().toISOString().slice(0, 10);
  if (dayKey !== today) { dayKey = today; dayCount = 0; }
  if (dayCount >= DAILY_CAP)
    return res.status(429).json({ error: "오늘 생성 한도에 도달했어요. 내일 다시 시도해 주세요." });

  const { gender, age, genre, situation, tone } = req.body || {};
  if (!gender || !age || !genre)
    return res.status(400).json({ error: "gender, age, genre는 필수입니다" });
  if (!GENRES.has(genre))
    return res.status(400).json({ error: "지원하지 않는 장르입니다" });

  const userSituation = (situation || "").toString().slice(0, 200);
  const userTone = (tone || "").toString().slice(0, 20);

  const system = `너는 매체(영화·드라마) 오디션용 창작 독백 대본 작가다. 연기 오디션에서 쓸 완전 창작 독백 1편을 쓴다. 기존 영화·드라마 대사의 인용·변형은 절대 금지 — 전부 새로 창작한다.

규격:
- 길이 400~700자 (연기하면 1분 30초~2분)
- 기승전결 구조: 상황 진입(기) → 감정 고조(승) → 전환/반전(전) → 정리·여운(결). 최소 1회의 뚜렷한 감정 전환 필수.
- 문체: 실제 한국 드라마 구어체. 짧은 문장, 말줄임, 서브텍스트. 설명적 대사 금지. 문어체·번역투 금지.
- 상대가 눈앞에 있는 설정을 명시한다 (대면, 전화, 취조실, 면접 등).
- 지문은 괄호로 최소한만.
- 폭력·범죄 소재는 오디션장에서 연기 가능한 수위로.

출력은 아래 JSON 객체 하나만. 다른 텍스트 절대 금지:
{"title":"제목","character":"인물 이름과 한 줄 소개","situation":"상황 설명 2~3문장 (누구에게, 어디서, 왜 말하는지)","text":"대본 전문","beats":{"기":"한 줄 요약","승":"한 줄","전":"한 줄","결":"한 줄"},"point":"연기 포인트 1~2문장"}`;

  const parts = [`성별: ${gender}`, `연령대: ${age}`, `장르: ${genre}`];
  if (userTone) parts.push(`톤: ${userTone}`);
  if (userSituation) parts.push(`반영할 상황(사용자 입력): ${userSituation}`);
  parts.push("위 조건으로 오디션 독백 1편을 창작하라.");

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: parts.join("\n") }],
    });
    const raw = msg.content?.[0]?.text || "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("생성 결과 형식 오류");
    const script = JSON.parse(raw.slice(start, end + 1));
    if (!script.title || !script.text) throw new Error("생성 결과 필드 누락");
    dayCount++;
    return res.status(200).json({ ok: true, script: { ...script, gender, age, genre } });
  } catch (e) {
    console.error("[generate-script]", e.message);
    return res.status(500).json({ error: "대본 생성에 실패했어요. 잠시 후 다시 시도해 주세요." });
  }
}
