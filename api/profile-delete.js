// 프로필 삭제(탈퇴/공개해제) — 소유권 검증 후 본인 것만 삭제.
import { supabase, checkAppToken, verifyOwnership, cors } from "./_profileLib.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!checkAppToken(req)) return res.status(401).json({ error: "Unauthorized" });

  const { userId, profileToken } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId required" });
  if (!verifyOwnership(userId, profileToken)) {
    return res.status(403).json({ error: "ownership verification failed" });
  }

  try {
    const { error } = await supabase.from("artist_profiles").delete().eq("user_id", userId);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[profile-delete]", e.message);
    return res.status(500).json({ error: "delete failed" });
  }
}
