// 조용한 실패(DB 쓰기 에러 미확인) 회귀 테스트 — mock supabase가 500을 돌려줄 때
// report/track-event/grantAdCredit가 실패를 제대로 전파하는지 확인한다.
// 실행: node scripts/test-silent-fail.js  (외부 네트워크·실 Supabase 없음)
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";
process.env.APP_SECRET = ""; // 앱 토큰 게이트는 이 테스트 범위 밖

let dbFails = false;
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
globalThis.fetch = async (url, init = {}) => {
  const method = init.method || "GET";
  if (method === "GET") return json([{ text_count: 0, ad_credits: 0 }]); // 기존 사용량 조회
  if (dbFails) return json({ message: "db down", code: "XX000" }, 500);
  return json([]);
};

const { default: reportHandler } = await import("../api/report.js");
const { default: trackEventHandler } = await import("../api/track-event.js");
const { grantAdCredit } = await import("../api/_usage.js");

function mockRes() {
  const r = { code: null, body: null };
  r.setHeader = () => {};
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

const errs = [];
const realErr = console.error;
const realLog = console.log;
console.error = (...a) => errs.push(a.join(" "));

// ── report.js
dbFails = false;
let res = mockRes();
await reportHandler({ method: "POST", headers: {}, body: { type: "block_user" } }, res);
const okReport = res.code === 200 && res.body.success === true;

dbFails = true;
res = mockRes();
await reportHandler({ method: "POST", headers: {}, body: { type: "block_user" } }, res);
const failReport = { code: res.code, body: res.body };

// ── track-event.js
dbFails = true;
res = mockRes();
await trackEventHandler({ method: "POST", headers: {}, body: { deviceId: "d1", event: "new_open" } }, res);
const failEvent = { code: res.code, body: res.body };

// ── _usage.js grantAdCredit
dbFails = false;
const okGrant = await grantAdCredit("user-1");
dbFails = true;
const failGrant = await grantAdCredit("user-1");

console.error = realErr;
console.log = realLog;

check("report: 정상 저장 시 200 success:true", okReport);
check("report: DB 실패 시 500 전파", failReport.code === 500 && failReport.body.success === false, JSON.stringify(failReport));
check("report: DB 실패를 console.error로 남김", errs.some((e) => e.includes("[REPORT DB ERROR]")));
check("track-event: DB 실패해도 200 유지(수집은 best-effort)", failEvent.code === 200, JSON.stringify(failEvent));
check("track-event: DB 실패를 로깅 + success:false", failEvent.body.success === false && errs.some((e) => e.includes("[track-event]")));
check("grantAdCredit: 정상 시 granted:true", okGrant.granted === true && okGrant.adCredits === 1, JSON.stringify(okGrant));
check("grantAdCredit: upsert 실패 시 granted:false (유령 적립 차단)", failGrant.granted === false, JSON.stringify(failGrant));
check("grantAdCredit: 실패를 console.error로 남김", errs.some((e) => e.includes("grantAdCredit upsert failed")));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
