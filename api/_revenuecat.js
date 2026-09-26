// 서버 장부에는 확인된 운영 구매만 반영한다. SDK의 TestFlight entitlement와 분리한다.
// v1 entitlements에는 환경이 없으므로 같은 상품의 subscriptions/non_subscriptions를 확인한다.
// https://www.revenuecat.com/docs/api-v1/customer-info-model
const ENTITLEMENT_ID = "premium";

function withinPeriod(value, now) {
  if (value.expires_date === null) return true; // 비소멸성 구매
  const expires = Date.parse(value.expires_date);
  const grace = value.grace_period_expires_date ? Date.parse(value.grace_period_expires_date) : 0;
  if (!Number.isFinite(expires) || !Number.isFinite(grace)) throw new Error("rc_invalid_expiration");
  return Math.max(expires, grace) > now;
}

export function productionPremium(subscriber, now = Date.now()) {
  if (!subscriber || !subscriber.entitlements || typeof subscriber.entitlements !== "object" || Array.isArray(subscriber.entitlements)) {
    throw new Error("rc_invalid_subscriber");
  }
  const entitlement = subscriber.entitlements[ENTITLEMENT_ID];
  if (!entitlement) return { active: false };
  const productId = entitlement.product_identifier;
  if (typeof productId !== "string" || !productId) throw new Error("rc_invalid_product");
  const subscription = subscriber.subscriptions?.[productId];
  const purchases = subscriber.non_subscriptions?.[productId] || [];
  const productionPurchase = purchases.find(p => p.is_sandbox === false && !p.refunded_at);
  if (subscription?.is_sandbox === false) {
    return { active: !subscription.refunded_at && withinPeriod(subscription, now) && withinPeriod(entitlement, now), productId };
  }
  if (productionPurchase) return { active: withinPeriod(entitlement, now), productId };

  // sandbox 상태로 기존 운영 권한을 지우지 않는다. 두 환경이 섞인 계정도 기존 권한을 유지한다.
  if (subscription?.is_sandbox === true || purchases.some(p => p.is_sandbox === true)) {
    return { active: false, sandboxOnly: true, productId };
  }
  // 불완전한 응답을 비활성으로 해석해 유료 사용자의 권한을 끄면 안 된다.
  throw new Error("rc_purchase_environment_unknown");
}

export async function fetchProductionPremium(userId, secret) {
  const response = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10000) }
  );
  if (!response.ok) throw new Error(`rc_status_${response.status}`);
  const body = await response.json();
  return productionPremium(body?.subscriber);
}
