// 프로필 공개 OFF 서버 영속화 + 늦은 업로드 충돌 방지 회귀 테스트.
// 합성 데이터·mock fetch만 사용한다(외부 네트워크·실 Supabase 없음).
// 실행: node scripts/test-profile-visibility.js
//
// (a) 공개 OFF → 개인정보 컬럼만 비우고 묘비 행 유지(행 삭제 금지), profile_public=false 기록
// (b) 늦게 도착한 ON 요청(오래된 visibilityUpdatedAt)은 무시 → ignored:"stale_visibility"
// (c) 공개 정보 없이 오는 구버전 동기화·사진 업로드도 비공개를 되살리지 못함
// (d) 최신 ON 요청은 정상 반영
// (e) artist-browse는 비공개 행 제외
// (f) 컬럼이 없는 구버전 DB에서도 죽지 않고 기존 동작으로 폴백
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.APP_SECRET = "";
process.env.PROFILE_SECRET = "test-profile-secret";

const USER = "u-1";
const T1 = "2026-09-20T00:00:00.000Z";
const T2 = "2026-09-21T00:00:00.000Z";
const T3 = "2026-09-22T00:00:00.000Z";

const state = {
  calls: [],
  existing: null, // artist_profiles 기존 행
  upserts: [],
  patches: [],
  browseRows: [],
  visibilityColumns: true, // false면 profile_public/visibility_updated_at 컬럼이 없는 구 DB
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const missingColumn = (col) =>
  json({ code: "42703", message: `column artist_profiles.${col} does not exist` }, 400);

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || "GET").toUpperCase();
  const table = u.pathname.split("/rest/v1/")[1] || u.pathname;
  const select = u.searchParams.get("select") || "";
  state.calls.push(`${method} ${table}${u.search}`);

  if (table === "users") {
    // artist-browse의 "가입 계정만" 필터 / _score.js의 내부 id → auth uuid 조회
    if (select.includes("auth_user_id")) return json({ auth_user_id: "auth-1" });
    return json(state.browseRows.map((r) => ({ id: r.user_id })));
  }
  if (table === "user_notes") return json([]);

  if (table === "artist_profiles") {
    if (method === "GET") {
      if (!state.visibilityColumns && select.includes("profile_public")) return missingColumn("profile_public");
      if (u.searchParams.has("user_id")) {
        // maybeSingle — 없으면 null
        return json(state.existing ? projected(state.existing, select) : null);
      }
      // 브라우징
      if (!state.visibilityColumns && u.searchParams.has("profile_public")) return missingColumn("profile_public");
      const excludePrivate = u.searchParams.get("profile_public") === "neq.false";
      return json(state.browseRows.filter((r) => !(excludePrivate && r.profile_public === false)));
    }
    if (method === "POST") {
      const row = JSON.parse(init.body);
      const payload = Array.isArray(row) ? row[0] : row;
      if (!state.visibilityColumns && "profile_public" in payload) return missingColumn("profile_public");
      state.upserts.push(payload);
      state.existing = { ...(state.existing || {}), ...payload };
      return json([]);
    }
    if (method === "PATCH") {
      state.patches.push(JSON.parse(init.body));
      return json([]);
    }
  }
  throw new Error(`Unexpected request blocked: ${method} ${u.pathname}`);
};

function projected(row, select) {
  const cols = select.split(",").map((c) => c.trim()).filter(Boolean);
  const out = {};
  for (const c of cols) if (c in row) out[c] = row[c];
  return out;
}

const { makeProfileToken } = await import("../api/_profileLib.js");
const { default: sync } = await import("../api/profile-sync.js");
const { default: browse } = await import("../api/artist-browse.js");

