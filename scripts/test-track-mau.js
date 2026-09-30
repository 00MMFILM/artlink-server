// api/track-mau.js 회귀 테스트 (외부 네트워크·실 Supabase 없음).
// 실행: node scripts/test-track-mau.js
// - (a) body 없는 POST에서 500/throw가 나지 않는가 (구버전은 req.body 구조분해에서 TypeError)
// - (b) 월 키가 KST 기준인가 (UTC면 매월 1일 00~09시 KST가 전월로 집계됨)
// - (c) upsert 실패를 삼키지 않고 로깅하는가
// - (d) last_seen은 클라이언트 timestamp가 아닌 서버 시각
// - (e) 예외(catch) 경로도 success:false + 로그
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";

let upsertBody = null;
let nextDbStatus = 200;
globalThis.fetch = async (url, init) => {
  upsertBody = JSON.parse(init.body);
  if (nextDbStatus !== 200) {
    return new Response(JSON.stringify({ message: "db down", code: "XX000" }), {
      status: nextDbStatus,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify([upsertBody]), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const { default: handler, kstMonth } = await import("../api/track-mau.js");

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

// (a) body 없는 POST
let res = mockRes();
let threw = null;
try {
  await handler({ method: "POST", headers: {} }, res);
} catch (e) {
  threw = e;
}
check("(a) body 없는 POST에서 throw 없음", threw === null, threw ? threw.message : "");
check("(a) 500이 아니라 400 반환", res.code === 400, `status=${res.code}`);

// (b) KST 월 키
const realNow = Date.now;
Date.now = () => Date.parse("2026-08-31T23:30:00Z"); // KST 2026-09-01 08:30
const kst = kstMonth();
const utc = new Date(Date.now()).toISOString().slice(0, 7);
Date.now = realNow;
check("(b) KST 경계에서 월 키가 다음 달", kst === "2026-09", `kst=${kst} utc=${utc}`);

res = mockRes();
await handler({ method: "POST", headers: {}, body: { deviceId: "dev-1" } }, res);
check("(b) 정상 바디에서 200", res.code === 200 && res.body.success === true, JSON.stringify(res.body));
check("(b) 저장된 month가 kstMonth()와 일치", upsertBody.month === kstMonth(), `month=${upsertBody.month}`);

// (c) upsert 실패 전파
nextDbStatus = 500;
const errs = [];
const realErr = console.error;
console.error = (...a) => errs.push(a.join(" "));
res = mockRes();
await handler({ method: "POST", headers: {}, body: { deviceId: "dev-2" } }, res);
console.error = realErr;
check("(c) upsert 실패를 console.error로 남김", errs.some((e) => e.includes("[track-mau]")), errs.join("|"));
check("(c) 실패 시 success:false", res.body && res.body.success === false, JSON.stringify(res.body));

// (d) 클라이언트가 미래 timestamp를 보내도 서버 시각 저장
nextDbStatus = 200;
const before = Date.now();
res = mockRes();
await handler({ method: "POST", headers: {}, body: { deviceId: "dev-3", timestamp: "2026-10-17T00:00:00.000Z" } }, res);
const seen = Date.parse(upsertBody.last_seen);
check("(d) last_seen = 서버 시각(클라이언트 미래값 무시)", seen >= before && seen <= Date.now(), `last_seen=${upsertBody.last_seen}`);

// (e) fetch 자체가 throw → catch 경로
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("network down"); };
const errs2 = [];
console.error = (...a) => errs2.push(a.join(" "));
res = mockRes();
await handler({ method: "POST", headers: {}, body: { deviceId: "dev-4" } }, res);
console.error = realErr;
globalThis.fetch = realFetch;
check("(e) 예외 시 200 + success:false", res.code === 200 && res.body && res.body.success === false, JSON.stringify(res.body));
check("(e) 예외를 console.error로 남김", errs2.some((e) => e.includes("[track-mau]")), errs2.join("|"));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
