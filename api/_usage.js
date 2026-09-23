// 수익화 사용량 판정 공통 모듈 (2026-08-27 게스트 리텐션 정책 반영)
// - 텍스트 피드백: 무료 1일 1회 (KST 자정 리셋) + 광고 크레딧 하루 최대 +2
// - 영상 분석: 무료 평생 3회 체험
// - premium_members(구독/베타 명단): 공정사용 상한 — 텍스트 10/일, 영상 15/월
//   (완전 무제한은 남용 시 확정 적자 — 2026-08-06 가격정책 결정)
// - 게스트(비로그인) AI 체험: 평생 최대 3회, 단 하루(KST) 1회 — 최소 3일에 걸쳐
//   돌아와야 3회를 다 쓰게 해 리텐션 유도 (2026-08-27 정책 변경)
// - 사용자 식별: Authorization: Bearer <supabase access token>
//   식별 불가(구버전 앱)면 게스트로 강등. 게스트는 X-Device-Id, 헤더가 없으면 IP로 판정
//   (헤더를 빼면 쿼터 검사가 스킵돼 무제한이 되던 구멍 차단 — 2026-08-22)
// 테이블: schema-usage.sql + schema-data-assets.sql 참조
import { createClient } from "@supabase/supabase-js";

const APP_TOKEN = process.env.APP_SECRET || "";

export const TEXT_DAILY_FREE = 1;
export const AD_CREDITS_MAX = 2;
export const VIDEO_TRIAL_TOTAL = 3;
export const PREMIUM_TEXT_DAILY = 10; // 공정사용 상한
export const PREMIUM_VIDEO_MONTHLY = 15;
export const GUEST_TRIAL_TOTAL = 3; // 비로그인 게스트: 평생 3회(텍스트+영상 합산), 하루 1회 체험 후 가입 유도

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

// 앱 전용 토큰 검사. APP_SECRET 미설정 시 통과(비상 스위치).
export function checkAppToken(req) {
  if (!APP_TOKEN) return true;
  return req.headers["x-app-token"] === APP_TOKEN;
}

export function rejectAppToken(res) {
  return res.status(401).json({
    error: "unauthorized",
    message: "앱을 최신 버전으로 업데이트해주세요. / Please update the app to the latest version.",
  });
}

