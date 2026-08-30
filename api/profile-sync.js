// 프로필 생성/수정 — 소유권 토큰 검증 후 service_role로 upsert.
// anon 직접 쓰기를 대체하여 남의 프로필 변조 차단.
import { supabase, checkAppToken, verifyOwnership, cors } from "./_profileLib.js";
import { serverScoreFor } from "./_score.js";
import { serverMileageFor, nonDecreasingMileage } from "./_mileage.js";

// artist_profiles.mileage/level 컬럼이 아직 없는 환경(마이그레이션 미실행) 방어용 판별.
// 컬럼 부재 시에도 프로필 동기화 자체는 깨지면 안 된다.
export function isMissingColumnError(error) {
  const msg = (error && error.message) || "";
  return error?.code === "42703" || /column .* does not exist/i.test(msg);
}

// upsert 실행 + mileage/level 컬럼 부재 폴백. supabaseClient를 인자로 받아 테스트 가능하게 분리.
export async function upsertProfileRow(supabaseClient, row, mileagePatch) {
  const { error } = await supabaseClient.from("artist_profiles").upsert(row, { onConflict: "user_id" });
  if (!error) return { ok: true };
  if (mileagePatch && isMissingColumnError(error)) {
    const { mileage, level, ...fallbackRow } = row;
    const { error: err2 } = await supabaseClient
      .from("artist_profiles")
      .upsert(fallbackRow, { onConflict: "user_id" });
    if (err2) throw err2;
    return { ok: true, mileageSkipped: true };
  }
  throw error;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!checkAppToken(req)) return res.status(401).json({ error: "Unauthorized" });

  const { userId, profileToken, profile } = req.body || {};
  if (!userId || !profile) return res.status(400).json({ error: "userId, profile required" });
  if (!verifyOwnership(userId, profileToken)) {
    return res.status(403).json({ error: "ownership verification failed" });
  }

  // 사진만 부분 업데이트 (전체 프로필 덮어쓰기 방지)
  if (profile._photosOnly) {
    try {
      const { error } = await supabase
        .from("artist_profiles")
        .update({ photos: profile.photos || [], photo_url: profile.photoUrl || null })
        .eq("user_id", userId);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("[profile-sync photos]", e.message);
      return res.status(500).json({ error: "photo sync failed" });
    }
  }

  const p = profile;
  // 점수는 서버가 직접 계산한다(노트가 서버에 있는 경우). 구버전 앱이 옛 공식으로 계산한
  // 낮은 점수를 밀어올려 고쳐진 점수를 되돌리던 문제를 막는다. 계산 불가면 앱 값을 쓴다.
  const computedScore = await serverScoreFor(supabase, userId);
  // 앱이 보낸 점수도 후보에 넣는다. 앱은 사진·음성 첨부까지 세지만 서버는 볼 수 없어서,
  // 서버 값만 쓰면 사용자 화면(앱 계산)과 B2B(서버 값)가 어긋난다(2026-08-30 제보).
  const appScore = Number.isFinite(p.score) && p.score > 0 ? Math.floor(p.score) : 0;

  // 마일리지는 누적·감소불가: 신규 계산값과 기존 저장값 중 큰 쪽을 쓴다(노트를 지워도 안 줄어듦).
  // 앱이 보낸 값도 후보에 넣는다 — 앱은 사진·음성까지 볼 수 있어(서버는 영상분석만) 더 정확할 수 있다.
  const appMileage = Number.isFinite(p.mileage) && p.mileage > 0 ? Math.floor(p.mileage) : 0;
  const serverMileage = await serverMileageFor(supabase, userId);
  const computedMileage = serverMileage === null
    ? (appMileage > 0 ? appMileage : null)
    : Math.max(serverMileage, appMileage);
  // 기존 저장값은 점수·마일리지 양쪽 판정에 모두 필요하므로 조건 밖에서 한 번만 조회한다.
  // (조건 안에 두면 노트가 없는 사용자에서 existingScore가 0으로 남아 점수가 깎인다)
  let existingScore = 0;
  let existingMileage = 0;
  try {
    const { data: existingRow } = await supabase
      .from("artist_profiles")
      .select("mileage, score")
      .eq("user_id", userId)
      .maybeSingle();
    existingMileage = existingRow?.mileage || 0;
    existingScore = existingRow?.score || 0;
  } catch (e) {
    // mileage 컬럼 미존재 등 — score만이라도 살린다
    try {
      const { data: r2 } = await supabase
        .from("artist_profiles").select("score").eq("user_id", userId).maybeSingle();
      existingScore = r2?.score || 0;
    } catch (_) {
      console.error("[profile-sync] existing fetch failed:", e.message);
    }
  }
  const mileagePatch = computedMileage !== null
    ? nonDecreasingMileage(existingMileage, computedMileage)
    : null;

  const row = {
    user_id: userId,
    name: p.name || "익명",
    email: p.email || null,
    user_type: p.userType || null,
    fields: p.fields || [],
    gender: p.gender || null,
    birth_date: p.birthDate || null,
    height: p.height || null,
    weight: p.weight || null,
    height_private: p.heightPrivate || false,
    weight_private: p.weightPrivate || false,
    specialties: p.specialties || [],
    school: p.school || null,
    location: p.location || null,
    agency: p.agency || null,
    career: p.career || [],
    bio: p.bio || null,
    role_models: p.roleModels || [],
    interests: p.interests || [],
    photo_url: p.photoUrl || null,
    photos: p.photos || [],
    score: Math.max(existingScore, computedScore || 0, appScore),
    notes_count: p.notesCount || 0,
    streak_days: p.streakDays || 0,
    updated_at: new Date().toISOString(),
  };
  if (mileagePatch) Object.assign(row, mileagePatch);

  try {
    const result = await upsertProfileRow(supabase, row, mileagePatch);
    // 앱이 이 값을 그대로 표시하면 사용자 화면과 B2B 대시보드가 항상 같아진다.
    return res.status(200).json({
      ...result,
      score: row.score,
      mileage: result.mileageSkipped ? undefined : row.mileage,
      level: result.mileageSkipped ? undefined : row.level,
    });
  } catch (e) {
    console.error("[profile-sync]", e.message);
    return res.status(500).json({ error: "sync failed" });
  }
}
