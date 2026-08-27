// 동의 철회 엔드포인트 회귀 테스트 (외부 네트워크·실 Supabase 없음 — globalThis.fetch mock).
// 실행: node scripts/test-consent-withdraw.js
//
// (a) 무인증(Bearer 없음) → 401, storage/DB 삭제 미수행
// (b) 인증 유저 → media-archive 객체 재귀 나열 후 일괄 삭제 + media_assets 행 삭제, { ok, deleted } 반환
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.APP_SECRET = "";

const state = {
  authUser: null,
  listCalls: [],
  storageDeletes: [],
  rowDeletes: [],
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || "GET").toUpperCase();

  if (u.includes("/auth/v1/user")) {
    return state.authUser ? json(state.authUser) : json({ message: "invalid JWT" }, 401);
  }
  if (u.includes("/storage/v1/object/list/media-archive")) {
    const prefix = JSON.parse(init.body).prefix;
    state.listCalls.push(prefix);
    if (prefix === "u-1/") return json([{ name: "rec.mp4", id: "1" }, { name: "photos", id: null }]);
    if (prefix === "u-1/photos/") return json([{ name: "a.jpg", id: "2" }]);
    return json([]);
  }
  if (method === "DELETE" && u.includes("/storage/v1/object/media-archive")) {
    state.storageDeletes.push(JSON.parse(init.body).prefixes);
    return json([{}]);
  }
  if (method === "DELETE" && u.includes("/rest/v1/media_assets")) {
    state.rowDeletes.push(u);
    return json([]);
  }
  return json([]);
};

const { default: withdraw } = await import("../api/media-consent-withdraw.js");

function mockRes() {
  const r = { code: null, body: null };
  r.setHeader = () => {};
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

function reset() {
  state.listCalls = [];
  state.storageDeletes = [];
  state.rowDeletes = [];
}

let failed = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

// (a) 무인증 → 401
reset();
state.authUser = null;
let res = mockRes();
await withdraw({ method: "POST", headers: {}, body: {} }, res);
check("(a) 무인증 401", res.code === 401, `code=${res.code}`);
check("(a) 삭제 미수행", state.storageDeletes.length === 0 && state.rowDeletes.length === 0);

// (b) 인증 유저 → 나열+삭제
reset();
state.authUser = { id: "u-1", aud: "authenticated" };
res = mockRes();
await withdraw({ method: "POST", headers: { authorization: "Bearer faketoken" }, body: {} }, res);
check("(b) 응답 200 ok:true", res.code === 200 && res.body?.ok === true, JSON.stringify(res.body));
check("(b) deleted=2", res.body?.deleted === 2, `deleted=${res.body?.deleted}`);
check("(b) 재귀 나열(u-1/, u-1/photos/)", state.listCalls.includes("u-1/") && state.listCalls.includes("u-1/photos/"), state.listCalls.join(","));
check("(b) storage 일괄 삭제 1회", state.storageDeletes.length === 1, `deletes=${state.storageDeletes.length}`);
check("(b) 삭제 대상 2개(rec.mp4 + photos/a.jpg)", state.storageDeletes[0]?.length === 2 && state.storageDeletes[0].includes("u-1/rec.mp4") && state.storageDeletes[0].includes("u-1/photos/a.jpg"), (state.storageDeletes[0] || []).join(","));
check("(b) media_assets 행 삭제(user_id=eq.u-1)", state.rowDeletes.some((u) => u.includes("user_id=eq.u-1")), state.rowDeletes.join(","));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
