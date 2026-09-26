// 결제 복구 — RevenueCat이 활성인데 premium_members가 비활성일 때 앱이 직접 부른다.
// POST, 헤더: X-App-Token + Authorization: Bearer <supabase access token>
//
// 웹훅(rc-webhook.js)이 놓치는 경우가 실제로 있다: 로그인 전(익명 $RCAnonymousID) 결제,
// 웹훅 유실·401. 그때 앱 화면은 결제했는데 프리미엄이 안 켜진 상태로 남는다.
// 이 엔드포인트는 RevenueCat REST에 직접 물어 entitlement가 살아 있으면 premium_members를
// 웹훅과 같은 형태로 upsert한다. 판정 기준은 언제나 RevenueCat(결제 정본)이다.
import { createClient } from "@supabase/supabase-js";
import { checkAppToken, rejectAppToken, identifyUser } from "./_usage.js";

const ENTITLEMENT_ID = "premium"; // 앱 purchasesService.js의 ENTITLEMENT_ID와 같아야 한다

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!checkAppToken(req)) return rejectAppToken(res);

  const user = await identifyUser(req);
  if (!user) return res.status(401).json({ error: "auth_required" });

  const secret = process.env.REVENUECAT_SECRET_KEY;
  // 키가 없으면 복구는 못 하지만 앱은 RevenueCat 판정을 그대로 쓴다 — 오류가 아니라 미구성이다.
  if (!secret || !supabase) return res.status(501).json({ ok: false, reason: "not_configured" });

  let entitlement;
  try {
    const rc = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.id)}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );
    if (!rc.ok) throw new Error(`rc_status_${rc.status}`);
    const body = await rc.json();
    entitlement = body?.subscriber?.entitlements?.[ENTITLEMENT_ID] || null;
  } catch (e) {
    console.error("[premium-resync] revenuecat:", e.message);
    return res.status(502).json({ ok: false, reason: "revenuecat_unavailable" });
  }

  // expires_date가 없으면 비소멸성(평생) 구매 — 만료 없음으로 본다.
  const expires = entitlement?.expires_date ? Date.parse(entitlement.expires_date) : null;
  const active = !!entitlement && (expires === null || expires > Date.now());
  if (!active) return res.status(200).json({ ok: true, active: false });

  try {
    const { error } = await supabase.from("premium_members").upsert({
      user_id: user.id,
      kind: "sub",
      active: true,
      note: `resync:${entitlement.product_identifier || ""}:${new Date().toISOString()}`,
    });
    if (error) throw error;
  } catch (e) {
    console.error("[premium-resync] upsert:", e.message);
    return res.status(500).json({ ok: false, reason: "upsert_failed" });
  }

  console.log("[premium-resync] restored:", user.id);
  return res.status(200).json({ ok: true, active: true });
}
