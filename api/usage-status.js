// 사용량 잔여 조회 — 앱이 페이월/카운터 UI 표시에 사용 (1.10.14+)
// GET, 헤더: X-App-Token + Authorization: Bearer <supabase access token>
import {
  checkAppToken,
  rejectAppToken,
  identifyUser,
  checkTextQuota,
  checkVideoQuota,
} from "./_usage.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!checkAppToken(req)) return rejectAppToken(res);

  const user = await identifyUser(req);
  if (!user) return res.status(401).json({ error: "auth_required" });

  const [text, video] = await Promise.all([
    checkTextQuota(user.id),
    checkVideoQuota(user.id),
  ]);

  return res.status(200).json({
    unlimited: !!(text.premium || video.premium),
    text: { allowed: text.allowed, used: text.used ?? 0, max: text.max ?? 0 },
    video: { allowed: video.allowed, used: video.used ?? 0, max: video.max ?? 0 },
  });
}
