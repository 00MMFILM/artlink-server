// api/casting.js (공고 웹 상세 페이지) 회귀 테스트 — 외부 네트워크·실 Supabase 없음.
// 실행: node scripts/test-casting-page.js
// - (a) contact 이메일 → mailto 버튼 + 복사 버튼
// - (b) contact 전화 → tel 버튼
// - (c) contact 폼 URL → 링크 버튼
// - (d) contact 없음 + 원문 URL만 → "원문에서 지원 방법 확인"
// - (e) contact·원문 둘 다 없음 → "지원 정보 확인 중" 배지
// - (f) 마감 지남 → 410, 연락처/본문 비공개
// - (g) status inactive → 410 + 앱 다운로드 링크
// - (h) 잘못된 id → 400
// - (i) 없는 id → 404
// - (j) XSS: 제목·본문·contact 페이로드가 비이스케이프로 나오지 않음
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";

let nextRows = [];
let nextDbStatus = 200;
const requests = [];
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.origin !== "http://127.0.0.1:9" || url.pathname !== "/mock/rest/v1/postings") {
    throw new Error("Unexpected network target in offline test");
  }
  requests.push(url);
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
let checked = 0;
function check(name, cond, extra = "") {
  checked++;
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
  check("(a) 종료 뒤 연락처 캐시가 남지 않음", res.headers["Cache-Control"] === "no-store");
  check("(a) mailto 버튼", res.body.includes('href="mailto:cast@example.com"'));
  check("(a) 복사 버튼", res.body.includes('data-copy="cast@example.com"'));
  check("(a) og:title에 공고 제목", res.body.includes('<meta property="og:title" content="단편영화 주연 배우 모집 | 아트링크">'));
  check("(a) og:url이 /casting/:id", res.body.includes(`<meta property="og:url" content="https://art-link.kr/casting/${ID}">`));
  check("(a) 출처 표시명(필름메이커스)", res.body.includes("필름메이커스"));
  check("(a) 실제 목적지인 앱 다운로드 안내", res.body.includes('href="/app?s=casting">아트링크 앱 다운로드') && !res.body.includes("앱에서 보기") && !res.body.includes(`&id=${ID}`));
  check("(a) 공고 요약 표시", res.body.includes("공고 요약") && res.body.includes("촬영 11월 예정."));
  check("(a) 필요한 공개 컬럼만 조회", requests.at(-1).searchParams.get("select") === "id,source,source_url,title,company,category,description,deadline,pay,location,contact,tags,status");
  check("(a) UUID 한 건만 조회", requests.at(-1).searchParams.get("id") === `eq.${ID}` && requests.at(-1).searchParams.get("limit") === "1");
}

// 복합 문장은 임의의 첫 주소를 선택하지 않는다.
{
  nextRows = [row({ contact: "지원 메일: cast2@example.com 으로 보내주세요" })];
  const res = await get();
  check("(a) 문장 속 이메일을 임의 추출하지 않음", !res.body.includes('href="mailto:'));
  check("(a) contact 원문도 함께 표시", res.body.includes("지원 메일: cast2@example.com 으로 보내주세요"));
  check("(a) 복합 지원처는 원문 확인과 복사 제공", res.body.includes("원문에서 지원 방법 확인") && res.body.includes("data-copy="));
}

// ── (b) contact 전화 ──────────────────────────────────────
{
  nextRows = [row({ contact: "010-1234-5678" })];
  const res = await get();
  check("(b) tel 버튼 숫자로 정규화", res.body.includes('href="tel:01012345678"'));
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
  check("(f) 지난 마감 → 410", past.statusCode === 410 && past.body.includes("마감된 공고입니다"));

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
  check("(g) 비활성은 410 안내", res.statusCode === 410 && res.body.includes("공개가 종료된 공고"));
  check("(g) 앱 다운로드 링크(/app)", res.body.includes('href="/app?s=casting"'));
  check("(g) 비활성 응답 캐시 금지", res.headers["Cache-Control"] === "no-store");
}

