// api/casting.js (공고 웹 상세 페이지) 회귀 테스트 — 외부 네트워크·실 Supabase 없음.
// 실행: node scripts/test-casting-page.js
// - (a) contact 이메일 → mailto 버튼 + 복사 버튼
// - (b) contact 전화 → tel 버튼
// - (c) contact 폼 URL → 링크 버튼
// - (d) contact 없음 + 원문 URL만 → "원문에서 지원 방법 확인"
// - (e) contact·원문 둘 다 없음 → "지원 정보 확인 중" 배지
// - (f) 마감 지남 → "마감됨"
// - (g) status inactive → 삭제·마감 안내 + /app 링크
// - (h) 잘못된 id → 400
// - (i) 없는 id → 404
// - (j) XSS: 제목·본문·contact 페이로드가 비이스케이프로 나오지 않음
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";

let nextRows = [];
let nextDbStatus = 200;
globalThis.fetch = async () => {
  if (nextDbStatus !== 200) {
    return new Response(JSON.stringify({ message: "db down", code: "XX000" }), {
      status: nextDbStatus,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(nextRows), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const { default: handler } = await import("../api/casting.js");

const ID = "d2691907-a031-4002-993b-c53f5acf9d94";

function mockRes() {
  const r = { statusCode: null, headers: {}, body: null };
  r.setHeader = (k, v) => {
    r.headers[k] = v;
  };
  r.end = (b) => {
    r.body = b;
    return r;
  };
  return r;
}

let failed = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

function row(over = {}) {
  return {
    id: ID,
    source: "filmmakers",
    source_url: "https://www.filmmakers.co.kr/actorCasting/27663230",
    title: "단편영화 주연 배우 모집",
    company: null,
    field: "acting",
    category: "단편영화",
    description: "촬영 11월 예정.\n서울 전역.",
    requirements: {},
    deadline: null,
    pay: null,
    location: null,
    contact: null,
    tags: ["단편영화"],
    tab: "오디션",
    status: "active",
    ...over,
  };
}

function ymd(offsetDays) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

async function get(id = ID) {
  const res = mockRes();
  await handler({ method: "GET", url: `/api/casting?id=${encodeURIComponent(id)}`, headers: {} }, res);
  return res;
}

// ── (a) contact 이메일 ────────────────────────────────────
{
  nextRows = [row({ contact: "cast@example.com" })];
  const res = await get();
  check("(a) 200 응답", res.statusCode === 200, `status=${res.statusCode}`);
  check("(a) Cache-Control: public, max-age=300", res.headers["Cache-Control"] === "public, max-age=300");
  check("(a) mailto 버튼", res.body.includes('href="mailto:cast@example.com"'));
  check("(a) 복사 버튼", res.body.includes('data-copy="cast@example.com"'));
  check("(a) og:title에 공고 제목", res.body.includes('<meta property="og:title" content="단편영화 주연 배우 모집 | 아트링크">'));
  check("(a) og:url이 /casting/:id", res.body.includes(`<meta property="og:url" content="https://art-link.kr/casting/${ID}">`));
  check("(a) 출처 표시명(필름메이커스)", res.body.includes("필름메이커스"));
  check("(a) 앱으로 보기 브릿지 링크", res.body.includes(`href="/app?s=casting&id=${ID}"`));
  check("(a) 본문 그대로 노출", res.body.includes("촬영 11월 예정."));
}

// 문장 안에 섞여 저장된 이메일도 버튼이 된다.
{
  nextRows = [row({ contact: "지원 메일: cast2@example.com 으로 보내주세요" })];
  const res = await get();
  check("(a) 문장 속 이메일 추출", res.body.includes('href="mailto:cast2@example.com"'));
  check("(a) contact 원문도 함께 표시", res.body.includes("지원 메일: cast2@example.com 으로 보내주세요"));
}

// ── (b) contact 전화 ──────────────────────────────────────
{
  nextRows = [row({ contact: "010-1234-5678" })];
  const res = await get();
  check("(b) tel 버튼", res.body.includes('href="tel:010-1234-5678"'));
  check("(b) mailto 없음", !res.body.includes("mailto:"));
  check("(b) 복사 버튼", res.body.includes('data-copy="010-1234-5678"'));
}

// ── (c) contact 폼 URL ────────────────────────────────────
{
  nextRows = [row({ contact: "https://forms.gle/abc123" })];
  const res = await get();
  check("(c) 지원 폼 버튼", res.body.includes('href="https://forms.gle/abc123"') && res.body.includes("지원 폼 열기"));
  check("(c) 원문 확인 버튼으로 대체되지 않음", !res.body.includes("원문에서 지원 방법 확인"));
}

// ── (d) contact 없음 + 원문 URL만 ─────────────────────────
{
  nextRows = [row({ contact: null })];
  const res = await get();
  check("(d) 원문에서 지원 방법 확인 버튼", res.body.includes("원문에서 지원 방법 확인"));
  check("(d) 원문 URL 링크", res.body.includes('href="https://www.filmmakers.co.kr/actorCasting/27663230"'));
  check("(d) 추측 지원처(mailto/tel) 없음", !res.body.includes("mailto:") && !res.body.includes("tel:"));
  check("(d) 복사 버튼 스크립트 없음", !res.body.includes("data-copy="));
}

// ── (e) contact·원문 둘 다 없음 ───────────────────────────
{
  nextRows = [row({ contact: "   ", source_url: "javascript:alert(1)" })];
  const res = await get();
  check("(e) 지원 정보 확인 중 배지", res.body.includes("지원 정보 확인 중"));
  check("(e) 위험한 스킴 링크 미출력", !res.body.includes("javascript:alert"));
  check("(e) 지원 버튼 없음", !res.body.includes("mailto:") && !res.body.includes("원문에서 지원 방법 확인"));
}

// ── (f) 마감 지남 / D-day ─────────────────────────────────
{
  nextRows = [row({ deadline: ymd(-3) })];
  const past = await get();
  check("(f) 지난 마감 → 마감됨", past.body.includes(">마감됨<"));

  nextRows = [row({ deadline: ymd(5) })];
  const soon = await get();
  check("(f) 남은 마감 → D-5", soon.body.includes(">D-5<"));

  nextRows = [row({ deadline: ymd(0) })];
  const today = await get();
  check("(f) 당일 → 오늘 마감", today.body.includes(">오늘 마감<"));

  nextRows = [row({ deadline: "상시" })];
  const bad = await get();
  check("(f) 형식이 아닌 값 → 마감일 미정", bad.body.includes(">마감일 미정<"));
}

// ── (g) 삭제·비활성 공고 ──────────────────────────────────
{
  nextRows = [row({ status: "inactive" })];
  const res = await get();
  check("(g) 200으로 열리되 안내 노출", res.statusCode === 200 && res.body.includes("삭제·마감된 공고입니다"));
  check("(g) 다른 공고 보기 링크(/app)", res.body.includes('href="/app?s=casting"'));
  check("(g) 마감 배지도 마감됨", res.body.includes(">마감됨<"));
}

// ── (h) 잘못된 id → 400 ───────────────────────────────────
{
  for (const bad of ["", "abc", "1;drop", "../../etc/passwd", "d2691907-a031-4002-993b", "<script>"]) {
    const res = await get(bad);
    check(`(h) 잘못된 id → 400 (${bad || "empty"})`, res.statusCode === 400, `status=${res.statusCode}`);
  }
  nextRows = [row()];
  const numeric = await get("12345");
  check("(h) 숫자 id는 uuid 컬럼에 못 넘기므로 400", numeric.statusCode === 400, `status=${numeric.statusCode}`);
}

// ── (i) 없는 id → 404 ─────────────────────────────────────
{
  nextRows = [];
  const res = await get("00000000-0000-0000-0000-000000000000");
  check("(i) 없는 id → 404", res.statusCode === 404, `status=${res.statusCode}`);
  check("(i) 404 문구", res.body.includes("공고를 찾을 수 없습니다"));
  check("(i) 404는 캐시하지 않음", res.headers["Cache-Control"] === "no-store");

  nextDbStatus = 500;
  const errs = [];
  const realErr = console.error;
  console.error = (...a) => errs.push(a.join(" "));
  const down = await get();
  console.error = realErr;
  nextDbStatus = 200;
  check("(i) DB 오류 → 500 + 로깅", down.statusCode === 500 && errs.some((e) => e.includes("[casting]")), errs.join("|"));
}

// ── (j) XSS 이스케이프 ────────────────────────────────────
{
  const xssTitle = '</title><script>alert(1)</script>';
  const xssBody = '<img src=x onerror=alert(1)>';
  const xssContact = '" onclick="alert(1)';
  nextRows = [row({ title: xssTitle, description: xssBody, contact: xssContact, tags: ["<b>tag</b>"] })];
  const res = await get();
  check("(j) 제목 비이스케이프 미출력", !res.body.includes(xssTitle));
  check("(j) 제목 이스케이프됨", res.body.includes("&lt;/title&gt;&lt;script&gt;"));
  check("(j) 본문 비이스케이프 미출력", !res.body.includes(xssBody));
  check("(j) contact 따옴표 이스케이프", !res.body.includes(xssContact) && res.body.includes("&quot; onclick=&quot;alert(1)"));
  check("(j) 태그 이스케이프", !res.body.includes("<b>tag</b>"));
  check("(j) 주입된 script 태그 없음", (res.body.match(/<script>/g) || []).length <= 1);
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
