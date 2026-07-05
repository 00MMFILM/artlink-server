// 기기/계정 사용자 등록 — ensureDeviceUser 로직을 서버로 이전.
// users 테이블 접근을 anon에서 서버(service_role)로 옮겨 device_id 노출 차단.
// 반환: { userId, profileToken } — 이후 프로필 쓰기의 소유권 증명에 사용.
import { supabase, checkAppToken, makeProfileToken, cors } from "./_profileLib.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!checkAppToken(req)) return res.status(401).json({ error: "Unauthorized" });

  const { deviceId, displayName, field, authUserId } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  try {
    // 1) auth 계정으로 기존 유저 찾기 (교차기기 재연결)
    if (authUserId) {
      const { data: byAuth } = await supabase
        .from("users").select("id").eq("auth_user_id", authUserId).maybeSingle();
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
      if (authUserId) {
        await supabase.from("users").update({ auth_user_id: authUserId }).eq("id", existing.id);
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
        auth_user_id: authUserId || null,
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