// ── (h) 잘못된 id → 400 ───────────────────────────────────
{
  for (const bad of ["", "abc", "1;drop", "../../etc/passwd", "d2691907-a031-4002-993b", "<script>"]) {
    const before = requests.length;
    const res = await get(bad);
    check(`(h) 잘못된 id → DB 조회 없이 400 (${bad || "empty"})`, res.statusCode === 400 && requests.length === before, `status=${res.statusCode}`);
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

// URL의 @는 이메일이 아니다. 이메일 헤더·스킴·혼합 값은 직접 실행하지 않는다.
{
  nextRows = [row({ contact: "https://forms.example/apply?email=cast@example.com&campaign=casting" })];
  const form = await get();
  check("(k) 이메일 쿼리가 든 URL도 지원 폼으로 열림", form.body.includes('href="https://forms.example/apply?email=cast@example.com&amp;campaign=casting"') && !form.body.includes('href="mailto:'));

  for (const contact of [
    "mailto:cast@example.com", "cast@example.com?bcc=other%40example.invalid", "cast@example.com#fragment",
    "cast@example.com%0d%0aBcc:other@example.invalid", "cast@example.com\r\nBcc:other@example.invalid",
    "a@example.com,b@example.com", ".cast@example.com", "cast..test@example.com", "cast@example..com",
    "https://%", "https://user:password@forms.example/apply", "https://forms.example/\\bad",
    "https://forms.example/%0Aheader", "https://forms.example/%00null", "https://forms.example/%1fcontrol", "https://forms.example/%7Fdel", "javascript:alert(1)", "data:text/html,<script>alert(1)</script>",
    "01012345678;phone-context=attacker.example", "01012345678\r\n999",
  ]) {
    nextRows = [row({ contact })];
    const res = await get();
    check(`(k) 단일 지원처가 아닌 값은 원문 확인 (${JSON.stringify(contact)})`, !res.body.includes('href="mailto:') && !res.body.includes('href="tel:') && !res.body.includes("지원 폼 열기") && res.body.includes("원문에서 지원 방법 확인"));
  }
  nextRows = [row({ contact: "casting+film@example.co.kr" })];
  check("(k) 정상 plus 이메일은 mailto 인코딩", (await get()).body.includes('href="mailto:casting%2Bfilm@example.co.kr"'));
  nextRows = [row({ contact: "02 123 4567" })];
  check("(k) 서울 전화와 공백 지원", (await get()).body.includes('href="tel:021234567"'));
  nextRows = [row({ contact: "01012345678" })];
  check("(k) 하이픈 없는 휴대전화 지원", (await get()).body.includes('href="tel:01012345678"'));
}

// 상태와 KST 날짜가 공개 가능성을 결정한다. 종료/비공개 행은 HTML과 OG에서 모두 숨긴다.
{
  for (const [over, status] of [
    [{ status: "inactive" }, 410], [{ status: "active", deadline: ymd(-1) }, 410],
    [{ status: "deleted" }, 404], [{ status: "draft" }, 404], [{ status: null }, 404],
  ]) {
    nextRows = [row({ ...over, title: "PRIVATE_TITLE", description: "PRIVATE_BODY", contact: "private@example.com", source_url: "https://source.example/private" })];
    const res = await get();
    check(`(l) ${JSON.stringify(over)}는 ${status}, 공개 데이터 없음`, res.statusCode === status && res.headers["Cache-Control"] === "no-store" && !/PRIVATE_|private@example|source\.example\/private|mailto:|tel:|og:url|data-copy=/.test(res.body));
  }
  for (const deadline of ["2026-02-31", "2026-13-01", [ymd(0)], 20260926]) {
    nextRows = [row({ deadline })];
    const res = await get();
    check(`(l) 잘못된 날짜는 미정 (${JSON.stringify(deadline)})`, res.statusCode === 200 && res.body.includes(">마감일 미정<"));
  }
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-09-25T15:00:00Z"); // KST 9/26 00:00
    nextRows = [row({ deadline: "2026-09-26", contact: "cast@example.com" })];
    const today = await get();
    check("(l) UTC 전날이어도 KST 오늘 마감은 지원 가능", today.statusCode === 200 && today.body.includes(">오늘 마감<") && today.body.includes('href="mailto:'));
    Date.now = () => Date.parse("2026-09-26T15:00:00Z"); // KST 9/27 00:00
    const expired = await get();
    check("(l) KST 자정이 지나면 지원처 비공개", expired.statusCode === 410 && !expired.body.includes("cast@example.com"));
  } finally {
    Date.now = realNow;
  }
}

// 공개 본문은 짧은 요약에 한정하며 내부 필드는 렌더링하지 않는다.
{
  nextRows = [row({ description: "가".repeat(300) + "PRIVATE_TAIL", requirements: { note: "INTERNAL_REQUIREMENTS" }, admin_notes: "INTERNAL_NOTES", raw_html: "INTERNAL_HTML" })];
  const res = await get();
  check("(m) 본문은 280자 요약과 생략 표시", res.body.includes("가".repeat(280) + "…") && !res.body.includes("가".repeat(281)) && !res.body.includes("PRIVATE_TAIL"));
  check("(m) 내부 필드 미노출", !/INTERNAL_REQUIREMENTS|INTERNAL_NOTES|INTERNAL_HTML/.test(res.body));
  check("(m) noindex 유지, 원문 확인 안내", res.body.includes('<meta name="robots" content="noindex">') && res.body.includes("모집 조건과 지원 방법은 원문에서 확인"));
}

// rewrite query 입력과 직접 API 입력의 계약. 실제 Vercel 라우터 검증과는 별개다.
{
  nextRows = [row()];
  const rewritten = mockRes();
  await handler({ method: "GET", url: `/casting/${ID}`, query: { id: ID } }, rewritten);
  check("(n) rewrite의 req.query.id로 조회", rewritten.statusCode === 200);
  for (const req of [
    { method: "GET", url: "/api/casting", query: { id: [ID, ID] } },
    { method: "GET", url: `/api/casting?id=${ID}&id=${ID}` },
    { method: "GET", url: `/casting/${ID}`, query: { id: { malicious: ID } } },
    { method: "POST", url: `/api/casting?id=${ID}` },
  ]) {
    const before = requests.length;
    const res = mockRes();
    await handler(req, res);
    check(`(n) 중복/객체 id 및 비조회 메서드는 DB 요청 없음 (${req.method})`, requests.length === before && [400, 405].includes(res.statusCode) && res.headers["Cache-Control"] === "no-store");
  }
  const head = mockRes();
  await handler({ method: "HEAD", url: `/api/casting?id=${ID}` }, head);
  check("(n) HEAD 링크 확인 허용", head.statusCode === 200);
  const { readFile } = await import("node:fs/promises");
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  check("(n) casting rewrite가 정확한 UUID 경로의 query로 연결", config.rewrites.some((r) => r.source === "/casting/:id" && r.destination === "/api/casting?id=:id"));
  check("(n) 모든 외부 요청이 오프라인 Supabase mock 한 곳으로 한정", requests.every((u) => u.origin === "http://127.0.0.1:9" && u.pathname.endsWith("/rest/v1/postings")));
}

// 실제 응답의 스크립트를 실행한다. 브라우저/OS 권한 검증을 대신하지 않는 오프라인 DOM mock이다.
{
  const { runInNewContext } = await import("node:vm");
  const contact = "casting+film@example.co.kr";
  nextRows = [row({ contact })];
  const res = await get();
  const script = res.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  check("(o) 복사 결과 안내가 버튼 바로 옆 aria-live 영역에 표시", /data-copy="[^"]+">복사<\/button><span[^>]+role="status"[^>]+aria-live="polite"[^>]+data-copy-status/.test(res.body));

  async function executeCopy(clipboardMode) {
    const copied = [];
    const timers = [];
    const status = { textContent: "" };
    let click;
    const button = {
      textContent: "복사",
      nextElementSibling: status,
      getAttribute: (name) => name === "data-copy" ? contact : null,
      addEventListener: (event, callback) => { if (event === "click") click = callback; },
    };
    const navigator = clipboardMode === "unsupported" ? {} : {
      clipboard: {
        writeText(value) {
          copied.push(value);
          if (clipboardMode === "throw") throw new Error("Clipboard unavailable");
          if (clipboardMode === "denied") return Promise.reject(new Error("NotAllowedError"));
          return Promise.resolve();
        },
      },
    };
    runInNewContext(script, {
      document: { querySelectorAll: (selector) => selector === "[data-copy]" ? [button] : [] },
      navigator,
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    }, { timeout: 1000 });
    let error = null;
    try { await click(); } catch (err) { error = err; }
    return { copied, timers, status, button, error };
  }

  const success = await executeCopy("success");
  check("(o) Clipboard 성공 콜백이 실제 연락처를 한 번 복사", !success.error && success.copied.length === 1 && success.copied[0] === contact);
  check("(o) 성공 후 버튼·접근성 안내 갱신", success.button.textContent === "복사됨" && success.status.textContent === "복사했습니다.");
  check("(o) 성공 안내는 예약된 콜백 뒤 복구", success.timers.length === 1 && success.timers[0].delay === 1500);
  success.timers[0]?.callback();
  check("(o) 복구 콜백 실행 후 다시 복사 가능", success.button.textContent === "복사" && success.status.textContent === "");

  for (const mode of ["denied", "unsupported", "throw"]) {
    const result = await executeCopy(mode);
    check(`(o) Clipboard ${mode}도 예외 대신 수동 복사 안내`, !result.error && result.button.textContent === "복사" && result.status.textContent.includes("표시된 지원 정보를 길게 눌러 복사해 주세요"));
    check(`(o) Clipboard ${mode}에 거짓 성공·자동 숨김 없음`, result.timers.length === 0 && result.copied.length === (mode === "unsupported" ? 0 : 1));
  }
}

console.log(failed === 0 ? `\nALL ${checked} PASS` : `\n${failed} / ${checked} FAILED`);
process.exit(failed === 0 ? 0 : 1);
