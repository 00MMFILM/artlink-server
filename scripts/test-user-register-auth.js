// api/user-register.js 소유권 우회 회귀 테스트 (외부 네트워크·실 Supabase 없음).
// 실행: node scripts/test-user-register-auth.js
// 취지: 예전에는 body의 authUserId만 믿고 profileToken을 발급해서, 피해자 uuid만 알면
//       남의 계정 소유권 토큰을 받아낼 수 있었다. 이제 신뢰 원천은 Bearer 토큰이다.
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";
process.env.PROFILE_SECRET = "test-profile-secret";
process.env.APP_SECRET = ""; // 앱 토큰 게이트는 이 테스트 범위 밖

const USERS = [
  { id: "u-victim", auth_user_id: "auth-victim", device_id: "dev-victim" },
  { id: "u-attacker", auth_user_id: null, device_id: "dev-attacker" },
];
let bearerUser = null; // getUser가 돌려줄 유저 (null이면 401)
let calls = [];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = init.method || "GET";
  calls.push(`${method} ${u}`);

  if (u.includes("/auth/v1/user")) {
    if (!bearerUser) return json({ message: "invalid JWT" }, 401);
    return json({ id: bearerUser, aud: "authenticated" });
  }
  if (u.includes("/rest/v1/users")) {
    if (method === "POST") return json({ id: "u-new" }); // insert().select().single()
    const m = u.match(/auth_user_id=eq\.([^&]+)/);
    const d = u.match(/device_id=eq\.([^&]+)/);
    if (m) return json(USERS.filter((r) => r.auth_user_id === decodeURIComponent(m[1])).map((r) => ({ id: r.id })));
    if (d) return json(USERS.filter((r) => r.device_id === decodeURIComponent(d[1])).map((r) => ({ id: r.id })));
    return json([]);
  }
  return json([]);
};

const { default: handler } = await import("../api/user-register.js");
const { makeProfileToken } = await import("../api/_profileLib.js");

function mockRes() {
  const r = { code: null, body: null };
  r.setHeader = () => {};
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

async function call({ token, body }) {
  bearerUser = token || null;
  calls = [];
  const res = mockRes();
  const headers = {};
  if (token) headers.authorization = `Bearer fake.${token}`;
  await handler({ method: "POST", headers, body }, res);
  return res;
}

let failed = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

// (a) 공격: Bearer 없이 피해자 authUserId로 토큰 요청
let res = await call({ body: { deviceId: "dev-attacker", authUserId: "auth-victim" } });
check("(a) 피해자 userId가 반환되지 않음", res.body.userId !== "u-victim", JSON.stringify(res.body));
check("(a) 피해자 profileToken이 발급되지 않음", res.body.profileToken !== makeProfileToken("u-victim"));
check("(a) 자기 기기 유저로만 응답", res.body.userId === "u-attacker");
check("(a) auth_user_id 조회 자체를 하지 않음", !calls.some((c) => c.includes("auth_user_id=eq.")), calls.join(" | "));

// (b) 정상: 유효 토큰 + 본인 authUserId
res = await call({ token: "auth-victim", body: { deviceId: "dev-victim", authUserId: "auth-victim" } });
check("(b) 본인 계정으로 통과", res.code === 200 && res.body.userId === "u-victim", JSON.stringify(res.body));
check("(b) 올바른 profileToken 발급", res.body.profileToken === makeProfileToken("u-victim"));

// (c) 토큰과 body authUserId 불일치
res = await call({ token: "auth-attacker", body: { deviceId: "dev-attacker", authUserId: "auth-victim" } });
check("(c) 불일치 시 401", res.code === 401, JSON.stringify(res.body));

// (d) 익명 신규 등록(하위호환): 토큰도 authUserId도 없음
res = await call({ body: { deviceId: "dev-new" } });
check("(d) 신규 익명 등록은 종전대로 200", res.code === 200 && res.body.userId === "u-new", JSON.stringify(res.body));

// (e) 토큰 없는 로그인 유저(콜드스타트 등): authUserId 무시하고 device 경로
res = await call({ body: { deviceId: "dev-new", authUserId: "auth-victim" } });
check("(e) 토큰 없으면 auth 연결 없이 device 등록", res.code === 200 && res.body.userId === "u-new", JSON.stringify(res.body));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
