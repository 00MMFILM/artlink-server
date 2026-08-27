// 게스트(비로그인) AI 체험 정책 회귀 테스트 (2026-08-27: 평생 3회, 하루 1회)
// 실행: node scripts/test-guest-quota.js  (외부 네트워크·실 Supabase 없음)
// 시나리오:
// (a) 신규(row 없음) → allowed:true
// (b) count:1, updated_at=오늘 → allowed:false (하루 1회 게이트)
// (c) count:1, updated_at=어제 → allowed:true (다음 날 재개)
// (d) count:3, updated_at=어제 → allowed:false (평생 3회 소진)
// (e) 반환 객체에 allowed/used/max 필드 존재 (호출부 계약 유지)
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";

// guest_ai_usage 테이블의 device_id별 mock row. undefined면 "row 없음".
let mockRows = {};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const method = (init.method || "GET").toUpperCase();
  if (u.pathname.includes("/guest_ai_usage") && method === "GET") {
    const eq = u.searchParams.get("device_id") || ""; // "eq.<id>"
    const deviceId = eq.replace(/^eq\./, "");
    const row = mockRows[deviceId];
    return json(row ? [row] : []); // maybeSingle: GET은 배열로 응답, 클라이언트가 단일화
  }
  // upsert 등 이 테스트 범위 밖 요청은 빈 배열로 무해 처리
  return json([]);
};

const { checkGuestQuota } = await import("../api/_usage.js");

let failed = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

function kstDayStr(offsetDays = 0) {
  const ts = Date.now() + offsetDays * 86400000;
  return new Date(ts + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
// updated_at은 실제 컬럼처럼 ISO timestamp로 저장한다 (KST 날짜 문자열이 아님).
// "오늘/어제"를 안전하게 표현하기 위해 KST 정오 시각을 UTC ISO로 환산해 넣는다.
function isoAtKstNoon(offsetDays) {
  const day = kstDayStr(offsetDays); // YYYY-MM-DD (KST)
  // KST 정오 = UTC 03:00 같은 날짜
  return new Date(`${day}T03:00:00.000Z`).toISOString();
}

// (a) 신규 — row 없음
mockRows = {};
const a = await checkGuestQuota("dev-a");
check("(a) 신규(row 없음) → allowed:true", a.allowed === true, JSON.stringify(a));

// (b) count:1, updated_at=오늘 → allowed:false (하루 1회)
mockRows = { "dev-b": { count: 1, updated_at: isoAtKstNoon(0) } };
const b = await checkGuestQuota("dev-b");
check("(b) count:1·오늘 사용 → allowed:false (하루 1회 게이트)", b.allowed === false, JSON.stringify(b));

// (c) count:1, updated_at=어제 → allowed:true (다음 날 재개)
mockRows = { "dev-c": { count: 1, updated_at: isoAtKstNoon(-1) } };
const c = await checkGuestQuota("dev-c");
check("(c) count:1·어제 사용 → allowed:true (다음 날 재개)", c.allowed === true, JSON.stringify(c));

// (d) count:3, updated_at=어제 → allowed:false (평생 3회 소진)
mockRows = { "dev-d": { count: 3, updated_at: isoAtKstNoon(-1) } };
const d = await checkGuestQuota("dev-d");
check("(d) count:3(소진) → allowed:false (하루 게이트 통과해도 총량 소진)", d.allowed === false, JSON.stringify(d));

// (e) 반환 객체 계약: allowed/used/max 필드 존재 (호출부가 이 필드를 읽음)
const eHasFields = [a, b, c, d].every(
  (r) => "allowed" in r && "used" in r && "max" in r && r.max === 3
);
check("(e) 반환 객체에 allowed/used/max 필드 유지 (max=3)", eHasFields, JSON.stringify({ a, b, c, d }));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
