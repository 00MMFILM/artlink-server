// 리워드 광고 시청 보상 — 당일 텍스트 피드백 크레딧 +1 (하루 최대 +2) (1.10.14+)
// POST, 헤더: X-App-Token + Authorization: Bearer <supabase access token>
// ⚠️ v1은 앱 신고 기반 (AdMob SSV 서버 검증은 추후 도입 검토)
import {
  checkAppToken,
  rejectAppToken,
  identifyUser,
  grantAdCredit,
} from "./_usage.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!checkAppToken(req)) return rejectAppToken(res);

  const user = await identifyUser(req);
  if (!user) return res.status(401).json({ error: "auth_required" });

  const result = await grantAdCredit(user.id);
  return res.status(200).json(result);
}
