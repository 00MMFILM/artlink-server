// 회원 탈퇴 — 인증된 본인 계정과 본인 소유 자료만 삭제한다.
// 인증: checkAppToken(앱 토큰) + identifyUser(Bearer). 게스트·미인증은 401.
// 계약: POST /api/account-delete
//   전부 성공 → 200 { ok:true, complete:true, deleted:{단계별 건수}, scope, excludes:[...] }
//   일부 실패 → 500 { ok:false, complete:false, failed:[단계명...], deleted:{...}, retryable:true,
//                     error:"account_delete_failed" }
// 안전 규칙:
// - 모든 쿼리는 인증된 auth uuid(user.id) 또는 그 uuid에서 찾은 본인 users.id로만 필터한다.
//   요청 본문의 userId 같은 값은 쓰지 않는다(남의 계정 삭제 경로 원천 차단).
// - 재시도 멱등: 각 단계는 "본인 식별자 + DELETE"라 이미 지워진 단계는 0건으로 지나간다.
// - auth 계정 삭제는 맨 마지막. 중간에 실패하면 auth 계정을 남겨 사용자가 다시 로그인해
//   재시도할 수 있게 한다(먼저 지우면 남은 자료를 영원히 못 지운다).
// 관련: api/_archive.js(원본·media_assets 철회 로직 재사용), api/user-register.js(users 행 생성)
import { checkAppToken, rejectAppToken, identifyUser } from "./_usage.js";
import { supabase } from "./_profileLib.js";
import { withdrawUserArchive } from "./_archive.js";

// 소유자 식별 컬럼이 없어 이 API로는 지울 수 없는 자료. 앱 안내도 같은 범위를 써야 한다.
// - training_data: 소유자 컬럼 자체가 없음
// - guest_media_archive: 게스트 자료는 공통 'anon' 프리픽스라 개인 귀속 불가
// - funnel_events / mau_tracking / guest_ai_usage: device_id만 있고 계정 연결이 없음
// - reports: 신고 본문 JSON에 신고자 컬럼이 없음
const EXCLUDES = [
  "training_data",
  "guest_media_archive",
  "funnel_events",
  "mau_tracking",
  "guest_ai_usage",
  "reports",
];

const SCOPE = "authenticated_account";

// 본인 식별자 목록으로만 DELETE. 삭제된 행 수를 돌려준다(없으면 0 — 재시도 시 정상 경로).
// 표나 컬럼이 없는 환경(구버전 DB·미적용 마이그레이션)에서는 지울 것도 없다.
// 이걸 실패로 처리하면 사용자가 영원히 탈퇴를 끝내지 못한다.
function isMissingRelation(error) {
  const code = error?.code || "";
  const msg = (error?.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache")
  );
}

