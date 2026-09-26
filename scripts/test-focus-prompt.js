// [[FOCUS]] 숨김 줄·🔁 비교 단락·근거/금지 규칙 검증
//   node scripts/test-focus-prompt.js          → 정규화 헬퍼 단위 테스트만 (무료, 네트워크 없음)
//   node scripts/test-focus-prompt.js --live   → 위 + 실 Anthropic API 7회 호출 (비용 수백 원)
// 키는 .env.local에서 읽어 process.env에 넣는다. 값은 절대 출력하지 않는다.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.includes("--live")) {
  for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} else {
  process.env.ANTHROPIC_API_KEY = "offline-test-only";
}

const { normalizeFocus, normalizePrevious, buildContextBlock, buildSystemPrompt } = await import(
  "../api/ai-analyze.js"
);
const { buildVideoSystemPrompt } = await import("../api/analyze-video.js");

let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
};

// ───────────────────────── (a) 정규화 헬퍼 단위 테스트 ─────────────────────────
console.log("── normalizeFocus ──");
ok("평범한 문자열 통과", normalizeFocus("둘째 문장 끝에서 숨 쉬고 시작하기") === "둘째 문장 끝에서 숨 쉬고 시작하기");
ok("80자 초과는 절단", normalizeFocus("가".repeat(200)) === "가".repeat(80));
ok("줄바꿈·연속공백은 한 칸으로", normalizeFocus("  앞\n\n뒤  ") === "앞 뒤");
ok("빈 문자열·공백은 null", normalizeFocus("") === null && normalizeFocus("   ") === null);
ok(
  "타입 이상은 null(400 금지)",
  [undefined, null, 5, {}, [], true].every((v) => normalizeFocus(v) === null)
);

console.log("\n── normalizePrevious ──");
ok(
  "객체 아니면 null",
  [undefined, null, "x", 3, []].every((v) => normalizePrevious(v) === null)
);
ok("내용이 하나도 없으면 null", normalizePrevious({ focus: null, summary: "", scores: null }) === null);
{
  const p = normalizePrevious({
    focus: "나".repeat(100),
    summary: "다".repeat(900),
    scores: { technique: 7, expression: "8", creativity: 99, consistency: -3, growth: null, junk: 5 },
  });
  ok("focus 80자 절단", p.focus.length === 80);
  ok("summary 400자 절단", p.summary.length === 400);
  ok("숫자 문자열 허용", p.scores.expression === 8);
  ok("0~10 클램프", p.scores.creativity === 10 && p.scores.consistency === 0);
  ok("숫자 아닌 축은 빠짐", !("growth" in p.scores) && !("junk" in p.scores));
}
{
  const p = normalizePrevious({ focus: "지난 초점", summary: 12345, scores: "bad" });
  ok("summary 타입 이상은 빈 문자열", p.summary === "");
  ok("scores 타입 이상은 null", p.scores === null);
  ok("focus만 있어도 객체 반환", p.focus === "지난 초점");
}
ok("scores 전부 무효면 null", normalizePrevious({ summary: "요약", scores: { technique: "x" } }).scores === null);

console.log("\n── buildContextBlock ──");
ok("아무것도 없으면 빈 문자열", buildContextBlock({ focus: null, previous: null, isPremium: false }) === "");
{
  const b = buildContextBlock({ focus: "숨 쉬고 시작하기", previous: null, isPremium: false });
  ok("focus만 → 🎯 지시 있고 🔁 없음", b.includes("🎯") && !b.includes("🔁") && b.includes("숨 쉬고 시작하기"));
}
{
  const prev = normalizePrevious({ focus: "지난 초점", summary: "지난 요약", scores: { technique: 6 } });
  const free = buildContextBlock({ focus: null, previous: prev, isPremium: false });
  const prem = buildContextBlock({ focus: null, previous: prev, isPremium: true });
  ok("무료 = 한 문장 지시", free.includes("🔁") && free.includes("정확히 한 문장"));
  ok("프리미엄 = 3~4문장 지시", prem.includes("🔁") && prem.includes("3~4문장"));
  ok("내부 점수는 말하지 말라고 명시", prem.includes("사용자에게 말하지 말 것"));
}
ok(
  "시스템 프롬프트에 가변부가 안 들어감(캐시 보존)",
  !buildSystemPrompt("acting", true, true).includes("지난 연습 기록") &&
    !buildVideoSystemPrompt("acting", true).includes("지난 연습 기록")
);
ok(
  "두 엔드포인트 모두 [[FOCUS]] 지시 포함",
  buildSystemPrompt("acting", true, true).includes("[[FOCUS]] 후보1 | 후보2 | 후보3") &&
    buildVideoSystemPrompt("acting", true).includes("[[FOCUS]] 후보1 | 후보2 | 후보3")
);

