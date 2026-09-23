// 회원 탈퇴 엔드포인트 회귀 테스트 (외부 네트워크·실 Supabase 없음 — globalThis.fetch mock).
// 실행: node scripts/test-account-delete.js
//
// (a) 미인증(Bearer 없음) → 401, 어떤 삭제도 수행하지 않음
// (b) 인증 유저 → 본인 자료 전 단계 삭제 후 auth 계정 삭제, complete:true
// (c) 중간 단계 실패 → 500 complete:false + failed[] + retryable, auth 계정은 남김
// (d) 재시도 멱등 → 이미 지워진 단계는 0건으로 통과하고 완료
// (e) 다른 사용자 식별자가 어떤 쿼리 필터에도 들어가지 않음
// (f) auth 계정 삭제가 마지막 호출
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.APP_SECRET = "";

// 실제 Supabase auth id는 UUID다(auth-js가 형식을 검사한다) — 합성값도 UUID로 맞춘다.
const OWNER_AUTH = "11111111-1111-4111-8111-111111111111";
const OWNER_INTERNAL = "22222222-2222-4222-8222-222222222222";
const OTHER_AUTH = "33333333-3333-4333-8333-333333333333";
const OTHER_INTERNAL = "44444444-4444-4444-8444-444444444444";
// 아래 값들은 "절대 쿼리에 나타나면 안 되는" 다른 사용자의 식별자다.
const OTHER_IDS = [OTHER_AUTH, OTHER_INTERNAL];

const state = {
  authUser: null,
  calls: [], // "METHOD path?query"
  users: [],
  rows: {},
  files: [],
  failure: null, // 실패시킬 테이블/단계 이름
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// rows[table] = [{ owner: "<식별자>" }, ...] — 삭제 요청의 필터에 걸리는 소유자만 지운다.
function deleteFrom(table, u) {
  const list = state.rows[table] || [];
  const before = list.length;
  const kept = list.filter((r) => !u.search.includes(encodeURIComponent(r.owner)) && !u.search.includes(r.owner));
  state.rows[table] = kept;
  return before - kept.length;
}

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || "GET").toUpperCase();
  state.calls.push(`${method} ${u.pathname}${u.search}`);

  if (u.pathname.endsWith("/auth/v1/user")) {
    return state.authUser ? json(state.authUser) : json({ message: "invalid JWT" }, 401);
  }
  if (u.pathname.includes("/auth/v1/admin/users/")) {
    if (state.failure === "auth_user") return json({ message: "test failure" }, 503);
    return json({});
  }
  if (u.pathname.includes("/storage/v1/object/list/media-archive")) {
    const { prefix } = JSON.parse(init.body);
    const children = new Map();
    for (const f of state.files.filter((f) => f.startsWith(prefix))) {
      const rest = f.slice(prefix.length);
      const name = rest.split("/")[0];
      children.set(name, { name, id: rest.includes("/") ? null : f });
    }
    return json([...children.values()]);
  }
  if (method === "DELETE" && u.pathname.includes("/storage/v1/object/media-archive")) {
    if (state.failure === "media_archive") return json({ error: "test failure" }, 503);
    const prefixes = JSON.parse(init.body).prefixes;
    state.files = state.files.filter((f) => !prefixes.includes(f));
    return json([{}]);
  }

  const table = u.pathname.replace("/mock/rest/v1/", "");
  if (u.pathname.includes("/rest/v1/")) {
    if (state.failure === table) return json({ message: "test failure" }, 503);
    if (method === "GET" && table === "users") {
      const owned = state.users.filter((r) => u.search.includes(r.auth_user_id));
      return json(owned.map((r) => ({ id: r.id })));
    }
    if (method === "DELETE") {
      const n = table === "media_assets" ? 0 : deleteFrom(table, u);
      return json(Array.from({ length: n }, () => ({})));
    }
    if (method === "PATCH") {
      const n = deleteFrom(table, u); // 연결 해제도 "소유자 필터로 건드린 행 수"로 센다
      return json(Array.from({ length: n }, () => ({})));
    }
  }
  throw new Error(`Unexpected request blocked: ${method} ${u.pathname}`);
};

const { default: accountDelete } = await import("../api/account-delete.js");

