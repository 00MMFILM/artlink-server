// AI 피드백 1회 원가 실측 — 프로덕션 핸들러(api/ai-analyze.js)를 그대로 호출해 usage를 수집한다.
// 실행: ANTHROPIC_API_KEY는 환경변수로 주입 (파일 저장 금지). SUPABASE_* 있으면 동적 예시까지 재현.
//   node scripts/measure-ai-cost.mjs
// 시나리오: A=신규 사용자(히스토리 없음), B=헤비 사용자(이전 피드백 10개 포함)
// 각 2회 호출 → 1회차 캐시 쓰기, 2회차 캐시 읽기 비용 확인.

import handler from "../api/ai-analyze.js";

const PRICE = { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 }; // $/MTok, Haiku 4.5

const FIELD_SYSTEM = `당신은 ArtLink의 연기 전문 AI 코치입니다. 스타니슬랍스키 시스템, 마이즈너 테크닉, 우타 하겐의 리스펙트 포 액팅에 기반한 분석을 합니다.
분석 관점: 감정 진실성, 서브텍스트 깊이, 비트 전환, 신체적 표현, 호흡과 템포.
감정 분석 프레임워크(AI Hub 감정 음성 데이터 기반): 대분류(기쁨/슬픔/분노/공포/놀람/혐오/중립) → 소분류(#울먹이듯, #안쓰러운듯, #담담하게, #격앙된, #떨리는, #속삭이듯 등). 배우의 감정 표현을 이 체계로 세밀하게 분석하세요.
음성 표현 프레임워크(Fish Audio S2 감정 태그 체계 기반): 발성 톤을 다음 15,000+ 태그 분류로 정밀 분석하세요 — 속삭임(whisper)/떨림(trembling)/격앙(excited)/담담함(calm)/울먹임(sobbing)/냉소(sarcastic)/비명(screaming)/웃음섞인(laughing)/전문적 어조(professional)/부드러운(gentle)/단호한(firm)/피치업(pitch up)/피치다운(pitch down)/느리게(slow)/빠르게(fast). 대사마다 감정 태그의 전환 지점과 레이어링을 분석하고, 같은 대사를 다른 감정 태그로 전달했을 때의 차이를 제안하세요.
프로소디(운율) 분석: 피치 변동 곡선, 속도 변화(가속/감속), 강세 위치, 쉼 타이밍(0.3초/0.5초/1초), 음량 곡선(pp→ff), 호흡점. 각 대사의 운율 패턴이 캐릭터의 내면 상태를 어떻게 반영하는지 분석하세요.
캐릭터 음성 시그니처: 각 캐릭터만의 고유한 음역대(register), 말투 리듬, 호흡 패턴, 톤 컬러를 식별하고 차별화 정도를 평가하세요.
신체 분석 프레임워크(모션캡처 77개 관절점 기반): 골반 중심축, 척추 정렬, 어깨-팔-손끝 연결성, 무게 중심 이동, 시선 방향과 목 각도를 관찰하세요.`;

const FEEDBACK_HEADER = `위 내용을 분석하고 아래 형식으로 전문적이고 상세한 피드백해주세요 (1500-2000자, 각 섹션 2-4문장):
📌 전체 인상 (1-2문장)
💪 강점 분석 (구체적 근거와 함께 상세히)
🎯 개선 포인트 (실천 가능한 제안을 구체적으로)
🎭 기술 분석 (연기 분야 전문 용어로 구체적 기술 평가)
🎨 롤모델 연결 (관련 아티스트/작품 레퍼런스)
💡 영감 포인트 (다른 분야와의 연결점, 크로스오버 아이디어)
📈 성장 트래킹 (이전 대비 변화 관찰)
🔜 다음 스텝 (구체적 연습 과제 1개)`;

const NOTE = `오늘은 오디션용 독백 '갈매기' 니나 대사를 연습했다. 감정이 격해지는 중반부에서 호흡이 자꾸 얕아져서 대사 끝이 흐려졌다. 거울 앞에서 세 번 반복했는데, 세 번째에는 시선 처리를 낮추니까 오히려 감정이 안으로 모이는 느낌이 들었다. 내일은 서서 움직이면서 같은 대사를 해볼 예정. 비트 전환 지점을 세 군데로 나눠서 표시해뒀다.`;