if (!process.argv.includes("--live")) {
  // 구버전 앱 보호: wantFocus 플래그가 없으면 [[FOCUS]] 지시가 프롬프트에 들어가지 않는다 (2026-09-17)
  {
    const okGate = !buildSystemPrompt("acting", true).includes("[[FOCUS]]") && buildSystemPrompt("acting", true, true).includes("[[FOCUS]]")
      && buildSystemPrompt("acting", true).includes("[[SCORES]]")
      && !buildVideoSystemPrompt("acting").includes("[[FOCUS]]") && buildVideoSystemPrompt("acting", true).includes("[[FOCUS]]");
    console.log(okGate ? "PASS " : "FAIL ", "wantFocus 게이팅: 플래그 없으면 FOCUS 지시 없음, SCORES는 유지");
    if (!okGate) failed++;
  }
  console.log(`\n(실 API 검증은 --live 플래그로 실행)\n${failed ? `${failed} FAILED` : "UNIT ALL PASS"}`);
  process.exit(failed ? 1 : 0);
}

// ───────────────────────── (b) 실 API 검증 ─────────────────────────
const Anthropic = (await import("@anthropic-ai/sdk")).default;
const { modelParams } = await import("../api/_model.js");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const NOTE_ACTING = `[연기] 연습 노트 — 「햄릿」 3막 1장 독백 재연습
오늘 "사느냐 죽느냐" 독백을 세 번 반복해서 녹음했다. 첫 번째는 앞부분이 너무 빨라서 첫 문장이 뭉개졌고, 두 번째부터는 의식적으로 첫 단어 앞에서 한 박 쉬었다. 중반 "잠드는 것, 아마도 꿈을 꾸는 것"에서 목소리가 스스로 작아졌는데 그게 의도인지 긴장인지 모르겠다. 마지막 문장에서는 턱에 힘이 들어가서 발음이 뭉쳤다. 손은 계속 주머니에 있었고 시선은 정면 한 곳에 고정돼 있었다.`;
const TRANSCRIPT_ACTING = `0:02 사느냐 죽느냐 그것이 문제로다
0:11 (0.8초 쉼) 잠드는 것 아마도 꿈을 꾸는 것
0:25 아 거기서 걸리는구나
0:33 그 누가 이 무거운 짐을 지고 신음하며 땀 흘리랴`;
const NOTE_MUSIC = `[음악] 보컬 연습 — 「야생화」 2절
고음 파트에서 목에 힘이 들어간다. 후렴 진입 직전에 숨을 크게 들이마셨더니 오히려 어깨가 올라갔다. 2절 첫 줄은 소리가 작아서 마이크에 잘 안 잡혔고, 브리지에서는 박자가 반 박 빨라졌다. 녹음을 들어보니 가사 끝 자음이 자주 뭉갠다.`;
const NOTE_DANCE = `[무용] 현대무용 연습 — 8카운트 시퀀스 3번
점프 착지에서 소리가 크게 났다. 착지 후 다음 동작으로 넘어갈 때 한 박 멈춘다. 회전은 두 바퀴까지는 되는데 세 바퀴에서 축이 무너진다. 거울을 계속 봐서 시선이 앞으로 안 나갔다. 팔은 어깨에서만 움직이고 등은 거의 안 썼다.`;
const NOTE_THIN = `[연기] 오늘 대사 두 번 읽음. 피곤함.`;
const OBSERVATION = `0:00-0:08 정면 고정 자세. 어깨가 귀 쪽으로 올라가 있고 호흡이 얕다.
0:08-0:20 첫 대사 시작. 말 속도가 빠르다가 0:14부터 느려진다. 시선은 카메라 아래 한 지점 고정.
0:20-0:35 목소리 음량이 절반으로 떨어짐. 턱이 앞으로 나오고 입 벌림이 작아진다.
0:35-0:48 마지막 문장에서 오른손이 처음으로 주머니에서 나와 가슴 앞에서 멈춤. 어깨는 계속 올라간 상태.`;

const PREV = {
  focus: "첫 문장 시작 전에 한 박 쉬고 들어가기",
  summary:
    "지난 연습에서는 첫 문장이 뭉개지고 속도가 일정했다. 쉼 없이 밀어붙여 중반 감정 전환이 관객에게 전달될 시간이 없었고, 턱과 어깨의 긴장이 발음에 영향을 주었다.",
  scores: { technique: 6, expression: 6, creativity: 5, consistency: 6, growth: 5 },
};

const SAMPLES = [
  { id: "1 연기/프리미엄/초점+지난", field: "acting", premium: true, note: NOTE_ACTING, transcript: TRANSCRIPT_ACTING, focus: PREV.focus, previous: PREV },
  { id: "2 연기/무료/초점+지난", field: "acting", premium: false, note: NOTE_ACTING, transcript: TRANSCRIPT_ACTING, focus: PREV.focus, previous: PREV },
  { id: "3 음악/무료/초점만", field: "music", premium: false, note: NOTE_MUSIC, focus: "후렴 진입 전 어깨 내리고 숨 들이마시기" },
  { id: "4 무용/프리미엄/없음", field: "dance", premium: true, note: NOTE_DANCE },
  { id: "5 연기/무료/빈약한 노트", field: "acting", premium: false, note: NOTE_THIN },
  { id: "6 음악/프리미엄/지난만", field: "music", premium: true, note: NOTE_MUSIC, previous: { focus: "가사 끝 자음 또박또박 닫기", summary: "지난 연습은 끝 자음이 뭉개지고 브리지 박자가 밀렸다.", scores: null } },
  { id: "7 영상엔드포인트/프리미엄/초점+지난", field: "acting", premium: true, video: true, note: NOTE_ACTING, transcript: TRANSCRIPT_ACTING, focus: PREV.focus, previous: PREV },
];