function mockRes() {
  const r = { code: null, body: null };
  r.setHeader = () => {};
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

const FULL_PROFILE = {
  name: "테스터",
  email: "tester@example.invalid",
  height: 177,
  weight: 65,
  school: "한국예술종합학교",
  location: "서울",
  agency: "무소속",
  bio: "배우 지망생입니다",
  career: ["단편영화 주연"],
  specialties: ["연기"],
  photoUrl: "https://example.invalid/a.jpg",
  photos: ["https://example.invalid/a.jpg"],
  notesCount: 12,
  streakDays: 4,
};

async function runSync(profile) {
  const res = mockRes();
  await sync(
    { method: "POST", headers: {}, body: { userId: USER, profileToken: makeProfileToken(USER), profile } },
    res
  );
  return res;
}

async function runBrowse(body = {}) {
  const res = mockRes();
  await browse({ method: "POST", headers: {}, body }, res);
  return res;
}

let failed = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

function reset(existing = null, { visibilityColumns = true } = {}) {
  state.calls = [];
  state.upserts = [];
  state.patches = [];
  state.existing = existing;
  state.visibilityColumns = visibilityColumns;
}

// ── (a) 공개 OFF → 묘비 행 ───────────────────────────────────────────────
reset({ user_id: USER, score: 71, mileage: 1333, level: 6, ...FULL_PROFILE, profile_public: true });
let res = await runSync({ ...FULL_PROFILE, profilePublic: false, visibilityUpdatedAt: T2 });
const tomb = state.upserts[0] || {};
check("(a) 200 ok", res.code === 200 && res.body.profilePublic === false, JSON.stringify(res.body));
check("(a) profile_public=false 기록", tomb.profile_public === false);
check("(a) visibility_updated_at 기록", tomb.visibility_updated_at === T2, tomb.visibility_updated_at);
check(
  "(a) 개인정보 컬럼 비움",
  tomb.name === "익명" && tomb.email === null && tomb.height === null && tomb.weight === null &&
    tomb.school === null && tomb.location === null && tomb.agency === null && tomb.bio === null &&
    tomb.photo_url === null && tomb.photos.length === 0 && tomb.career.length === 0 &&
    tomb.specialties.length === 0 && tomb.notes_count === 0 && tomb.streak_days === 0,
  JSON.stringify(tomb)
);
check("(a) 묘비 행 유지(행 삭제 안 함)", tomb.user_id === USER && !state.calls.some((c) => c.startsWith("DELETE")), state.calls.join(" | "));
check("(a) 점수·마일리지는 건드리지 않음", !("score" in tomb) && !("mileage" in tomb) && !("level" in tomb), JSON.stringify(Object.keys(tomb)));

// ── (b) 늦게 도착한 ON 요청 무시 ─────────────────────────────────────────
const PRIVATE_ROW = { user_id: USER, score: 71, mileage: 1333, profile_public: false, visibility_updated_at: T2 };
reset({ ...PRIVATE_ROW });
res = await runSync({ ...FULL_PROFILE, profilePublic: true, visibilityUpdatedAt: T1 });
check("(b) 오래된 ON 요청 무시", res.code === 200 && res.body.ignored === "stale_visibility", JSON.stringify(res.body));
check("(b) 무시 시 쓰기 없음", state.upserts.length === 0 && state.patches.length === 0);

reset({ ...PRIVATE_ROW });
// 비공개 행에는 같은 시각 재전송도 무시한다(되살리기 방지).
res = await runSync({ ...FULL_PROFILE, profilePublic: true, visibilityUpdatedAt: T2 });
check("(b) 비공개 행은 같은 시각 재전송도 무시", res.body.ignored === "stale_visibility" && state.upserts.length === 0, JSON.stringify(res.body));

// 늦은 OFF 요청도 최신 ON 상태를 뒤집지 못한다(단조 증가는 양방향)
reset({ user_id: USER, profile_public: true, visibility_updated_at: T3 });
res = await runSync({ ...FULL_PROFILE, profilePublic: false, visibilityUpdatedAt: T1 });
check("(b) 오래된 OFF 요청도 무시", res.body.ignored === "stale_visibility" && state.upserts.length === 0);

// ── (c) 공개 정보 없는 요청이 비공개를 되살리지 못함 ─────────────────────
reset({ ...PRIVATE_ROW });
res = await runSync({ ...FULL_PROFILE });
check("(c) 구버전 전체 동기화 무시", res.body.ignored === "stale_visibility" && state.upserts.length === 0, JSON.stringify(res.body));

reset({ ...PRIVATE_ROW });
res = await runSync({ _photosOnly: true, photos: ["https://example.invalid/b.jpg"], photoUrl: "https://example.invalid/b.jpg" });
check("(c) 사진만 업로드도 무시", res.body.ignored === "stale_visibility" && state.patches.length === 0, JSON.stringify(res.body));

// 공개 상태라면 사진만 업로드는 종전대로 동작한다
reset({ user_id: USER, profile_public: true, visibility_updated_at: T2 });
res = await runSync({ _photosOnly: true, photos: ["https://example.invalid/b.jpg"], photoUrl: "https://example.invalid/b.jpg" });
check("(c) 공개 상태의 사진 업로드는 정상", res.code === 200 && res.body.ok === true && state.patches.length === 1, JSON.stringify(res.body));

// ── (d) 최신 ON 요청 반영 ────────────────────────────────────────────────
reset({ ...PRIVATE_ROW });
res = await runSync({ ...FULL_PROFILE, profilePublic: true, visibilityUpdatedAt: T3 });
const on = state.upserts[0] || {};
check("(d) 최신 ON 반영", res.code === 200 && res.body.profilePublic === true && res.body.visibilityUpdatedAt === T3, JSON.stringify(res.body));
check("(d) profile_public=true + 시각 갱신", on.profile_public === true && on.visibility_updated_at === T3);
check("(d) 프로필 내용 복원", on.name === "테스터" && on.bio === "배우 지망생입니다" && on.school === "한국예술종합학교");
check("(d) 기존 점수 보존(감소 금지)", on.score === 71, `score=${on.score}`);

// epoch ms로 보내도 같은 판정이 되어야 한다
reset({ ...PRIVATE_ROW });
res = await runSync({ ...FULL_PROFILE, profilePublic: true, visibilityUpdatedAt: Date.parse(T1) });
check("(d) epoch ms 오래된 요청 무시", res.body.ignored === "stale_visibility");
reset({ ...PRIVATE_ROW });
res = await runSync({ ...FULL_PROFILE, profilePublic: true, visibilityUpdatedAt: Date.parse(T3) });
check("(d) epoch ms 최신 요청 반영", state.upserts[0]?.profile_public === true && state.upserts[0]?.visibility_updated_at === T3);

// 공개 정보가 없고 저장 상태도 공개면 종전 동작 그대로(공개 컬럼 미변경)
reset({ user_id: USER, score: 10, profile_public: true, visibility_updated_at: T2 });
res = await runSync({ ...FULL_PROFILE });
check("(d) 공개 상태 구버전 동기화는 종전대로", res.code === 200 && state.upserts.length === 1 && !("profile_public" in state.upserts[0]), JSON.stringify(state.upserts[0] && Object.keys(state.upserts[0])));

// 저장된 행이 아예 없을 때(신규) OFF 요청도 묘비를 만든다
reset(null);
res = await runSync({ ...FULL_PROFILE, profilePublic: false, visibilityUpdatedAt: T2 });
check("(d) 신규 사용자 OFF도 묘비 생성", state.upserts[0]?.profile_public === false && state.upserts[0]?.user_id === USER);

// ── (e) 브라우징에서 비공개 제외 ─────────────────────────────────────────
state.browseRows = [
  { user_id: "pub", name: "공개", email: "a@example.invalid", notes_count: 3, photos: [], profile_public: true },
  { user_id: "priv", name: "익명", email: null, notes_count: 0, photos: [], profile_public: false },
  { user_id: "legacy", name: "구행", email: "b@example.invalid", notes_count: 1, photos: [] },
];
reset(null);
res = await runBrowse({});
check("(e) 비공개 제외", res.code === 200 && res.body.profiles.every((r) => r.user_id !== "priv"), JSON.stringify(res.body.profiles?.map((r) => r.user_id)));
check("(e) 공개·구행은 유지", res.body.profiles.some((r) => r.user_id === "pub") && res.body.profiles.some((r) => r.user_id === "legacy"));
check("(e) 서버 쿼리에 비공개 제외 필터", state.calls.some((c) => c.includes("profile_public=neq.false")), state.calls.join(" | "));

// 비공개 행이 필터를 우회해 들어와도 브라우징 품질 필터가 묘비를 걸러낸다
reset(null);
state.browseRows = [{ user_id: "priv", name: "익명", email: null, notes_count: 0, photos: [], profile_public: false }];
res = await runBrowse({});
check("(e) 묘비 행은 결과에 없음", res.code === 200 && res.body.profiles.length === 0, JSON.stringify(res.body.profiles));

// ── (f) 컬럼 없는 구버전 DB 폴백 ─────────────────────────────────────────
state.browseRows = [
  { user_id: "pub", name: "공개", email: "a@example.invalid", notes_count: 3, photos: [] },
  { user_id: "legacy", name: "구행", email: "b@example.invalid", notes_count: 1, photos: [] },
];
reset(null, { visibilityColumns: false });
res = await runBrowse({});
check("(f) 컬럼 없어도 브라우징 성공", res.code === 200 && res.body.profiles.length === 2, JSON.stringify(res.body));
check("(f) 컬럼 부재 시 필터 없이 재조회", state.calls.filter((c) => c.startsWith("GET artist_profiles")).length === 2, state.calls.join(" | "));

reset({ user_id: USER, score: 50 }, { visibilityColumns: false });
res = await runSync({ ...FULL_PROFILE, profilePublic: false, visibilityUpdatedAt: T2 });
check("(f) 컬럼 없어도 OFF 요청이 500이 아님", res.code === 200, JSON.stringify(res.body));
check("(f) 폴백 upsert는 공개 컬럼 제외", state.upserts.length === 1 && !("profile_public" in state.upserts[0]) && state.upserts[0].bio === null, JSON.stringify(state.upserts[0]));
check("(f) 마이그레이션 필요를 응답으로 알림", res.body.visibilitySkipped === true, JSON.stringify(res.body));

reset({ user_id: USER, score: 50 }, { visibilityColumns: false });
res = await runSync({ ...FULL_PROFILE });
check("(f) 컬럼 없는 DB의 일반 동기화도 정상", res.code === 200 && state.upserts.length === 1 && state.upserts[0].name === "테스터", JSON.stringify(res.body));

// (g) 공개 여부만 보내는 부분 업데이트(_visibilityOnly)는 다른 컬럼을 건드리지 않는다
reset({ user_id: USER, name: "테스터", score: 50, profile_public: true, visibility_updated_at: T1 });
res = await runSync({ _visibilityOnly: true, profilePublic: false, visibilityUpdatedAt: T2 });
check("(g) 공개 OFF만 보내도 묘비 처리", res.code === 200 && res.body.profilePublic === false, JSON.stringify(res.body));
check("(g) OFF 묘비는 개인정보를 비움", state.upserts.length === 1 && state.upserts[0].name === "익명" && state.upserts[0].bio === null, JSON.stringify(state.upserts[0]));

reset({ user_id: USER, name: "테스터", score: 50, profile_public: false, visibility_updated_at: T2 });
res = await runSync({ _visibilityOnly: true, profilePublic: true, visibilityUpdatedAt: T3 });
check("(g) 공개 ON만 보내면 프로필 내용을 덮어쓰지 않는다", res.code === 200 && state.upserts.length === 0, JSON.stringify({ upserts: state.upserts, patches: state.patches }));
check("(g) 공개 ON만 보내면 공개 컬럼만 갱신", state.patches.length === 1 && state.patches[0].profile_public === true && !("name" in state.patches[0]), JSON.stringify(state.patches[0]));

reset({ user_id: USER, name: "테스터", profile_public: false, visibility_updated_at: T3 });
res = await runSync({ _visibilityOnly: true, profilePublic: true, visibilityUpdatedAt: T1 });
check("(g) 늦게 도착한 공개 ON은 무시", res.body.ignored === "stale_visibility" && state.upserts.length === 0 && state.patches.length === 0, JSON.stringify(res.body));

reset(null);
res = await runSync({ _visibilityOnly: true, profilePublic: true, visibilityUpdatedAt: T2 });
check("(g) 프로필이 없으면 빈 행을 만들지 않는다", res.code === 200 && res.body.ignored === "no_profile" && state.upserts.length === 0, JSON.stringify(res.body));

// (j) 1.11.8 구버전 OFF 백필: 행이 없는 계정의 OFF는 빈 묘비를 만들지 않고, 앱이 대기를 끌 수 있게 시각을 돌려준다
reset(null);
res = await runSync({ _visibilityOnly: true, profilePublic: false, visibilityUpdatedAt: T2 });
check("(j) 행 없는 OFF는 묘비 행을 만들지 않는다", res.code === 200 && res.body.ignored === "no_profile" && state.upserts.length === 0 && state.patches.length === 0, JSON.stringify(res.body));
check("(j) 응답에 OFF와 요청 시각이 실린다", res.body.profilePublic === false && res.body.visibilityUpdatedAt === T2, JSON.stringify(res.body));
reset({ user_id: USER, name: "테스터", profile_public: true, visibility_updated_at: null });
res = await runSync({ _visibilityOnly: true, profilePublic: false, visibilityUpdatedAt: T2 });
check("(j) 스탬프 없는 기존 공개 행(마이그레이션 기본값)은 OFF 백필로 묘비 처리", res.code === 200 && res.body.profilePublic === false && state.upserts.length === 1 && state.upserts[0].profile_public === false && state.upserts[0].name === "익명", JSON.stringify(state.upserts[0] || res.body));

// (i) 공개 상태에서 토글을 안 바꾼 일반 수정은 서버에 반영된다 (실서버에서 발견한 문제)
reset({ user_id: USER, profile_public: true, visibility_updated_at: T2, score: 10 });
res = await runSync({ ...FULL_PROFILE, name: "이름 바꿈", heightPrivate: true, profilePublic: true, visibilityUpdatedAt: T2 });
check("(i) 일반 수정이 저장된다", res.code === 200 && state.upserts.length === 1 && state.upserts[0].name === "이름 바꿈", JSON.stringify(res.body));
check("(i) 키 비공개 설정도 저장된다", state.upserts[0] && state.upserts[0].height_private === true, JSON.stringify(state.upserts[0] || {}));
check("(i) 비공개 행에는 같은 시각 수정도 반영하지 않는다", true);
reset({ user_id: USER, profile_public: false, visibility_updated_at: T2 });
res = await runSync({ ...FULL_PROFILE, name: "되살리기 시도", profilePublic: true, visibilityUpdatedAt: T2 });
check("(i) 비공개 상태에서는 같은 시각 요청도 무시", res.body.ignored === "stale_visibility" && state.upserts.length === 0, JSON.stringify(res.body));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
