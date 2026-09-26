import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// 온보딩 퍼널 이벤트 기록 — 기기당 이벤트별 최초 1회만 저장
// (unique(device_id, event) + ignoreDuplicates)
const VALID_EVENTS = new Set([
  "new_open",
  "onboarding_completed",
  "auth_reached",
  "signup_completed",
  "login_completed",
  "browse_skipped",
  "eula_accepted",
  "profile_registered",
  // 앱이 이미 보내고 있었지만 화이트리스트에 없어 400으로 버려지던 이벤트 (2026-09-03 실측)
  "guest_entered",
  "reminder_set",
  "ai_video_profile_interest",
  // 1.11.1 활성화 측정: 첫 노트 저장·첫 AI 피드백·게스트 가입 유도 노출/탭
  "note_saved",
  "ai_feedback_done",
  "signup_nudge_shown",
  "signup_nudge_tapped",
  // 웹→앱 연결 브릿지(/practice, 2026-09-17): 앱이 이미 보내지만 화이트리스트에
  // 없어 400으로 버려지던 딥링크 유입 이벤트 + 3단계 신규 이벤트
  "deeplink_actraw",
  "deeplink_bium",
  "deeplink_external",
  "focus_selected",
  "repractice_started",
  "duet_to_note",
  // 1.11.8 가입 직후 첫 체크인 화면 — 노출·저장·나중에
  "first_checkin_shown",
  "first_checkin_saved",
  "first_checkin_skipped",
]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { deviceId, event, language, platform, appVersion } = req.body || {};

  if (!deviceId || !event) {
    return res.status(400).json({ error: "deviceId and event are required" });
  }
  if (!VALID_EVENTS.has(event)) {
    return res.status(400).json({ error: "Unknown event" });
  }

  try {
    const { error } = await supabase.from("funnel_events").upsert(
      {
        device_id: deviceId,
        event,
        language: language || null,
        platform: platform || null,
        app_version: appVersion || null,
      },
      { onConflict: "device_id,event", ignoreDuplicates: true }
    );
    // upsert 실패를 조용히 넘기면 퍼널 이벤트가 유실된 걸 알 수 없다 → 반드시 로깅
    if (error) {
      console.error("[track-event] upsert failed:", deviceId, event, error.message);
      return res.status(200).json({ success: false });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("[track-event]", e.message);
    return res.status(200).json({ success: true }); // Silent fail
  }
}