async function deleteOwned(table, column, values, selectCol) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  let q = supabase.from(table).delete();
  q = values.length === 1 ? q.eq(column, values[0]) : q.in(column, values);
  const { data, error } = await q.select(selectCol);
  if (error) {
    if (isMissingRelation(error)) return 0;
    throw new Error(`${table}:${error.message}`);
  }
  return (data || []).length;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!checkAppToken(req)) return rejectAppToken(res);

  const user = await identifyUser(req);
  if (!user || !user.id) {
    return res.status(401).json({
      ok: false,
      complete: false,
      error: "authenticated_account_only",
      scope: SCOPE,
      excludes: EXCLUDES,
    });
  }
  const authId = user.id;

  const deleted = {};
  const failed = [];
  const step = async (name, fn) => {
    try {
      deleted[name] = await fn();
    } catch (e) {
      console.error(`[account-delete] ${name}:`, e.message);
      failed.push(name);
    }
  };

  // 0) 본인 users 행(내부 id) 찾기 — artist_profiles·growth_vectors는 내부 id를 쓴다.
  //    이미 지워졌으면 빈 배열이고, 그래도 authId로 거는 필터는 계속 동작한다.
  let internalIds = [];
  try {
    const { data, error } = await supabase.from("users").select("id").eq("auth_user_id", authId);
    if (error) throw new Error(error.message);
    internalIds = (data || []).map((r) => r.id).filter(Boolean);
  } catch (e) {
    console.error("[account-delete] users_lookup:", e.message);
    failed.push("users_lookup");
  }
  // 본인 것으로 확정된 식별자만 필터에 쓴다. uuid라 남의 행과 겹칠 수 없다.
  const ownedIds = [...new Set([...internalIds, authId])];

  // 1) 학습 원본(media-archive) + media_assets — 철회 API와 같은 로직을 재사용한다.
  //    실패하면 예외를 던지므로 완료로 보고되지 않는다.
  await step("media_archive", async () => (await withdrawUserArchive(authId)).deleted);

  // 2) 노트 원문 (user_notes.auth_user_id = auth uuid — api/_score.js 조회 기준과 동일)
  await step("user_notes", () => deleteOwned("user_notes", "auth_user_id", [authId], "auth_user_id"));

  // 3) 공개 프로필 (artist_profiles.user_id = users.id — api/artist-browse.js가 users.id와 대조)
  await step("artist_profiles", () => deleteOwned("artist_profiles", "user_id", ownedIds, "user_id"));

  // 4) 성장 벡터 (growth_vectors.user_id — 앱이 프로필과 같은 userId를 보낸다)
  await step("growth_vectors", () => deleteOwned("growth_vectors", "user_id", ownedIds, "user_id"));

  // 5) 피드백 평가 (feedback_ratings.user_id = auth uuid 또는 게스트 'dev:<deviceId>')
  await step("feedback_ratings", () => deleteOwned("feedback_ratings", "user_id", [authId], "user_id"));

  // 6) 연습 이벤트는 기기 단위 지표라 행을 지우지 않고 계정 연결만 끊는다(auth_user_id → null).
  await step("practice_events_unlinked", async () => {
    const { data, error } = await supabase
      .from("practice_events")
      .update({ auth_user_id: null })
      .eq("auth_user_id", authId)
      .select("id");
    if (error) {
      if (isMissingRelation(error)) return 0;
      throw new Error(`practice_events:${error.message}`);
    }
    return (data || []).length;
  });

  // 7) 사용량·구독 권한. premium_members가 남으면 같은 auth uuid를 재발급받은 계정이
  //    유령 프리미엄이 될 수 있으므로 반드시 지운다.
  await step("ai_usage_daily", () => deleteOwned("ai_usage_daily", "user_id", [authId], "user_id"));
  await step("ai_video_usage", () => deleteOwned("ai_video_usage", "user_id", [authId], "user_id"));
  await step("premium_members", () => deleteOwned("premium_members", "user_id", [authId], "user_id"));

  // 8) 기기/계정 등록 행 — 내부 id를 쓰는 단계(3·4)가 모두 끝난 뒤에 지운다.
  //    앞 단계가 하나라도 실패했으면 남긴다: 이 행이 auth uuid ↔ 내부 id를 잇는 유일한 연결이라
  //    먼저 지우면 재시도에서 남은 프로필·성장벡터를 영영 찾지 못한다.
  if (failed.length === 0) {
    await step("users", () => deleteOwned("users", "id", internalIds, "id"));
  }

  // 9) 남은 실패가 있으면 auth 계정을 남긴다 — 다시 로그인해 재시도할 수 있어야 한다.
  if (failed.length > 0) {
    return res.status(500).json({
      ok: false,
      complete: false,
      failed,
      deleted,
      retryable: true,
      error: "account_delete_failed",
      scope: SCOPE,
      excludes: EXCLUDES,
    });
  }

  await step("auth_user", async () => {
    const { error } = await supabase.auth.admin.deleteUser(authId);
    if (error) throw new Error(`auth:${error.message}`);
    return 1;
  });

  if (failed.length > 0) {
    return res.status(500).json({
      ok: false,
      complete: false,
      failed,
      deleted,
      retryable: true,
      error: "account_delete_failed",
      scope: SCOPE,
      excludes: EXCLUDES,
    });
  }

  return res.status(200).json({ ok: true, complete: true, deleted, scope: SCOPE, excludes: EXCLUDES });
}