const BANNED = [
  ["합격", /합격/],
  ["캐스팅될", /캐스팅될|캐스팅 될|캐스팅 가능성/],
  ["실력이 높/낮", /실력이\s*(높|낮)/],
  ["오디션에 붙", /오디션에\s*붙/],
];
const EMOJI = /\p{Extended_Pictographic}/u;
const chars = (s) => [...s].length;

function sentenceCount(s) {
  return (s.match(/[.!?…](\s|$)/g) || []).length;
}

function check(sample, text) {
  const issues = [];
  const occ = (text.match(/\[\[FOCUS\]\]/g) || []).length;
  if (occ !== 1) issues.push(`[[FOCUS]] 줄 ${occ}개`);

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const fi = lines.findIndex((l) => l.startsWith("[[FOCUS]]"));
  const si = lines.findIndex((l) => l.startsWith("[[SCORES]]"));
  const wantScores = !sample.video;
  if (wantScores) {
    if (si < 0) issues.push("[[SCORES]] 줄 없음");
    else if (si !== fi + 1) issues.push(`[[FOCUS]]가 [[SCORES]] 바로 앞이 아님(focus:${fi} scores:${si})`);
    if (si >= 0 && si !== lines.length - 1) issues.push("[[SCORES]] 뒤에 텍스트가 더 있음");
  } else if (fi !== lines.length - 1) {
    issues.push("[[FOCUS]]가 마지막 줄이 아님");
  }

  let cands = [];
  if (fi >= 0) {
    cands = lines[fi]
      .replace("[[FOCUS]]", "")
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cands.length < 1 || cands.length > 3) issues.push(`후보 ${cands.length}개`);
    cands.forEach((c, i) => {
      if (chars(c) > 40) issues.push(`후보${i + 1} ${chars(c)}자`);
      if (EMOJI.test(c)) issues.push(`후보${i + 1} 이모지`);
    });
  }

  const body = fi >= 0 ? text.slice(0, text.indexOf("[[FOCUS]]")) : text;
  for (const [name, re] of BANNED) if (re.test(body)) issues.push(`금지표현 "${name}"`);

  if (sample.previous) {
    if (!body.includes("🔁")) issues.push("🔁 섹션 없음");
    else {
      const para = body.split(/\n\s*\n/).find((p) => p.includes("🔁")) || "";
      const n = sentenceCount(para.replace("🔁", "").trim());
      if (sample.premium && n < 2) issues.push(`🔁 프리미엄인데 ${n}문장`);
      if (!sample.premium && n !== 1) issues.push(`🔁 무료인데 ${n}문장`);
    }
  }
  return { issues, cands, body };
}

const results = [];
for (const s of SAMPLES) {
  const params = modelParams(s.premium);
  const ctx = buildContextBlock({
    focus: normalizeFocus(s.focus),
    previous: normalizePrevious(s.previous),
    isPremium: s.premium,
  });
  const system = s.video ? buildVideoSystemPrompt(s.field, true, true) : buildSystemPrompt(s.field, true, true);
  let userText = s.note;
  if (s.video) {
    userText += `\n\n[영상 관찰 기록 — 영상 전체를 실제로 시청·청취한 전문 분석가의 타임스탬프 관찰]\n${OBSERVATION}`;
  }
  if (s.transcript) userText += `\n\n[음성 전사]\n${s.transcript}`;
  userText += ctx;

  process.stdout.write(`\n[${s.id}] ${params.model} 호출 중… `);
  const t0 = Date.now();
  const msg = await client.messages.create({
    ...params,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userText }],
  });
  const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}초, ${text.length}자`);
  const r = check(s, text);
  results.push({ s, text, ...r });
  if (r.issues.length) failed++;
  console.log(`  결과: ${r.issues.length ? "FAIL — " + r.issues.join(", ") : "PASS"}`);
  console.log(`  FOCUS: ${r.cands.map((c, i) => `${i + 1}) ${c}`).join("  ") || "(없음)"}`);
  if (s.previous) {
    const para = (r.body.split(/\n\s*\n/).find((p) => p.includes("🔁")) || "(🔁 없음)").trim();
    console.log(`  🔁: ${para.replace(/\n/g, " ")}`);
  }
}

console.log("\n────────── 요약 ──────────");
for (const r of results) {
  console.log(`${r.issues.length ? "FAIL" : "PASS"}  ${r.s.id}  후보${r.cands.length}개  ${r.issues.join("; ")}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