// Authorization 헤더의 Supabase 액세스 토큰으로 사용자 식별. 실패 시 null.
export async function identifyUser(req) {
  if (!supabase) return null;
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    const { data, error } = await supabase.auth.getUser(m[1]);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

function kstDay(ts = Date.now()) {
  return new Date(ts + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function isUnlimited(userId) {
  const { data } = await supabase
    .from("premium_members")
    .select("kind")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  return !!data;
}

// 앱 "프리미엄 이용 중" 표시용 구독 상태 조회. premium_members 1행을 그대로 반영.
// note 형식(rc-webhook.js): 구독 "rc:<TYPE>:<product_id>:<ISO>", 만료/해지 "rc:<TYPE>:<ISO>"
// (product_id 없음) — product_id에 "monthly"/"yearly" 포함 여부로 plan 판정, comp는 plan 없음.
// 실패·미등재 시 비활성으로 판정 (판정 실패가 서비스를 막으면 안 됨 — 기존 관례).
export async function getPremiumInfo(userId) {
  const empty = { active: false, kind: null, plan: null, since: null };
  if (!supabase) return empty;
  try {
    const { data } = await supabase
      .from("premium_members")
      .select("kind, note, created_at, active")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return empty;
    let plan = null;
    if (data.kind === "sub" && typeof data.note === "string") {
      if (data.note.includes("monthly")) plan = "monthly";
      else if (data.note.includes("yearly")) plan = "yearly";
    }
    return {
      active: !!data.active,
      kind: data.kind ?? null,
      plan,
      since: data.created_at ?? null,
    };
  } catch (e) {
    console.error("[usage] getPremiumInfo:", e.message);
    return empty;
  }
}

// 텍스트 피드백 판정. { allowed, used, max, premium? }
export async function checkTextQuota(userId) {
  if (!supabase) return { allowed: true };
  try {
    if (await isUnlimited(userId)) {
      // 프리미엄 공정사용: 10/일 (일반 사용자는 절대 안 닿고 남용만 차단)
      const { data } = await supabase
        .from("ai_usage_daily")
        .select("text_count")
        .eq("user_id", userId)
        .eq("day", kstDay())
        .maybeSingle();
      const used = data?.text_count || 0;
      return { allowed: used < PREMIUM_TEXT_DAILY, used, max: PREMIUM_TEXT_DAILY, premium: true };
    }
    const { data } = await supabase
      .from("ai_usage_daily")
      .select("text_count, ad_credits")
      .eq("user_id", userId)
      .eq("day", kstDay())
      .maybeSingle();
    const used = data?.text_count || 0;
    const max = TEXT_DAILY_FREE + Math.min(data?.ad_credits || 0, AD_CREDITS_MAX);
    return { allowed: used < max, used, max };
  } catch (e) {
    console.error("[usage] checkTextQuota:", e.message);
    return { allowed: true }; // 판정 실패가 서비스를 막으면 안 됨
  }
}

export async function consumeText(userId, { strict = false } = {}) {
  if (!supabase) {
    if (strict) throw new Error("usage_storage_unavailable");
    return;
  }
  try {
    const day = kstDay();
    const { data, error: readError } = await supabase
      .from("ai_usage_daily")
      .select("text_count")
      .eq("user_id", userId)
      .eq("day", day)
      .maybeSingle();
    if (readError) throw readError;
    const { error } = await supabase.from("ai_usage_daily").upsert(
      {
        user_id: userId,
        day,
        text_count: (data?.text_count || 0) + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,day" }
    );
    if (error) throw error;
  } catch (e) {
    console.error("[usage] consumeText:", e.message);
    if (strict) throw e;
  }
}

// 영상 분석 판정 (무료: 평생 체험 / 프리미엄: 월 15회). { allowed, used, max, premium? }
export async function checkVideoQuota(userId) {
  if (!supabase) return { allowed: true };
  try {
    if (await isUnlimited(userId)) {
      // 월 합산 (KST 기준 이번 달) — video_count 컬럼 미적용 시 catch로 통과 (안전 저하)
      const monthStart = kstDay().slice(0, 8) + "01";
      const { data, error } = await supabase
        .from("ai_usage_daily")
        .select("video_count")
        .eq("user_id", userId)
        .gte("day", monthStart);
      if (error) throw error;
      const used = (data || []).reduce((s, r) => s + (r.video_count || 0), 0);
      return { allowed: used < PREMIUM_VIDEO_MONTHLY, used, max: PREMIUM_VIDEO_MONTHLY, premium: true };
    }
    const { data } = await supabase
      .from("ai_video_usage")
      .select("total_count")
      .eq("user_id", userId)
      .maybeSingle();
    const used = data?.total_count || 0;
    return { allowed: used < VIDEO_TRIAL_TOTAL, used, max: VIDEO_TRIAL_TOTAL };
  } catch (e) {
    console.error("[usage] checkVideoQuota:", e.message);
    return { allowed: true };
  }
}

export async function consumeVideo(userId) {
  if (!supabase) return;
  try {
    const { data } = await supabase
      .from("ai_video_usage")
      .select("total_count")
      .eq("user_id", userId)
      .maybeSingle();
    await supabase.from("ai_video_usage").upsert(
      {
        user_id: userId,
        total_count: (data?.total_count || 0) + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  } catch (e) {
    console.error("[usage] consumeVideo:", e.message);
  }
  // 프리미엄 월 상한용 일별 카운트 (video_count 컬럼 미적용 시 조용히 실패 — 무해)
  try {
    const day = kstDay();
    const { data: daily } = await supabase
      .from("ai_usage_daily")
      .select("text_count, video_count")
      .eq("user_id", userId)
      .eq("day", day)
      .maybeSingle();
    await supabase.from("ai_usage_daily").upsert(
      {
        user_id: userId,
        day,
        text_count: daily?.text_count || 0,
        video_count: (daily?.video_count || 0) + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,day" }
    );
  } catch (e) {
    console.error("[usage] consumeVideo daily:", e.message);
  }
}

// ── 게스트(비로그인) 체험 ── deviceId로 식별. 평생 최대 3회(텍스트+영상 공유 카운터),
// 단 하루(KST) 1회만 — updated_at의 KST 날짜로 "오늘 이미 썼는지" 판정해 강제.
// 앱은 로그인 안 되면 X-Device-Id 헤더를 보냄. 헤더가 없으면(구버전 앱·deviceId 캐시
// 미로드·앱 밖 직접 호출) IP를 대체 식별자로 쓴다. 여기서 null을 돌려주면 호출부의
// if (guestId) 안으로 못 들어가 쿼터 검사가 통째로 스킵되고, 앱 토큰만 있으면 무제한
// 무료 호출이 된다 (2026-08-22 실측 확인 후 차단).
export function identifyGuest(req) {
  const id = req.headers["x-device-id"];
  if (typeof id === "string" && id.length > 3 && id.length <= 128) return id;
  const fwd = req.headers["x-forwarded-for"];
  const raw = typeof fwd === "string" ? fwd.split(",")[0] : req.headers["x-real-ip"];
  const ip = typeof raw === "string" ? raw.trim() : "";
  return ip ? "ip:" + ip.slice(0, 120) : null;
}

export async function checkGuestQuota(deviceId) {
  if (!supabase) return { allowed: true };
  try {
    const { data } = await supabase
      .from("guest_ai_usage")
      .select("count, updated_at")
      .eq("device_id", deviceId)
      .maybeSingle();
    const used = data?.count || 0;
    // updated_at(마지막 사용 시각)의 KST 날짜가 오늘과 같으면 "오늘 이미 씀" → 하루 1회 게이트
    const usedToday = data?.updated_at
      ? kstDay(Date.parse(data.updated_at)) === kstDay()
      : false;
    return { allowed: used < GUEST_TRIAL_TOTAL && !usedToday, used, max: GUEST_TRIAL_TOTAL };
  } catch (e) {
    console.error("[usage] checkGuestQuota:", e.message);
    return { allowed: true }; // 판정 실패가 서비스를 막으면 안 됨
  }
}

export async function consumeGuest(deviceId, { strict = false } = {}) {
  if (!supabase) {
    if (strict) throw new Error("usage_storage_unavailable");
    return;
  }
  try {
    const { data, error: readError } = await supabase
      .from("guest_ai_usage")
      .select("count")
      .eq("device_id", deviceId)
      .maybeSingle();
    if (readError) throw readError;
    const { error } = await supabase.from("guest_ai_usage").upsert(
      { device_id: deviceId, count: (data?.count || 0) + 1, updated_at: new Date().toISOString() },
      { onConflict: "device_id" }
    );
    // upsert 실패를 조용히 넘기면 게스트 카운트가 0에 머물러 무제한 체험이 됨 → 반드시 로깅
    if (error) throw error;
  } catch (e) {
    console.error("[usage] consumeGuest:", e.message);
    if (strict) throw e;
  }
}

// 리워드 광고 시청 → 당일 크레딧 +1 (하루 최대 AD_CREDITS_MAX). 1.10.14 앱에서 호출.
export async function grantAdCredit(userId) {
  if (!supabase) return { granted: false };
  try {
    const day = kstDay();
    const { data } = await supabase
      .from("ai_usage_daily")
      .select("text_count, ad_credits")
      .eq("user_id", userId)
      .eq("day", day)
      .maybeSingle();
    const current = data?.ad_credits || 0;
    if (current >= AD_CREDITS_MAX) {
      return { granted: false, adCredits: current, max: AD_CREDITS_MAX };
    }
    const { error } = await supabase.from("ai_usage_daily").upsert(
      {
        user_id: userId,
        day,
        text_count: data?.text_count || 0,
        ad_credits: current + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,day" }
    );
    // upsert 실패인데 granted:true를 주면 광고를 봤는데 크레딧이 없는 유령 적립이 된다
    if (error) {
      console.error("[usage] grantAdCredit upsert failed:", userId, error.message);
      return { granted: false, adCredits: current, max: AD_CREDITS_MAX };
    }
    return { granted: true, adCredits: current + 1, max: AD_CREDITS_MAX };
  } catch (e) {
    console.error("[usage] grantAdCredit:", e.message);
    return { granted: false };
  }
}
