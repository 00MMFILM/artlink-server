// api/premium-badges.js 회귀 테스트 (외부 네트워크·실 Supabase 없음)
// 실행: node scripts/test-premium-badges.js
// 시나리오:
// (a) X-App-Token 없음 → 401
// (b) active=true만 포함, inactive 제외(쿼리 필터 검증 포함) → 200, userIds/count 일치
// (c) DB 오류 → 500(조용한 200 금지)
// (d) 빈 목록 → 200, userIds:[]
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";
process.env.APP_SECRET = "test-app-secret";

// premium_members mock 행. 항상 active=true인 행만 담아 "서버 쿼리가 실제로
// active=eq.true 필터를 보내는지"를 검증한다(안 보내면 이 mock도 걸러줄 수 없으므로
// lastUrl로 별도 확인).
let mockActiveRows = [];
let nextDbStatus = 200;
let lastUrl = null;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

globalThis.fetch = async (url) => {
  lastUrl = String(url);
  if (nextDbStatus !== 200) {
    return json({ message: "db down", code: "XX000" }, nextDbStatus);
  }
  const u = new URL(url);
  if (u.pathname.includes("/premium_members")) {
    // active=eq.true 필터가 실제로 붙었는지 확인 후, 안 붙었으면 빈 배열(안전 실패)
    if (u.searchParams.get("active") !== "eq.true") return json([]);
    return json(mockActiveRows);
  }
  return json([]);
};

const { default: handler } = await import("../api/premium-badges.js");

function mockRes() {
  const r = { code: null, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

let failed = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

// (a) 토큰 없음
let res = mockRes();
await handler({ method: "GET", headers: {} }, res);
check("(a) X-App-Token 없음 → 401", res.code === 401, `status=${res.code}`);

// (b) active만 포함 (inactive는 서버 쿼리가 애초에 배제 — active=eq.true 필터로 검증)
mockActiveRows = [{ user_id: "uuid-active-1" }, { user_id: "uuid-active-2" }];
res = mockRes();
await handler({ method: "GET", headers: { "x-app-token": "test-app-secret" } }, res);
check("(b) 200 반환", res.code === 200, `status=${res.code}`);
check(
  "(b) active만 포함된 userIds 반환",
  Array.isArray(res.body?.userIds) &&
    res.body.userIds.length === 2 &&
    res.body.userIds.includes("uuid-active-1") &&
    res.body.userIds.includes("uuid-active-2"),
  JSON.stringify(res.body)
);
check("(b) count가 userIds 길이와 일치", res.body?.count === 2, JSON.stringify(res.body));
check("(b) 쿼리에 active=eq.true 필터 포함(inactive 제외 근거)", (lastUrl || "").includes("active=eq.true"), lastUrl);
check("(b) generatedAt이 ISO 문자열", typeof res.body?.generatedAt === "string" && !isNaN(Date.parse(res.body.generatedAt)), JSON.stringify(res.body));
check("(b) Cache-Control 5분 캐시 헤더", res.headers["Cache-Control"] === "public, max-age=300", JSON.stringify(res.headers));

// (c) DB 오류 → 500 (조용한 200 금지)
nextDbStatus = 500;
const errs = [];
const realErr = console.error;
console.error = (...a) => errs.push(a.join(" "));
res = mockRes();
await handler({ method: "GET", headers: { "x-app-token": "test-app-secret" } }, res);
console.error = realErr;
check("(c) DB 오류 → 500", res.code === 500, `status=${res.code}`);
check("(c) DB 오류를 console.error로 남김", errs.some((e) => e.includes("[premium-badges]")), errs.join("|"));
nextDbStatus = 200;

// (d) 빈 목록
mockActiveRows = [];
res = mockRes();
await handler({ method: "GET", headers: { "x-app-token": "test-app-secret" } }, res);
check("(d) 빈 목록 → 200, userIds:[]", res.code === 200 && Array.isArray(res.body?.userIds) && res.body.userIds.length === 0, JSON.stringify(res.body));
check("(d) count:0", res.body?.count === 0, JSON.stringify(res.body));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
