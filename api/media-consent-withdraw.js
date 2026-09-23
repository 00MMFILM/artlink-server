// 학습자산 보관 동의 철회 — 해당 유저의 media-archive 객체 + media_assets 행 삭제.
// 인증: checkAppToken(앱 토큰) + identifyUser(Bearer). 인증 없으면 401.
// 공유 계약: POST /api/media-consent-withdraw → { ok, deleted }
import { checkAppToken, rejectAppToken, identifyUser } from "./_usage.js";
import { withdrawUserArchive } from "./_archive.js";

const SCOPE = { scope: "authenticated_media_archive", excludes: ["training_data", "guest_media_archive"] };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!checkAppToken(req)) return rejectAppToken(res);

  const user = await identifyUser(req);
  if (!user) return res.status(401).json({ ok: false, complete: false, error: "authenticated_archive_only", ...SCOPE });

  try {
    const { deleted } = await withdrawUserArchive(user.id);
    return res.status(200).json({ ok: true, complete: true, deleted, ...SCOPE });
  } catch (e) {
    console.error("[media-consent-withdraw]", e.message);
    return res.status(500).json({ ok: false, complete: false, error: "withdraw_failed", retryable: true, ...SCOPE });
  }
}
