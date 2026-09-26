// premium-resync 회귀 테스트 (외부 네트워크·실 Supabase 없음 — fetch 전량 모킹)
// 실행: node scripts/test-premium-resync.js
// 시나리오:
// (a) REVENUECAT_SECRET_KEY 미설정 → 501 not_configured
// (b) RevenueCat 500 → 502 revenuecat_unavailable
// (c) entitlement 없음 → 200 {ok:true, active:false}, premium_members 쓰기 없음
// (d) entitlement 만료 → 200 {ok:true, active:false}
// (e) entitlement 활성 → 200 {ok:true, active:true} + premium_members upsert(kind:"sub", active:true)
// (f) 인증 없음(Authorization 헤더 없음) → 401
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";
process.env.APP_SECRET = "";           // 앱 토큰 검사 우회(비상 스위치 경로)
process.env.REVENUECAT_SECRET_KEY = ""; // (a)에서 먼저 미설정 상태를 검사

let rcResponse = null;     // RevenueCat REST가 돌려줄 { status, body }
let rcCalls = [];          // 호출된 RevenueCat URL
let upserts = [];          // premium_members로 나간 본문
let authUser = { id: "user-1" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://api.revenuecat.com/")) {
    rcCalls.push(u);
    return json(rcResponse.body, rcResponse.status);
  }
  // Supabase auth: getUser(token)
  if (u.includes("/auth/v1/user")) {
    return authUser ? json(authUser) : json({ message: "bad token" }, 401);
  }
  if (u.includes("/premium_members")) {
    if ((init.method || "GET") !== "GET") upserts.push(JSON.parse(init.body));
    return json([]);
  }
  return json([]);
};

const { default: handler } = await import("../api/premium-resync.js");

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    setHeader() { return res; },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
    end() { return res; },
  };
  return res;
}

async function call({ auth = true } = {}) {
  upserts = [];
  rcCalls = [];
  const req = {
    method: "POST",
    headers: auth ? { authorization: "Bearer token-1" } : {},
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}

let failed = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

// (f) 인증 없음
const f = await call({ auth: false });
check("(f) Authorization 없으면 401", f.statusCode === 401, JSON.stringify(f.body));

// (a) 키 미설정
const a = await call();
check(
  "(a) REVENUECAT_SECRET_KEY 없으면 501 not_configured",
  a.statusCode === 501 && a.body.ok === false && a.body.reason === "not_configured",
  JSON.stringify(a.body)
);
check("(a) 키가 없으면 RevenueCat을 부르지 않는다", rcCalls.length === 0);

process.env.REVENUECAT_SECRET_KEY = "rc-secret-for-test";

// (b) RevenueCat 장애
rcResponse = { status: 500, body: { message: "boom" } };
const b = await call();
check(
  "(b) RevenueCat 실패는 502",
  b.statusCode === 502 && b.body.ok === false && b.body.reason === "revenuecat_unavailable",
  JSON.stringify(b.body)
);
check("(b) 실패하면 premium_members를 쓰지 않는다", upserts.length === 0);

// (c) entitlement 없음
rcResponse = { status: 200, body: { subscriber: { entitlements: {} } } };
const c = await call();
check(
  "(c) entitlement 없으면 active:false",
  c.statusCode === 200 && c.body.ok === true && c.body.active === false,
  JSON.stringify(c.body)
);
check("(c) 비활성이면 premium_members를 쓰지 않는다", upserts.length === 0);

// (d) 만료된 entitlement
rcResponse = {
  status: 200,
  body: {
    subscriber: {
      entitlements: {
        premium: { expires_date: "2020-01-01T00:00:00Z", product_identifier: "artlink_premium_monthly" },
      },
      subscriptions: { artlink_premium_monthly: { is_sandbox: false, expires_date: "2020-01-01T00:00:00Z" } },
    },
  },
};
const d = await call();
check(
  "(d) 만료된 entitlement는 active:false",
  d.statusCode === 200 && d.body.active === false,
  JSON.stringify(d.body)
);
check("(d) 만료면 premium_members를 쓰지 않는다", upserts.length === 0);

// (e) 활성 entitlement
rcResponse = {
  status: 200,
  body: {
    subscriber: {
      entitlements: {
        premium: { expires_date: "2099-01-01T00:00:00Z", product_identifier: "artlink_premium_yearly" },
      },
      subscriptions: { artlink_premium_yearly: { is_sandbox: false, expires_date: "2099-01-01T00:00:00Z" } },
    },
  },
};
const e = await call();
check(
  "(e) 활성 entitlement면 active:true",
  e.statusCode === 200 && e.body.ok === true && e.body.active === true,
  JSON.stringify(e.body)
);
check(
  "(e) premium_members에 kind:sub, active:true로 upsert",
  upserts.length === 1 && upserts[0].user_id === "user-1" && upserts[0].kind === "sub" && upserts[0].active === true,
  JSON.stringify(upserts)
);
check("(e) RevenueCat은 auth user id로 조회한다", rcCalls[0]?.endsWith("/v1/subscribers/user-1"), rcCalls[0]);

// (e-2) 명시적으로 expires_date:null인 운영 비소멸성 구매도 활성으로 본다
rcResponse = {
  status: 200,
  body: { subscriber: {
    entitlements: { premium: { product_identifier: "artlink_premium_lifetime", expires_date: null } },
    non_subscriptions: { artlink_premium_lifetime: [{ is_sandbox: false }] },
  } },
};
const e2 = await call();
check("(e-2) expires_date:null 운영 구매면 활성", e2.statusCode === 200 && e2.body.active === true, JSON.stringify(e2.body));

// (g) sandbox 구매 복구는 운영 장부에 실결제로 등록하지 않는다.
rcResponse = { status: 200, body: { subscriber: {
  entitlements: { premium: { product_identifier: "monthly", expires_date: "2099-01-01T00:00:00Z" } },
  subscriptions: { monthly: { is_sandbox: true, expires_date: "2099-01-01T00:00:00Z" } },
} } };
const g = await call();
check("(g) sandbox 복구로 운영 sub를 만들지 않음", g.statusCode === 200 && g.body.active === false && upserts.length === 0, JSON.stringify(g.body));

// (h) 유예 기간에는 구독을 복구한다.
rcResponse.body.subscriber.entitlements.premium.grace_period_expires_date = "2099-01-01T00:00:00Z";
rcResponse.body.subscriber.entitlements.premium.expires_date = "2020-01-01T00:00:00Z";
rcResponse.body.subscriber.subscriptions.monthly = { is_sandbox: false, expires_date: "2020-01-01T00:00:00Z", grace_period_expires_date: "2099-01-01T00:00:00Z" };
const h = await call();
check("(h) 운영 구독 유예 기간은 활성", h.statusCode === 200 && h.body.active === true && upserts.length === 1, JSON.stringify(h.body));

// (i) 일부 필드가 없는 응답을 평생 구매로 취급하지 않는다.
delete rcResponse.body.subscriber.subscriptions.monthly;
const i = await call();
check("(i) 환경 불명 응답이면 복구 오류, 쓰기 없음", i.statusCode === 502 && upserts.length === 0, JSON.stringify(i.body));
rcResponse = { status: 200, body: {} };
const i2 = await call();
check("(i) malformed subscriber도 비활성 성공으로 처리하지 않음", i2.statusCode === 502 && upserts.length === 0);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
