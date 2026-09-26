// 모든 프로필 쓰기는 service_role 전용 RPC 한 트랜잭션에서 공개 상태를 재확인한다.
// 배포 필수: migrations/2026-09-26-profile-sync-atomic.sql. RPC가 없으면 503이며 직접 쓰지 않는다.
import { supabase, checkAppToken, verifyOwnership, cors } from "./_profileLib.js";
import { serverScoreFor } from "./_score.js";
import { serverMileageFor } from "./_mileage.js";

export function resolveMileage(serverResult, appMileage) {
  const server = serverResult && Number.isFinite(serverResult.mileage) ? serverResult.mileage : null;
  const app = Number.isFinite(appMileage) && appMileage > 0 ? appMileage : 0;
  if (server === null && app === 0) return null;
  return { mileage: Math.max(server || 0, app) };
}

// ISO 또는 epoch ms. Date 범위를 벗어난 숫자도 거절한다.
export function parseVisibilityTs(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "" || normalized === null || normalized === undefined) return null;
  const n = typeof normalized === "number" || /^\d+$/.test(normalized)
    ? Number(normalized) : (typeof normalized === "string" ? Date.parse(normalized) : NaN);
  return Number.isFinite(n) && Number.isFinite(new Date(n).getTime()) ? n : null;
}

export async function writeProfileAtomically(client, { userId, mode, row = {}, requestedPublic, requestedTs = null }) {
  const { data, error } = await client.rpc("sync_artist_profile_atomic", {
    p_user_id: userId,
    p_mode: mode,
    p_profile: row,
    p_requested_public: typeof requestedPublic === "boolean" ? requestedPublic : null,
    p_requested_at: requestedTs === null ? null : new Date(requestedTs).toISOString(),
  });
  if (error) throw error;
  if (!data || data.ok !== true) throw new Error("invalid_profile_rpc_response");
  return data; // 응답도 사전 조회값이 아니라 잠금 안에서 확정한 정본이다.
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!checkAppToken(req)) return res.status(401).json({ error: "Unauthorized" });
  const body = req.body || {};
  const { userId, profileToken, profile: p } = body;
  if (typeof userId !== "string" || !userId || !p || typeof p !== "object" || Array.isArray(p)) {
    return res.status(400).json({ error: "userId, profile required" });
  }
  if (!verifyOwnership(userId, profileToken)) return res.status(403).json({ error: "ownership verification failed" });

  const rawPublic = p.profilePublic !== undefined ? p.profilePublic : body.profilePublic;
  const requestedPublic = typeof rawPublic === "boolean" ? rawPublic : undefined;
  const rawTs = p.visibilityUpdatedAt !== undefined ? p.visibilityUpdatedAt : body.visibilityUpdatedAt;
  const requestedTs = parseVisibilityTs(rawTs);
  if (rawTs !== undefined && rawTs !== null && requestedTs === null) {
    return res.status(400).json({ error: "invalid_visibility_timestamp" });
  }
  if (p._visibilityOnly && typeof requestedPublic !== "boolean") {
    return res.status(400).json({ error: "profilePublic required" });
  }
  const mode = p._photosOnly ? "photos" : p._visibilityOnly ? "visibility" : "full";
  let row = {};
  if (mode === "photos") {
    row = { photos: p.photos || [], photo_url: p.photoUrl || null };
  } else if (mode === "full" && requestedPublic !== false) {
    // 노트 계산은 잠금 밖에서 수행해 쓰기 잠금을 짧게 유지한다.
    // 이 값이 계산되는 동안 다른 요청이 저장한 점수/마일리지는 RPC에서 다시 읽고 최댓값을 보존한다.
    const [computedScore, serverMileage] = await Promise.all([
      serverScoreFor(supabase, userId), serverMileageFor(supabase, userId),
    ]);
    const appScore = Number.isFinite(p.score) && p.score > 0 ? Math.floor(p.score) : 0;
    const appMileage = Number.isFinite(p.mileage) && p.mileage > 0 ? Math.floor(p.mileage) : 0;
    const mileage = resolveMileage(serverMileage, appMileage);
    row = {
      name: p.name || "익명", email: p.email || null, user_type: p.userType || null,
      fields: p.fields || [], gender: p.gender || null, birth_date: p.birthDate || null,
      height: p.height || null, weight: p.weight || null,
      height_private: p.heightPrivate || false, weight_private: p.weightPrivate || false,
      specialties: p.specialties || [], school: p.school || null, location: p.location || null,
      agency: p.agency || null, career: p.career || [], bio: p.bio || null,
      role_models: p.roleModels || [], interests: p.interests || [],
      photo_url: p.photoUrl || null, photos: p.photos || [],
      score: Math.max(computedScore || 0, appScore),
      notes_count: p.notesCount || 0, streak_days: p.streakDays || 0,
      ...(mileage ? { mileage: mileage.mileage } : {}),
    };
  }
  try {
    const result = await writeProfileAtomically(supabase, { userId, mode, row, requestedPublic, requestedTs });
    return res.status(200).json(result);
  } catch (e) {
    console.error("[profile-sync atomic]", e.message);
    // RPC/컬럼 미설치, DB 장애 모두 보호 없는 구경로로 우회하지 않는다.
    return res.status(503).json({ error: "profile_sync_unavailable", retryable: true });
  }
}
