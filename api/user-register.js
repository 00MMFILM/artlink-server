// 기기/계정 사용자 등록 — ensureDeviceUser 로직을 서버로 이전.
// users 테이블 접근을 anon에서 서버(service_role)로 옮겨 device_id 노출 차단.
// 반환: { userId, profileToken } — 이후 프로필 쓰기의 소유권 증명에 사용.
import { supabase, checkAppToken, makeProfileToken, cors } from "./_profileLib.js";

// Authorization: Bearer <supabase access token>을 검증해 실제 auth user id를 얻는다.
// 헤더가 없거나 토큰이 무효면 null. (api/_usage.js identifyUser와 동일 방식)
export async function verifiedAuthUserId(req) {
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    const { data, error } = await supabase.auth.getUser(m[1]);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!checkAppToken(req)) return res.status(401).json({ error: "Unauthorized" });

  const { deviceId, displayName, field, authUserId } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  // 소유권의 신뢰 원천을 body의 authUserId에서 Bearer 토큰으로 옮긴다.
  // body만 믿으면 남의 auth uuid만 알아도 그 계정의 profileToken을 발급받을 수 있었다.
  const tokenUserId = await verifiedAuthUserId(req);
  if (tokenUserId && authUserId && authUserId !== tokenUserId) {
    return res.status(401).json({ error: "auth mismatch" });
  }
  // 토큰이 없으면(구버전 앱·세션 캐시 미로드) authUserId를 무시하고 device 경로로만 진행한다.
  // 신규/익명 등록은 종전대로 허용하고, 기존 auth 계정 사칭 발급 경로만 차단.
  const authId = tokenUserId || null;

  try {
    // 1) auth 계정으로 기존 유저 찾기 (교차기기 재연결) — 검증된 토큰이 있을 때만
    if (authId) {
      const { data: byAuth } = await supabase
        .from("users").select("id").eq("auth_user_id", authId).maybeSingle();
      if (byAuth) {
        // 구 device 계정의 중복 프로필 정리
        const { data: oldDevice } = await supabase
          .from("users").select("id").eq("device_id", deviceId).maybeSingle();
        if (oldDevice && oldDevice.id !== byAuth.id) {
          await supabase.from("artist_profiles").delete().eq("user_id", oldDevice.id);
        }
        return res.status(200).json({ userId: byAuth.id, profileToken: makeProfileToken(byAuth.id) });
      }
    }

    // 2) device로 기존 유저 찾기
    const { data: existing } = await supabase
      .from("users").select("id").eq("device_id", deviceId).maybeSingle();
    if (existing) {
      if (authId) {
        await supabase.from("users").update({ auth_user_id: authId }).eq("id", existing.id);
      }
      return res.status(200).json({ userId: existing.id, profileToken: makeProfileToken(existing.id) });
    }

    // 3) 신규 생성
    const { data: created, error } = await supabase
      .from("users")
      .insert({
        device_id: deviceId,
        display_name: displayName || "익명",
        field: field || null,
        auth_user_id: authId,
      })
      .select("id")
      .single();
    if (error) throw error;

    return res.status(200).json({ userId: created.id, profileToken: makeProfileToken(created.id) });
  } catch (e) {
    console.error("[user-register]", e.message);
    return res.status(500).json({ error: "register failed" });
  }
}
