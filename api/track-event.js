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
    await supabase.from("funnel_events").upsert(
      {
        device_id: deviceId,
        event,
        language: language || null,
        platform: platform || null,
        app_version: appVersion || null,
      },
      { onConflict: "device_id,event", ignoreDuplicates: true }
    );

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("[track-event]", e.message);
    return res.status(200).json({ success: true }); // Silent fail
  }
}
