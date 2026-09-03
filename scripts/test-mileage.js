// 연습 마일리지·레벨 회귀 테스트 (외부 네트워크·실 Supabase 없음 — mock 객체/클라이언트)
// 실행: node scripts/test-mileage.js
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.APP_SECRET = "";
process.env.PROFILE_SECRET = "test-profile-secret";

import {
  computeMileageFromNotes,
  levelForMileage,
  thresholdForLevel,
  nonDecreasingMileage,
  serverMileageFor,
} from "../api/_mileage.js";
// profile-sync.js는 import 시점에 _profileLib.js가 supabase 클라이언트를 생성한다.
// 정적 import는 호이스팅되어 위 process.env 설정보다 먼저 평가되므로 동적 import로 늦춘다.
const { upsertProfileRow, isMissingColumnError, resolveMileage } = await import("../api/profile-sync.js");

let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { console.log(`PASS  ${name}`, extra); pass++; }
  else { console.log(`FAIL  ${name}`, extra); fail++; }
}

// ── 1) 검증 오라클 8건: mileage → level
const oracle = [
  [1333, 6], [1406, 7], [1487, 7], [1140, 6],
  [971, 5], [536, 4], [45, 1], [0, 1],
];
for (const [xp, expected] of oracle) {
  const got = levelForMileage(xp);
  ok(`오라클 mileage ${xp} → Lv${expected}`, got === expected, `got=Lv${got}`);
}

// 임계값 자체도 확인 (threshold(L) = 50*L*(L+1)/2)
const thresholds = { 1: 50, 2: 150, 3: 300, 4: 500, 5: 750, 6: 1050, 7: 1400, 10: 2750 };
for (const [L, expected] of Object.entries(thresholds)) {
  const got = thresholdForLevel(Number(L));
  ok(`threshold(${L}) = ${expected}`, got === expected, `got=${got}`);
}

// ── 2) 엄성욱 재현: 노트33·AI30·기록26일·미디어2·글자345 → mileage 1333, Lv6
const TOTAL_CHARS = 345;
const N = 33;
const base = Math.floor(TOTAL_CHARS / N);
const remainder = TOTAL_CHARS - base * N;
const eom = Array.from({ length: N }, (_, i) => {
  const len = base + (i < remainder ? 1 : 0);
  return {
    content: "x".repeat(len),
    transcript: null,
    ai_comment: i < 30 ? "AI 피드백" : null,
    video_analysis: i < 2 ? "영상 분석" : null,
    created_at: new Date(2026, 7, 1 + (i % 26)).toISOString(),
  };
});
const eomResult = computeMileageFromNotes(eom);
ok("엄성욱 재현 mileage=1333", eomResult.mileage === 1333, `mileage=${eomResult.mileage}`);
ok("엄성욱 재현 level=Lv6", eomResult.level === 6, `level=Lv${eomResult.level}`);

// ── 3) 감소 불가: 기존 1333 상태에서 신규 계산 1000이면 1333 유지
const resolved = nonDecreasingMileage(1333, { mileage: 1000, level: levelForMileage(1000) });
ok("감소 불가: 1333 유지(신규 1000 무시)", resolved.mileage === 1333 && resolved.level === 6, `mileage=${resolved.mileage} level=Lv${resolved.level}`);
// 반대 방향(신규가 더 큼)은 정상 반영돼야 함
const grown = nonDecreasingMileage(1000, { mileage: 1333, level: levelForMileage(1333) });
ok("신규값이 더 크면 상향 반영", grown.mileage === 1333 && grown.level === 6, `mileage=${grown.mileage}`);

// ── 4) 노트 없으면(또는 auth 미연결) null → 프로필 동기화를 막지 않는다
const mockNoAuth = {
  from() {
    return {
      select() { return this; },
      eq() { return this; },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    };
  },
};
ok("auth 연결 없으면 null", (await serverMileageFor(mockNoAuth, "user-x")) === null);

const mockEmptyNotes = {
  from() {
    return {
      select() { return this; },
      eq() { return this; },
      limit: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve({ data: { auth_user_id: "auth-1" }, error: null }),
    };
  },
};
ok("노트 0개면 null", (await serverMileageFor(mockEmptyNotes, "user-y")) === null);

const mockDbDown = {
  from() {
    return {
      select() { return this; },
      eq() { return this; },
      maybeSingle: () => { throw new Error("db down"); },
    };
  },
};
ok("DB 장애 시 null(동기화 차단 안 함)", (await serverMileageFor(mockDbDown, "user-z")) === null);

// ── 5) mileage/level 컬럼 부재(upsert 42703 에러) 시 폴백 동작
{
  const upsertCalls = [];
  const mockClient = {
    from() {
      return {
        upsert(row) {
          upsertCalls.push(row);
          if (upsertCalls.length === 1) {
            return Promise.resolve({
              error: { code: "42703", message: 'column "mileage" of relation "artist_profiles" does not exist' },
            });
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  const row = { user_id: "u1", name: "테스트", mileage: 1333, level: 6 };
  const mileagePatch = { mileage: 1333, level: 6 };
  const result = await upsertProfileRow(mockClient, row, mileagePatch);
  ok("컬럼 부재 시 폴백 성공(mileageSkipped)", result.ok === true && result.mileageSkipped === true, JSON.stringify(result));
  ok("1차 시도엔 mileage/level 포함", "mileage" in upsertCalls[0] && "level" in upsertCalls[0]);
  ok("재시도엔 mileage/level 제외", !("mileage" in upsertCalls[1]) && !("level" in upsertCalls[1]));
}

// 컬럼 문제가 아닌 일반 에러는 폴백하지 않고 그대로 던진다
{
  const mockClient = {
    from() {
      return { upsert: () => Promise.resolve({ error: { code: "XX000", message: "db down" } }) };
    },
  };
  let threw = false;
  try {
    await upsertProfileRow(mockClient, { user_id: "u2", mileage: 10, level: 1 }, { mileage: 10, level: 1 });
  } catch (e) {
    threw = e.message === "db down";
  }
  ok("일반 DB 에러는 폴백하지 않고 예외 전파", threw);
}

// isMissingColumnError 판별기 자체도 확인
ok("42703 코드 인식", isMissingColumnError({ code: "42703", message: "x" }));
ok('"column ... does not exist" 문구 인식', isMissingColumnError({ message: 'column "level" of relation "artist_profiles" does not exist' }));
ok("무관한 에러는 false", !isMissingColumnError({ code: "XX000", message: "db down" }));


// ── 회귀: 서버 결과(객체)+앱 값(숫자) 병합이 NaN/null을 만들면 안 된다 (2026-09-03 사고)
{
  const srv = computeMileageFromNotes([{ content: "a".repeat(300), ai_comment: "x", created_at: "2026-08-01" }]);
  const both = nonDecreasingMileage(1333, resolveMileage(srv, 100));
  ok("서버+앱 병합 → 숫자", Number.isFinite(both.mileage) && both.mileage === 1333 && both.level === 6, JSON.stringify(both));
  const appOnly = nonDecreasingMileage(536, resolveMileage(null, 600));
  ok("앱 값만 → 숫자", appOnly.mileage === 600 && appOnly.level === 4, JSON.stringify(appOnly));
  const bigger = nonDecreasingMileage(10, resolveMileage(srv, 20));
  ok("서버가 더 크면 서버 값", bigger.mileage === srv.mileage, JSON.stringify(bigger));
  ok("둘 다 없으면 null(저장값 유지)", resolveMileage(null, 0) === null);
  ok("null 저장 절대 금지", !JSON.stringify([both, appOnly, bigger]).includes("null"));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
