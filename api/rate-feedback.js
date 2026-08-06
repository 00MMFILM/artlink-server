import { createClient } from "@supabase/supabase-js";
import { checkAppToken, rejectAppToken, identifyUser } from "./_usage.js";

// 피드백 평가 수신 (👍/👎 + 이유) — 학습 데이터 라벨링의 시작점
// 게스트도 deviceId로 평가 가능 (활성화 개편 후 대부분 게스트이므로 필수)
// 테이블: schema-data-assets.sql 참조

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

const VALID_REASONS = ["generic", "irrelevant", "wrong", "too_long"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!checkAppToken(req)) return rejectAppToken(res);
  if (!supabase) return res.status(500).json({ error: "Storage not configured" });

  try {
    const {
      noteLocalId,
      feedbackKind = "text",
      rating,
      reason,
      aiModel,
      promptVersion,
      deviceId,
    } = req.body || {};

    if (!noteLocalId || !["up", "down"].includes(rating)) {
      return res.status(400).json({ error: "noteLocalId and rating(up|down) required" });
    }

    const user = await identifyUser(req);
    const userId = user?.id || (deviceId ? `dev:${deviceId}` : null);
    if (!userId) return res.status(400).json({ error: "auth or deviceId required" });

    const { error } = await supabase.from("feedback_ratings").upsert(
      {
        user_id: userId,
        note_local_id: String(noteLocalId),
        feedback_kind: feedbackKind === "video" ? "video" : "text",
        rating,
        reason: rating === "down" && VALID_REASONS.includes(reason) ? reason : null,
        ai_model: aiModel || null,
        prompt_version: promptVersion || null,
      },
      { onConflict: "user_id,note_local_id,feedback_kind" }
    );

    if (error) {
      console.error("[rate-feedback] upsert error:", error.message);
      return res.status(500).json({ error: "Failed to save rating" });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("[rate-feedback] Error:", e.message);
    return res.status(500).json({ error: "Failed to save rating" });
  }
}
