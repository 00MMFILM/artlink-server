// 수익화 사용량 판정 공통 모듈 (2026-07-24 확정 구조)
// - 텍스트 피드백: 무료 1일 1회 (KST 자정 리셋) + 광고 크레딧 하루 최대 +2
// - 영상 분석: 무료 평생 3회 체험
// - premium_members(구독/베타 명단) 등재 시 무제한
// - 사용자 식별: Authorization: Bearer <supabase access token>
//   식별 불가(구버전 앱)면 판정 없이 통과 — 1.10.14부터 앱이 토큰을 보내며 자동 적용
// 테이블: schema-usage.sql 참조
import { createClient } from "@supabase/supabase-js";

const APP_TOKEN = process.env.APP_SECRET || "";

export const TEXT_DAILY_FREE = 1;
export const AD_CREDITS_MAX = 2;
export const VIDEO_TRIAL_TOTAL = 3;

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

function kstDay() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
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

// 텍스트 피드백 판정. { allowed, used, max, unlimited }
export async function checkTextQuota(userId) {
  if (!supabase) return { allowed: true };
  try {
    if (await isUnlimited(userId)) return { allowed: true, unlimited: true };
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

export async function consumeText(userId) {
  if (!supabase) return;
  try {
    const day = kstDay();
    const { data } = await supabase
      .from("ai_usage_daily")
      .select("text_count")
      .eq("user_id", userId)
      .eq("day", day)
      .maybeSingle();
    await supabase.from("ai_usage_daily").upsert(
      {
        user_id: userId,
        day,
        text_count: (data?.text_count || 0) + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,day" }
    );
  } catch (e) {
    console.error("[usage] consumeText:", e.message);
  }
}

// 영상 분석 판정 (평생 체험). { allowed, used, max, unlimited }
export async function checkVideoQuota(userId) {
  if (!supabase) return { allowed: true };
  try {
    if (await isUnlimited(userId)) return { allowed: true, unlimited: true };
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
    await supabase.from("ai_usage_daily").upsert(
      {
        user_id: userId,
        day,
        text_count: data?.text_count || 0,
        ad_credits: current + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,day" }
    );
    return { granted: true, adCredits: current + 1, max: AD_CREDITS_MAX };
  } catch (e) {
    console.error("[usage] grantAdCredit:", e.message);
    return { granted: false };
  }
}
