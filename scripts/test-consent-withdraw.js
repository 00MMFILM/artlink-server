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
  files: [],
  failure: null,
  offsets: [],
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
    if (state.failure === "list") return json({ error: "test failure" }, 503);
    const { prefix, offset = 0, limit = 1000 } = JSON.parse(init.body);
    state.listCalls.push(prefix);
    state.offsets.push(offset);
    const children = new Map();
    for (const file of state.files.filter((f) => f.startsWith(prefix))) {
      const rest = file.slice(prefix.length);
      const name = rest.split("/")[0];
      children.set(name, { name, id: rest.includes("/") ? null : file });
    }
    return json([...children.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit));
  }
  if (method === "DELETE" && u.includes("/storage/v1/object/media-archive")) {
    state.storageDeletes.push(JSON.parse(init.body).prefixes);
    if (state.failure === "storage") return json({ error: "test failure" }, 503);
    if (state.failure !== "remaining") state.files = state.files.filter((f) => !JSON.parse(init.body).prefixes.includes(f));
    return json([{}]);
  }
  if (method === "DELETE" && u.includes("/rest/v1/media_assets")) {
    state.rowDeletes.push(u);
    if (state.failure === "rows") return json({ error: "test failure" }, 503);
    return json([]);
  }
  throw new Error(`Unexpected request blocked: ${method} ${u}`);
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
  state.files = ["u-1/rec.mp4", "u-1/photos/a.jpg"];
  state.failure = null;
  state.offsets = [];
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
check("(a) 게스트 자료까지 삭제한다고 안내하지 않음", res.body.error === "authenticated_archive_only" && res.body.complete === false);

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
check("(b) 삭제 범위와 기존 학습 원문 제외 명시", res.body.complete && res.body.scope === "authenticated_media_archive" && res.body.excludes.includes("training_data") && res.body.excludes.includes("guest_media_archive"));

for (const failure of ["list", "storage", "rows", "remaining"]) {
  reset();
  state.failure = failure;
  res = mockRes();
  await withdraw({ method: "POST", headers: { authorization: "Bearer faketoken" } }, res);
  check(`${failure}: 실패/잔존 파일은 완료로 반환하지 않음`, res.code === 500 && res.body.ok === false && res.body.complete === false && res.body.retryable);
  if (failure !== "rows") check(`${failure}: 삭제 확인 전 메타 행 보존`, state.rowDeletes.length === 0);
}

reset();
state.files = Array.from({ length: 1002 }, (_, i) => `u-1/${String(i).padStart(4, "0")}.mp4`);
res = mockRes();
await withdraw({ method: "POST", headers: { authorization: "Bearer faketoken" } }, res);
check("1,002개 목록 전 페이지와 분할 삭제", res.code === 200 && res.body.deleted === 1002 && state.files.length === 0 && state.offsets.includes(1000) && state.storageDeletes.length === 2);

reset();
state.files = [];
res = mockRes();
await withdraw({ method: "POST", headers: { authorization: "Bearer faketoken" } }, res);
check("재시도: 원본이 이미 없어도 메타 삭제 완료", res.code === 200 && res.body.deleted === 0 && state.rowDeletes.length === 1);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
