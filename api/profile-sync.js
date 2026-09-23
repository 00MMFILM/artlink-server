// 프로필 생성/수정 — 소유권 토큰 검증 후 service_role로 upsert.
// anon 직접 쓰기를 대체하여 남의 프로필 변조 차단.
//
// 공개 여부(2026-09-23): 앱이 profilePublic(불리언)과 단조 증가하는 visibilityUpdatedAt을 보낸다.
// - OFF면 행을 지우지 않고 개인정보 컬럼만 비운 "묘비 행"으로 남긴다. 행을 지우면 다른 기기의
//   늦은 업로드가 프로필을 통째로 되살린다.
// - 저장된 visibility_updated_at보다 오래된(또는 같은) 요청은 무시하고 ignored:"stale_visibility"를
//   돌려준다. 시각 자체를 안 보내는 구버전 요청도 이미 비공개인 행은 되살리지 못한다.
// 마이그레이션: migrations/2026-09-23-profile-visibility.sql (컬럼 부재 DB에서도 동작하도록 폴백 유지)
import { supabase, checkAppToken, verifyOwnership, cors } from "./_profileLib.js";
import { serverScoreFor } from "./_score.js";
import { serverMileageFor, nonDecreasingMileage } from "./_mileage.js";

// artist_profiles.mileage/level/profile_public 등 컬럼이 아직 없는 환경(마이그레이션 미실행) 방어용 판별.
// 컬럼 부재 시에도 프로필 동기화 자체는 깨지면 안 된다.
export function isMissingColumnError(error) {
  const msg = (error && error.message) || "";
  const code = error?.code || "";
  // 42703: 포스트그레스 직접 오류.
  // PGRST204: PostgREST 스키마 캐시에 컬럼이 없을 때(실측 2026-09-23: 마이그레이션 전 운영 DB 응답).
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /column .* does not exist/i.test(msg) ||
    /could not find the .* column/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

// 마이그레이션 전에는 없을 수 있는 선택 컬럼 — upsert 실패 시 이 키들만 빼고 재시도한다.
const OPTIONAL_COLS = ["mileage", "level", "profile_public", "visibility_updated_at"];

// 공개 OFF 묘비 행이 비우는 개인정보 컬럼. score/mileage/level은 개인 식별 정보가 아니고
// 마일리지는 감소불가 규칙이 있어 그대로 둔다(다시 공개해도 레벨이 초기화되지 않는다).
export const TOMBSTONE_FIELDS = {
  name: "익명",
  email: null,
  user_type: null,
  fields: [],
  gender: null,
  birth_date: null,
  height: null,
  weight: null,
  height_private: false,
  weight_private: false,
  specialties: [],
  school: null,
  location: null,
  agency: null,
  career: [],
  bio: null,
  role_models: [],
  interests: [],
  photo_url: null,
  photos: [],
  notes_count: 0,
  streak_days: 0,
};

// upsert 실행 + 선택 컬럼 부재 폴백. supabaseClient를 인자로 받아 테스트 가능하게 분리.
export async function upsertProfileRow(supabaseClient, row, mileagePatch, visibilityPatch) {
  const { error } = await supabaseClient.from("artist_profiles").upsert(row, { onConflict: "user_id" });
  if (!error) return { ok: true };
  if ((mileagePatch || visibilityPatch) && isMissingColumnError(error)) {
    const fallbackRow = { ...row };
    for (const c of OPTIONAL_COLS) delete fallbackRow[c];
    const { error: err2 } = await supabaseClient
      .from("artist_profiles")
      .upsert(fallbackRow, { onConflict: "user_id" });
    if (err2) throw err2;
    return { ok: true, mileageSkipped: !!mileagePatch, visibilitySkipped: !!visibilityPatch };
  }
  throw error;
}

// 서버 계산 결과({mileage,...} 객체 또는 null)와 앱이 보낸 숫자를 합쳐 nonDecreasingMileage에 넘길
// {mileage} 형태로 만든다. 둘 다 없으면 null(저장값 유지).
// 2026-08-30~09-03 사고: 객체를 숫자와 Math.max해 NaN→DB null로 저장, 동기화한 전원 Lv1로 초기화됨.
export function resolveMileage(serverResult, appMileage) {
  const server = serverResult && Number.isFinite(serverResult.mileage) ? serverResult.mileage : null;
  const app = Number.isFinite(appMileage) && appMileage > 0 ? appMileage : 0;
  if (server === null && app === 0) return null;
  return { mileage: Math.max(server || 0, app) };
}

// ISO 문자열 또는 epoch ms → epoch ms. 해석 불가면 null.
export function parseVisibilityTs(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

// 저장된 공개 상태와 새 요청을 비교해 무엇을 할지 정한다.
// 반환: { action:"ignore" } | { action:"tombstone"|"upsert", patch }
// patch가 null이면 공개 관련 컬럼을 건드리지 않는다(공개 정보를 안 보낸 구버전 요청).
export function decideVisibility(existing, requestedPublic, requestedTs) {
  const storedRaw = existing ? existing.visibility_updated_at : null;
  const storedTs = storedRaw ? parseVisibilityTs(storedRaw) : null;
  const storedPrivate = existing ? existing.profile_public === false : false;

  // 단조 증가: 저장된 시각보다 오래되거나 같은 요청은 공개 여부를 바꿀 자격이 없다.
  const staleStamp = requestedTs !== null && storedTs !== null && requestedTs <= storedTs;
  // 비공개 행을 되살리려는 요청(늦게 도착했거나 시각을 모르는 요청)은 통째로 무시한다.
  if (storedPrivate && (staleStamp || requestedTs === null)) return { action: "ignore" };
  // 공개 상태에서 같은 시각으로 오는 요청은 "공개 여부는 그대로, 내용만 저장"이다.
  // (앱은 토글을 바꿀 때만 시각을 갱신하므로, 이걸 무시하면 이름·키 같은 일반 수정이 서버에 영영 반영되지 않는다.)
  if (staleStamp) {
    // 늦게 도착한 OFF 요청이 최신 ON 상태를 뒤집지는 못한다(공개 여부 변경은 단조 증가만).
    if (requestedPublic === false) return { action: "ignore" };
    return { action: "upsert", patch: null };
  }

  const stamp = new Date(requestedTs === null ? Date.now() : requestedTs).toISOString();
  if (requestedPublic === false) {
    return { action: "tombstone", patch: { profile_public: false, visibility_updated_at: stamp } };
  }
  if (requestedPublic === true && requestedTs !== null) {
    return { action: "upsert", patch: { profile_public: true, visibility_updated_at: stamp } };
  }
  return { action: "upsert", patch: null };
}

// 기존 행 조회. profile_public/visibility_updated_at·mileage 컬럼이 없는 구버전 DB에서도
// 죽지 않도록 컬럼 집합을 단계적으로 줄여 재조회한다.
export async function fetchExistingProfile(supabaseClient, userId) {
  const attempts = [
    { cols: "mileage, score, profile_public, visibility_updated_at", visibility: true },
    { cols: "mileage, score", visibility: false },
    { cols: "score", visibility: false },
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const { data, error } = await supabaseClient
        .from("artist_profiles")
        .select(attempt.cols)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        lastError = error;
        if (isMissingColumnError(error)) continue;
        break;
      }
      return { row: data || null, visibilitySupported: attempt.visibility };
    } catch (e) {
      lastError = e;
      if (isMissingColumnError(e)) continue;
      break;
    }
  }
  if (lastError) console.error("[profile-sync] existing fetch failed:", lastError.message);
  return { row: null, visibilitySupported: false };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!checkAppToken(req)) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body || {};
  const { userId, profileToken, profile } = body;
  if (!userId || !profile) return res.status(400).json({ error: "userId, profile required" });
  if (!verifyOwnership(userId, profileToken)) {
    return res.status(403).json({ error: "ownership verification failed" });
  }

  const p = profile;
  // 공개 여부는 profile 안이든 본문 루트든 받는다(앱 버전별 위치 차이 흡수).
  const rawPublic = p.profilePublic !== undefined ? p.profilePublic : body.profilePublic;
  const requestedPublic = typeof rawPublic === "boolean" ? rawPublic : undefined;
  const requestedTs = parseVisibilityTs(
    p.visibilityUpdatedAt !== undefined ? p.visibilityUpdatedAt : body.visibilityUpdatedAt
  );

  const { row: existingRow } = await fetchExistingProfile(supabase, userId);
  const storedPrivate = existingRow ? existingRow.profile_public === false : false;

  // 서버가 기억하는 현재 공개 상태 — 모든 응답에 실어, 이 사실을 모르는 다른 기기가
  // 나중에 새 시각으로 다시 공개로 되돌리는 것을 앱이 스스로 막게 한다.
  const storedVisibility = existingRow
    ? {
        profilePublic: existingRow.profile_public === false ? false : true,
        visibilityUpdatedAt: existingRow.visibility_updated_at || undefined,
      }
    : {};

  // 사진만 부분 업데이트 (전체 프로필 덮어쓰기 방지)
  if (p._photosOnly) {
    // 비공개 묘비 행에 사진만 다시 밀어넣는 것도 되살리기다 — 막는다.
    if (storedPrivate) return res.status(200).json({ ok: true, ignored: "stale_visibility", ...storedVisibility });
    try {
      const { error } = await supabase
        .from("artist_profiles")
        .update({ photos: p.photos || [], photo_url: p.photoUrl || null })
        .eq("user_id", userId);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("[profile-sync photos]", e.message);
      return res.status(500).json({ error: "photo sync failed" });
    }
  }

  // 공개 여부만 부분 업데이트 — 앱이 토글을 바꿀 때 보낸다. 다른 컬럼을 건드리지 않는다.
  // (전체 프로필 경로로 흘려보내면 값이 없는 필드가 빈 값으로 덮여 프로필이 지워진다.)
  if (p._visibilityOnly) {
    const only = decideVisibility(existingRow, requestedPublic, requestedTs);
    if (only.action === "ignore") {
      return res.status(200).json({ ok: true, ignored: "stale_visibility", ...storedVisibility });
    }
    if (only.action === "tombstone") {
      try {
        const result = await upsertProfileRow(
          supabase,
          { user_id: userId, ...TOMBSTONE_FIELDS, ...only.patch, updated_at: new Date().toISOString() },
          null,
          only.patch
        );
        return res.status(200).json({
          ok: true,
          profilePublic: false,
          visibilityUpdatedAt: only.patch.visibility_updated_at,
          visibilitySkipped: result.visibilitySkipped || undefined,
        });
      } catch (e) {
        console.error("[profile-sync visibility-only off]", e.message);
        return res.status(500).json({ error: "sync failed" });
      }
    }
    // 공개 ON: 올릴 프로필 내용이 이 요청에 없으므로 행을 새로 만들지 않는다.
    if (!existingRow) return res.status(200).json({ ok: true, ignored: "no_profile", ...storedVisibility });
    if (!only.patch) return res.status(200).json({ ok: true, ignored: "no_visibility_stamp", ...storedVisibility });
    try {
      const { error } = await supabase
        .from("artist_profiles")
        .update({ ...only.patch, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (error) {
        if (isMissingColumnError(error)) {
          return res.status(200).json({ ok: true, visibilitySkipped: true });
        }
        throw error;
      }
      return res.status(200).json({
        ok: true,
        profilePublic: true,
        visibilityUpdatedAt: only.patch.visibility_updated_at,
      });
    } catch (e) {
      console.error("[profile-sync visibility-only on]", e.message);
      return res.status(500).json({ error: "sync failed" });
    }
  }

  const decision = decideVisibility(existingRow, requestedPublic, requestedTs);
  if (decision.action === "ignore") {
    return res.status(200).json({ ok: true, ignored: "stale_visibility", ...storedVisibility });
  }

  // 공개 OFF — 개인정보만 비우고 묘비 행으로 남긴다. 점수·마일리지 재계산은 하지 않는다.
  if (decision.action === "tombstone") {
    const tombstone = {
      user_id: userId,
      ...TOMBSTONE_FIELDS,
      ...decision.patch,
      updated_at: new Date().toISOString(),
    };
    try {
      const result = await upsertProfileRow(supabase, tombstone, null, decision.patch);
      return res.status(200).json({
        ok: true,
        profilePublic: false,
        visibilityUpdatedAt: decision.patch.visibility_updated_at,
        visibilitySkipped: result.visibilitySkipped || undefined,
      });
    } catch (e) {
      console.error("[profile-sync visibility]", e.message);
      return res.status(500).json({ error: "sync failed" });
    }
  }

  // 점수는 서버가 직접 계산한다(노트가 서버에 있는 경우). 구버전 앱이 옛 공식으로 계산한
  // 낮은 점수를 밀어올려 고쳐진 점수를 되돌리던 문제를 막는다. 계산 불가면 앱 값을 쓴다.
  const computedScore = await serverScoreFor(supabase, userId);
  // 앱이 보낸 점수도 후보에 넣는다. 앱은 사진·음성 첨부까지 세지만 서버는 볼 수 없어서,
  // 서버 값만 쓰면 사용자 화면(앱 계산)과 B2B(서버 값)가 어긋난다(2026-08-30 제보).
  const appScore = Number.isFinite(p.score) && p.score > 0 ? Math.floor(p.score) : 0;

  // 마일리지는 누적·감소불가: 신규 계산값과 기존 저장값 중 큰 쪽을 쓴다(노트를 지워도 안 줄어듦).
  // 앱이 보낸 값도 후보에 넣는다 — 앱은 사진·음성까지 볼 수 있어(서버는 영상분석만) 더 정확할 수 있다.
  const appMileage = Number.isFinite(p.mileage) && p.mileage > 0 ? Math.floor(p.mileage) : 0;
  const computedMileage = resolveMileage(await serverMileageFor(supabase, userId), appMileage);
  // 기존 저장값은 점수·마일리지 양쪽 판정에 모두 필요하다.
  // (없는 걸로 치면 노트가 없는 사용자에서 existingScore가 0으로 남아 점수가 깎인다)
  const existingMileage = existingRow?.mileage || 0;
  const existingScore = existingRow?.score || 0;
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
  if (decision.patch) Object.assign(row, decision.patch);

  try {
    const result = await upsertProfileRow(supabase, row, mileagePatch, decision.patch);
    // 앱이 이 값을 그대로 표시하면 사용자 화면과 B2B 대시보드가 항상 같아진다.
    return res.status(200).json({
      ...result,
      score: row.score,
      mileage: result.mileageSkipped ? undefined : row.mileage,
      level: result.mileageSkipped ? undefined : row.level,
      // 공개 여부는 항상 서버 기준값을 돌려준다 — 앱이 다른 기기의 변경을 알 수 있게.
      profilePublic: decision.patch ? true : storedVisibility.profilePublic,
      visibilityUpdatedAt: decision.patch
        ? decision.patch.visibility_updated_at
        : storedVisibility.visibilityUpdatedAt,
    });
  } catch (e) {
    console.error("[profile-sync]", e.message);
    return res.status(500).json({ error: "sync failed" });
  }
}