function mockRes() {
  const r = { code: null, body: null };
  r.setHeader = () => {};
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

// 본인 자료 + 다른 사용자 자료를 섞어 둔다. 다른 사용자 행은 절대 줄면 안 된다.
function reset() {
  state.calls = [];
  state.failure = null;
  state.users = [
    { id: OWNER_INTERNAL, auth_user_id: OWNER_AUTH },
    { id: OTHER_INTERNAL, auth_user_id: OTHER_AUTH },
  ];
  state.files = [`${OWNER_AUTH}/rec.mp4`, `${OWNER_AUTH}/photos/a.jpg`, `${OTHER_AUTH}/rec.mp4`];
  state.rows = {
    user_notes: [{ owner: OWNER_AUTH }, { owner: OWNER_AUTH }, { owner: OTHER_AUTH }],
    artist_profiles: [{ owner: OWNER_INTERNAL }, { owner: OTHER_INTERNAL }],
    growth_vectors: [{ owner: OWNER_INTERNAL }, { owner: OTHER_INTERNAL }],
    feedback_ratings: [{ owner: OWNER_AUTH }, { owner: OTHER_AUTH }],
    practice_events: [{ owner: OWNER_AUTH }, { owner: OTHER_AUTH }],
    ai_usage_daily: [{ owner: OWNER_AUTH }, { owner: OTHER_AUTH }],
    ai_video_usage: [{ owner: OWNER_AUTH }],
    premium_members: [{ owner: OWNER_AUTH }, { owner: OTHER_AUTH }],
    users: [{ owner: OWNER_INTERNAL }, { owner: OTHER_INTERNAL }],
  };
}

let failed = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

const run = async (headers = { authorization: "Bearer faketoken" }) => {
  const res = mockRes();
  await accountDelete({ method: "POST", headers, body: {} }, res);
  return res;
};

// ── (a) 미인증 ───────────────────────────────────────────────────────────
reset();
state.authUser = null;
let res = await run({});
check("(a) 미인증 401", res.code === 401, `code=${res.code}`);
check("(a) ok/complete false + 사유", res.body?.ok === false && res.body?.complete === false && res.body?.error === "authenticated_account_only");
check("(a) 어떤 삭제도 수행하지 않음", !state.calls.some((c) => c.startsWith("DELETE") || c.startsWith("PATCH")), state.calls.join(" | "));

// 게스트(앱 토큰만 있고 Bearer 없음)도 같은 401 경로
reset();
res = await run({ "x-device-id": "dev-guest" });
check("(a) 게스트도 401", res.code === 401 && state.rows.user_notes.length === 3);

// ── (b) 전체 성공 ────────────────────────────────────────────────────────
reset();
state.authUser = { id: OWNER_AUTH, aud: "authenticated" };
res = await run();
check("(b) 200 ok:true complete:true", res.code === 200 && res.body?.ok === true && res.body?.complete === true, JSON.stringify(res.body));
check("(b) 노트 2건 삭제", res.body?.deleted?.user_notes === 2, JSON.stringify(res.body?.deleted));
check("(b) 프로필·성장벡터·평가 각 1건", res.body.deleted.artist_profiles === 1 && res.body.deleted.growth_vectors === 1 && res.body.deleted.feedback_ratings === 1);
check("(b) 사용량·구독 권한 삭제", res.body.deleted.ai_usage_daily === 1 && res.body.deleted.ai_video_usage === 1 && res.body.deleted.premium_members === 1);
check("(b) premium_members 호출에 본인 필터", state.calls.some((c) => c.startsWith("DELETE /mock/rest/v1/premium_members") && c.includes(`user_id=eq.${OWNER_AUTH}`)));
check("(b) 기기 등록 행 삭제", res.body.deleted.users === 1);
check("(b) 연습 이벤트는 삭제 아닌 연결 해제", state.calls.some((c) => c.startsWith("PATCH /mock/rest/v1/practice_events")) && res.body.deleted.practice_events_unlinked === 1);
check("(b) media-archive 원본 2건 삭제", res.body.deleted.media_archive === 2 && state.files.length === 1);
check("(b) auth 계정 삭제", res.body.deleted.auth_user === 1);
check("(b) 삭제 불가 범위 명시", Array.isArray(res.body.excludes) && res.body.excludes.includes("training_data") && res.body.excludes.includes("guest_media_archive") && res.body.excludes.includes("reports"));

// (f) auth 계정 삭제가 마지막
const lastCall = state.calls[state.calls.length - 1];
check("(f) auth 계정 삭제가 마지막 호출", lastCall.startsWith(`DELETE /mock/auth/v1/admin/users/${OWNER_AUTH}`), lastCall);
const authIdx = state.calls.findIndex((c) => c.includes("/auth/v1/admin/users/"));
const dataCalls = state.calls.filter((c, i) => i > authIdx && (c.startsWith("DELETE /mock/rest") || c.startsWith("PATCH /mock/rest")));
check("(f) auth 삭제 뒤 자료 쿼리 없음", dataCalls.length === 0, dataCalls.join(" | "));

// (e) 다른 사용자 자료·식별자 불가침
check("(e) 다른 사용자 행은 전부 보존", Object.entries(state.rows).every(([, list]) => list.length === (list[0] ? 1 : 0)) && state.rows.user_notes.length === 1 && state.rows.users.length === 1, JSON.stringify(state.rows));
check("(e) 다른 사용자 원본 파일 보존", state.files.includes(`${OTHER_AUTH}/rec.mp4`));
const leaked = state.calls.filter((c) => OTHER_IDS.some((id) => c.includes(id)));
check("(e) 어떤 쿼리에도 다른 사용자 id 미포함", leaked.length === 0, leaked.join(" | "));
const mutations = state.calls.filter((c) => c.startsWith("DELETE /mock/rest") || c.startsWith("PATCH /mock/rest"));
const unfiltered = mutations.filter((c) => !c.includes(OWNER_AUTH) && !c.includes(OWNER_INTERNAL));
check("(e) 모든 쓰기 쿼리에 본인 식별자 필터", unfiltered.length === 0, unfiltered.join(" | "));
check("(e) 본문 userId가 아닌 토큰 식별자로만 동작", (await (async () => {
  reset();
  const r = mockRes();
  await accountDelete({ method: "POST", headers: { authorization: "Bearer faketoken" }, body: { userId: OTHER_INTERNAL, authUserId: OTHER_AUTH } }, r);
  return state.rows.users.length === 1 && state.rows.users[0].owner === OTHER_INTERNAL && !state.calls.some((c) => OTHER_IDS.some((id) => c.includes(id)));
})()));

// ── (c) 중간 단계 실패 ───────────────────────────────────────────────────
for (const [failure, stepName] of [["user_notes", "user_notes"], ["ai_usage_daily", "ai_usage_daily"], ["media_archive", "media_archive"], ["premium_members", "premium_members"]]) {
  reset();
  state.failure = failure;
  res = await run();
  check(`(c) ${failure} 실패 → 500 complete:false`, res.code === 500 && res.body.ok === false && res.body.complete === false && res.body.retryable === true && res.body.error === "account_delete_failed", JSON.stringify(res.body));
  check(`(c) ${failure} 실패 단계 보고`, Array.isArray(res.body.failed) && res.body.failed.includes(stepName), JSON.stringify(res.body.failed));
  check(`(c) ${failure} 실패 시 auth 계정 보존`, !state.calls.some((c) => c.includes("/auth/v1/admin/users/")));
}

// auth 삭제 자체가 실패해도 완료로 보고하지 않는다
reset();
state.failure = "auth_user";
res = await run();
check("(c) auth 삭제 실패도 complete:false", res.code === 500 && res.body.complete === false && res.body.failed.includes("auth_user") && res.body.retryable === true);

// ── (d) 재시도 멱등 ──────────────────────────────────────────────────────
reset();
state.failure = "premium_members";
res = await run();
check("(d) 1차: 부분 실패", res.code === 500 && res.body.deleted.user_notes === 2);
state.failure = null;
const before = JSON.parse(JSON.stringify(state.rows));
res = await run();
check("(d) 재시도 성공 complete:true", res.code === 200 && res.body.complete === true, JSON.stringify(res.body));
check("(d) 이미 지운 단계는 0건", res.body.deleted.user_notes === 0 && res.body.deleted.artist_profiles === 0 && res.body.deleted.media_archive === 0);
check("(d) 남은 단계만 마무리", before.premium_members.length === 2 && state.rows.premium_members.length === 1 && res.body.deleted.premium_members === 1);
check("(d) 재시도에서도 다른 사용자 보존", state.rows.premium_members[0].owner === OTHER_AUTH && state.rows.users.length === 1 && state.rows.users[0].owner === OTHER_INTERNAL);
check("(d) 재시도에서 auth 계정 삭제", res.body.deleted.auth_user === 1);

// users 행은 auth uuid ↔ 내부 id를 잇는 유일한 연결이다. 앞 단계가 실패하면 남겨야
// 재시도에서 내부 id 기반 자료(프로필·성장벡터)를 다시 찾아 지울 수 있다.
reset();
state.failure = "artist_profiles";
res = await run();
check("(d) 앞 단계 실패 시 users 행 보존", res.code === 500 && state.rows.users.some((r) => r.owner === OWNER_INTERNAL) && res.body.deleted.users === undefined, JSON.stringify(res.body.deleted));
state.failure = null;
res = await run();
check("(d) 재시도에서 내부 id 자료까지 정리", res.code === 200 && res.body.deleted.artist_profiles === 1 && res.body.deleted.users === 1, JSON.stringify(res.body.deleted));
check("(d) 다른 사용자 프로필 보존", state.rows.artist_profiles.length === 1 && state.rows.artist_profiles[0].owner === OTHER_INTERNAL);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
