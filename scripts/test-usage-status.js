// getPremiumInfo / usage-status 프리미엄 표시 회귀 테스트
// 실행: node scripts/test-usage-status.js  (외부 네트워크·실 Supabase 없음)
// 시나리오:
// (a) kind:sub, note에 monthly 포함 → plan:"monthly", active:true
// (b) kind:sub, note에 yearly 포함 → plan:"yearly", active:true
// (c) kind:comp → kind:"comp", plan:null
// (d) 미등재(row 없음) → active:false, kind:null, plan:null, since:null
// (e) checkTextQuota/checkVideoQuota 반환 계약(allowed/used/max) 유지 — 기존 키 불변 확인
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";

// premium_members 테이블의 user_id별 mock row. undefined면 "미등재".
let mockPremiumRows = {};
// ai_usage_daily / ai_video_usage는 이 테스트 범위 밖 — 빈 결과로 무해 처리.

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.pathname.includes("/premium_members")) {
    const eq = u.searchParams.get("user_id") || ""; // "eq.<id>"
    const userId = eq.replace(/^eq\./, "");
    const row = mockPremiumRows[userId];
    return json(row ? [row] : []); // maybeSingle: GET은 배열로 응답
  }
  // ai_usage_daily, ai_video_usage 등: 이 테스트 범위 밖 — 빈 배열로 무해 처리
  return json([]);
};

const { getPremiumInfo, checkTextQuota, checkVideoQuota } = await import("../api/_usage.js");

let failed = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

// (a) sub 월간
mockPremiumRows = {
  "user-a": {
    kind: "sub",
    note: "rc:INITIAL_PURCHASE:artlink_premium_monthly:2026-09-17T12:51:28.633Z",
    created_at: "2026-09-17T12:51:28.633Z",
    active: true,
  },
};
const a = await getPremiumInfo("user-a");
check(
  "(a) sub 월간 → active:true, kind:sub, plan:monthly",
  a.active === true && a.kind === "sub" && a.plan === "monthly" && a.since === "2026-09-17T12:51:28.633Z",
  JSON.stringify(a)
);

// (b) sub 연간
mockPremiumRows = {
  "user-b": {
    kind: "sub",
    note: "rc:RENEWAL:artlink_premium_yearly:2026-09-17T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    active: true,
  },
};
const b = await getPremiumInfo("user-b");
check(
  "(b) sub 연간 → plan:yearly",
  b.active === true && b.kind === "sub" && b.plan === "yearly",
  JSON.stringify(b)
);

// (c) comp (수동 무료지급)
mockPremiumRows = {
  "user-c": {
    kind: "comp",
    note: "베타 테스터 평생무료",
    created_at: "2026-05-01T00:00:00.000Z",
    active: true,
  },
};
const c = await getPremiumInfo("user-c");
check(
  "(c) comp → kind:comp, plan:null",
  c.active === true && c.kind === "comp" && c.plan === null,
  JSON.stringify(c)
);

// (d) 미등재
mockPremiumRows = {};
const d = await getPremiumInfo("user-d");
check(
  "(d) 미등재 → active:false, kind:null, plan:null, since:null",
  d.active === false && d.kind === null && d.plan === null && d.since === null,
  JSON.stringify(d)
);

// (d-2) 해지 후 만료(EXPIRATION, product_id 없는 note) → active:false, plan은 parsing 불가로 null
mockPremiumRows = {
  "user-d2": {
    kind: "sub",
    note: "rc:EXPIRATION:2026-09-17T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    active: false,
  },
};
const d2 = await getPremiumInfo("user-d2");
check(
  "(d-2) 만료(EXPIRATION, product_id 없음) → active:false, plan:null",
  d2.active === false && d2.kind === "sub" && d2.plan === null,
  JSON.stringify(d2)
);

// (e) 기존 checkTextQuota/checkVideoQuota 계약 불변 확인 (premium_members 없는 유저 → 비프리미엄 무료 경로)
mockPremiumRows = {};
const text = await checkTextQuota("user-e");
const video = await checkVideoQuota("user-e");
check(
  "(e) checkTextQuota 기존 키(allowed/used/max) 유지",
  "allowed" in text && "used" in text && "max" in text,
  JSON.stringify(text)
);
check(
  "(e) checkVideoQuota 기존 키(allowed/used/max) 유지",
  "allowed" in video && "used" in video && "max" in video,
  JSON.stringify(video)
);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