const HISTORY_ITEM = `📌 오늘 독백 연습에서 감정의 레이어가 한층 깊어졌어요. 대사 아래 숨겨진 캐릭터의 불안이 자연스럽게 드러나고 있습니다. 💪 목소리가 미세하게 떨리면서도 눈빛은 단호한 점이 훌륭해요. 이 모순이 캐릭터의 내면 갈등을 압축적으로 보여줍니다. 🎯 세 번째 비트 전환에서 감정이 급격히 바뀌는데, 호흡으로 브릿지를 만들어보세요. 들숨에서 감정을 전환하면 관객도 함께 전환할 시간을 얻어요. 감정 곡선이 더 유기적이 됩니다. 📈 지난번 대비 비트 전환이 유기적이에요. 쉼을 가져가는 용기가 생긴 게 보여요.`.slice(0, 400);

const promptLight = `${FIELD_SYSTEM}
\n[사용자 롤모델: 전도연, 송강호]

[사용자의 연기 연습 노트]
${NOTE}

${FEEDBACK_HEADER}`;

const history = Array.from({ length: 10 }, (_, i) => `${i + 1}. (독백 연습 ${i + 1}일차) ${HISTORY_ITEM}`).join("\n");
const promptHeavy = `${FIELD_SYSTEM}

[이전 연기 피드백 히스토리 — 최근 10개]
${history}
[사용자 롤모델: 전도연, 송강호]

[사용자의 연기 연습 노트]
${NOTE}

${FEEDBACK_HEADER}`;

// handler가 console.log로 남기는 usage를 가로챈다
let lastUsage = null;
const origLog = console.log;
console.log = (...args) => {
  const line = args.join(" ");
  const m = line.match(/\[ai-analyze\] usage: (.*)$/);
  if (m) { try { lastUsage = JSON.parse(m[1]); } catch {} }
  origLog(...args);
};

function fakeRes() {
  const res = {
    headers: {}, statusCode: 200, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    write() {}, end() {},
  };
  return res;
}

function cost(u) {
  const inp = (u.input_tokens || 0) * PRICE.input;
  const cw = (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite;
  const cr = (u.cache_read_input_tokens || 0) * PRICE.cacheRead;
  const out = (u.output_tokens || 0) * PRICE.output;
  return { usd: (inp + cw + cr + out) / 1e6, parts: { inp, cw, cr, out } };
}

async function run(label, prompt) {
  lastUsage = null;
  const res = fakeRes();
  const t0 = Date.now();
  await handler({ method: "POST", body: { prompt, field: "acting", noteTitle: "독백 연습" }, query: {} }, res);
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.statusCode !== 200 || !res.body?.analysis) {
    origLog(`❌ ${label}: HTTP ${res.statusCode}`, JSON.stringify(res.body).slice(0, 200));
    return null;
  }
  const u = lastUsage || {};
  const c = cost(u);
  origLog(`\n=== ${label} (${sec}s, 응답 ${res.body.analysis.length}자) ===`);
  origLog(`  input=${u.input_tokens} cacheWrite=${u.cache_creation_input_tokens} cacheRead=${u.cache_read_input_tokens} output=${u.output_tokens}`);
  origLog(`  비용: $${c.usd.toFixed(6)} (₩${Math.round(c.usd * 1400)}원, 1400원/$ 기준)`);
  return { usage: u, cost: c.usd };
}

const results = {};
results.A1 = await run("A-1 신규사용자 노트 · 콜드(캐시 쓰기)", promptLight);
results.A2 = await run("A-2 신규사용자 노트 · 웜(캐시 읽기)", promptLight);
results.B1 = await run("B-1 헤비사용자(히스토리 10개) · 웜", promptHeavy);
results.B2 = await run("B-2 헤비사용자 재호출 · 웜", promptHeavy);

origLog("\n========== 요약 ==========");
for (const [k, v] of Object.entries(results)) {
  if (v) origLog(`${k}: $${v.cost.toFixed(6)} (₩${Math.round(v.cost * 1400)})`);
}
