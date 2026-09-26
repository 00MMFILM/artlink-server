// 구버전 공개해제 경로: 실제 회원탈퇴(account-delete)와 달리 OFF 묘비를 보존한다.
import { supabase, checkAppToken, verifyOwnership, cors } from "./_profileLib.js";
import { writeProfileAtomically } from "./profile-sync.js";

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
    const result = await writeProfileAtomically(supabase, { userId, mode: "delete" });
    return res.status(200).json(result);
  } catch (e) {
    console.error("[profile-delete]", e.message);
    return res.status(503).json({ error: "profile_sync_unavailable", retryable: true });
  }
}
