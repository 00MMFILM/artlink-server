import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

  const { deviceId, language, userType, platform, appVersion, timestamp } = req.body;

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required" });
  }

  try {
    const monthKey = new Date().toISOString().slice(0, 7); // "2026-04"

    await supabase.from("mau_tracking").upsert(
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

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("[track-mau]", e.message);
    return res.status(200).json({ success: true }); // Silent fail
  }
}
