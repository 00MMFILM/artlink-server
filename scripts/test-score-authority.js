// 서버 점수 계산 권한 이관 검증 (외부 네트워크 없음 — supabase mock)
import { computeScoreFromNotes, serverScoreFor } from "../api/_score.js";

let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { console.log(`PASS  ${name}`, extra); pass++; }
  else { console.log(`FAIL  ${name}`, extra); fail++; }
}

// ── 1) 엄성욱 재현: 단일 분야 33개·AI 30개·26일 기록, 타이핑 짧음
const eom = Array.from({ length: 33 }, (_, i) => ({
  field: "acting",
  tags: i === 0 ? ["감정"] : [],
  content: "짧은 메모",              // ≈10자
  transcript: null,
  ai_comment: i < 30 ? "AI 피드백" : null,
  video_analysis: i < 2 ? "영상 분석" : null,
  created_at: new Date(2026, 7, 1 + (i % 26)).toISOString(),
}));
const eomScore = computeScoreFromNotes(eom);
ok("단일분야 33개 사용자가 65점 고정을 벗어난다", eomScore > 65, `score=${eomScore}`);
ok("엄성욱 케이스 점수는 80점대", eomScore >= 80 && eomScore <= 90, `score=${eomScore}`);

// ── 2) 노트 없으면 null (앱 값 사용 경로)
ok("노트가 없으면 null을 반환해 앱 값을 쓰게 한다", computeScoreFromNotes([]) === null);

// ── 3) 구버전 앱이 낮은 점수를 보내도 서버 계산이 이긴다
const mockSupabase = {
  from(table) {
    return {
      select() { return this; },
      eq() { return this; },
      limit() { return Promise.resolve({ data: eom, error: null }); },
      maybeSingle() { return Promise.resolve({ data: { auth_user_id: "auth-1" }, error: null }); },
    };
  },
};
const server = await serverScoreFor(mockSupabase, "user-1");
const oldAppSent = 65;
const finalScore = server !== null ? server : oldAppSent;
ok("구버전 앱이 보낸 65점이 서버 계산값을 덮어쓰지 못한다", finalScore > oldAppSent, `final=${finalScore} (앱이 보낸값 ${oldAppSent})`);

// ── 4) auth 연결이 없으면 null → 앱 값 사용 (비로그인 사용자 회귀 방지)
const noAuth = { from() { return { select() { return this; }, eq() { return this; }, maybeSingle: () => Promise.resolve({ data: null, error: null }) }; } };
ok("auth 연결 없는 사용자는 null → 앱 값 유지", (await serverScoreFor(noAuth, "user-2")) === null);

// ── 5) 조회 실패해도 예외를 던지지 않는다(프로필 동기화를 막으면 안 됨)
const boom = { from() { return { select() { return this; }, eq() { return this; }, maybeSingle: () => { throw new Error("db down"); } }; } };
ok("DB 장애 시 null 반환(동기화 차단 안 함)", (await serverScoreFor(boom, "user-3")) === null);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
