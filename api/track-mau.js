import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// 월 집계 키는 KST(UTC+9) 기준. UTC로 계산하면 매월 1일 00~09시(KST) 접속이
// 전월로 잡힌다. api/_usage.js의 kstDay()와 동일한 +9h 보정 방식.
export function kstMonth() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { deviceId, language, userType, platform, appVersion, timestamp } = req.body || {};

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required" });
  }

  try {
    const monthKey = kstMonth(); // "2026-04" (KST 기준)

    const { error } = await supabase.from("mau_tracking").upsert(
      {
        device_id: deviceId,
        language: language || "en",
        user_type: userType || "unknown",
        platform: platform || "ios",
        app_version: appVersion || "unknown",
        month: monthKey,
        last_seen: timestamp || new Date().toISOString(),
      },
      { onConflict: "device_id,month" }
    );
    // upsert 실패를 조용히 넘기면 MAU가 통째로 유실된 걸 알 수 없다 → 반드시 로깅
    if (error) {
      console.error("[track-mau] upsert failed:", deviceId, monthKey, error.message);
      return res.status(200).json({ success: false });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("[track-mau]", e.message);
    return res.status(200).json({ success: true }); // Silent fail
  }
}
