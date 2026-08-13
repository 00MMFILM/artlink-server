import { createClient } from "@supabase/supabase-js";

// RevenueCat 웹훅 — 구독 이벤트를 premium_members에 반영
// RevenueCat 대시보드 웹훅 설정: URL=https://art-link.kr/api/rc-webhook,
// Authorization 헤더 값 = RC_WEBHOOK_AUTH 환경변수와 일치시킬 것
// app_user_id = Supabase auth user id (앱에서 로그인 시 Purchases.logIn(authUserId))

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

// 활성화 이벤트 / 비활성화 이벤트 분류
const ACTIVATE = new Set(["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE"]);
const DEACTIVATE = new Set(["EXPIRATION"]);
// CANCELLATION은 "자동갱신 해제"일 뿐 기간 만료 전까지 이용 가능 → active 유지, EXPIRATION에서 끔

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // RevenueCat이 보내는 Authorization 헤더 검증
  const auth = req.headers["authorization"] || "";
  if (!process.env.RC_WEBHOOK_AUTH || auth !== process.env.RC_WEBHOOK_AUTH) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!supabase) return res.status(500).json({ error: "Storage not configured" });

  try {
    const event = req.body?.event;
    if (!event) return res.status(400).json({ error: "event required" });

    const type = event.type;
    const userId = event.app_user_id;
    // 익명 ID($RCAnonymousID:...)는 Supabase 유저와 매칭 불가 — 로그인 유도 후 재시도됨
    if (!userId || userId.startsWith("$RCAnonymousID")) {
      console.log("[rc-webhook] skip anonymous:", type);
      return res.status(200).json({ skipped: "anonymous" });
    }

    if (ACTIVATE.has(type)) {
      // comp(평생무료·베타 지정)는 구독 이벤트로 절대 덮지 않는다.
      // 덮으면 kind가 sub가 되어 이후 EXPIRATION에서 평생무료 권한까지 해제됨.
      const { data: existing, error: selErr } = await supabase
        .from("premium_members")
        .select("kind")
        .eq("user_id", userId)
        .maybeSingle();
      if (selErr) throw selErr;

      if (existing?.kind === "comp") {
        console.log("[rc-webhook] skip activate (comp protected):", userId, type);
      } else {
        const { error } = await supabase.from("premium_members").upsert({
          user_id: userId,
          kind: "sub",
          active: true,
          note: `rc:${type}:${event.product_id || ""}:${new Date().toISOString()}`,
        });
        if (error) throw error;
        console.log("[rc-webhook] activated:", userId, type);
      }
    } else if (DEACTIVATE.has(type)) {
      const { error } = await supabase
        .from("premium_members")
        .update({ active: false, note: `rc:${type}:${new Date().toISOString()}` })
        .eq("user_id", userId)
        .eq("kind", "sub"); // 수동 등록(comp)은 건드리지 않음
      if (error) throw error;
      console.log("[rc-webhook] deactivated:", userId, type);
    } else {
      console.log("[rc-webhook] ignored event:", type);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[rc-webhook] Error:", e.message);
    // 5xx를 주면 RevenueCat이 재시도함 — 일시 장애 복구에 유리
    return res.status(500).json({ error: "webhook failed" });
  }
}
