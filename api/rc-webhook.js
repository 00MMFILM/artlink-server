import { createClient } from "@supabase/supabase-js";
import { fetchProductionPremium } from "./_revenuecat.js";

// RevenueCat 웹훅 — 구독 이벤트를 premium_members에 반영
// RevenueCat 대시보드 웹훅 설정: URL=https://art-link.kr/api/rc-webhook,
// Authorization 헤더 값 = RC_WEBHOOK_AUTH 환경변수와 일치시킬 것
// app_user_id = Supabase auth user id (앱에서 로그인 시 Purchases.logIn(authUserId))

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

// 이벤트 이름을 활성/비활성 값으로 바로 번역하면 역순으로 도착한 과거 이벤트가 최신 결제를 덮는다.
// 변경 통지마다 RevenueCat 정본을 읽어 현재 권한으로 맞춘다.
const RECONCILE = new Set(["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "EXPIRATION"]);
// CANCELLATION은 자동갱신 해제일 수 있어 이 이벤트 이름만으로 권한을 끄지 않는다.

async function reconcilePremium(ids, type, secret) {
  // 모든 조회가 성공한 뒤 저장한다. API 장애를 권한 없음으로 저장하지 않는다.
  const states = await Promise.all(ids.map(async id => ({ id, ...await fetchProductionPremium(id, secret) })));
  for (const state of states) {
    if (state.sandboxOnly) continue;
    const note = `rc:${type}:${state.productId || ""}:${new Date().toISOString()}`;
    // 확인된 실결제는 기존 정책대로 comp → sub로 승격한다.
    // 반대로 구매가 없을 때는 구독만 끈다. 별도로 지정한 comp를 오래된 만료 통지가 제거하면 안 된다.
    const { error } = state.active
      ? await supabase.from("premium_members").upsert({ user_id: state.id, kind: "sub", active: true, note })
      : await supabase.from("premium_members").update({ active: false, note }).eq("user_id", state.id).eq("kind", "sub");
    if (error) throw error;
  }
}

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
    // 한 사용자에게 sandbox/운영 구매가 함께 있을 수 있다. 테스트 구매/만료로 운영 장부를 바꾸지 않는다.
    if (event.environment === "SANDBOX") return res.status(200).json({ skipped: "sandbox" });

    // TRANSFER에는 app_user_id가 없다. 송신/수신 양쪽의 최신 구매 상태를 조회해야 한다.
    // https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
    if (type === "TRANSFER") {
      const secret = process.env.REVENUECAT_SECRET_KEY;
      if (!secret) return res.status(503).json({ error: "revenuecat_not_configured" });
      if (!Array.isArray(event.transferred_from) || !Array.isArray(event.transferred_to)) {
        return res.status(400).json({ error: "transfer_ids_required" });
      }
      const ids = [...new Set([...event.transferred_from, ...event.transferred_to])]
        .filter(id => typeof id === "string" && id && !id.startsWith("$RCAnonymousID"));
      await reconcilePremium(ids, type, secret);
      return res.status(200).json({ ok: true });
    }

    const userId = event.app_user_id;
    // 익명 ID($RCAnonymousID:...)는 Supabase 유저와 매칭 불가 — 로그인 유도 후 재시도됨
    if (typeof userId !== "string" || !userId || userId.startsWith("$RCAnonymousID")) {
      console.log("[rc-webhook] skip anonymous:", type);
      return res.status(200).json({ skipped: "anonymous" });
    }

    if (RECONCILE.has(type)) {
      const secret = process.env.REVENUECAT_SECRET_KEY;
      if (!secret) return res.status(503).json({ error: "revenuecat_not_configured" });
      await reconcilePremium([userId], type, secret);
      console.log("[rc-webhook] reconciled:", type);
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
