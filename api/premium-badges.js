// 커뮤니티 글 작성자 옆 프리미엄(👑) 배지용 — 활성 프리미엄 user_id 목록
// GET, 헤더: X-App-Token
// community_posts 테이블에 컬럼 추가(마이그레이션) 없이, 앱이 이 목록으로
// 글 user_id를 대조해 배지를 그린다. premium_members.active=true만 반환하므로
// 기존 글에도 소급 적용되고 클라이언트가 위조할 수 없다(서버가 판정한 목록).
// 개인정보 없음 — uuid만 노출. 5분 캐시(CDN/클라이언트 공용).
import { createClient } from "@supabase/supabase-js";
import { checkAppToken, rejectAppToken } from "./_usage.js";

const MAX_ROWS = 1000; // 현재 활성 프리미엄 18명 — 여유 상한

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!checkAppToken(req)) return rejectAppToken(res);

  if (!supabase) return res.status(500).json({ error: "server_misconfigured" });

  try {
    const { data, error } = await supabase
      .from("premium_members")
      .select("user_id")
      .eq("active", true)
      .limit(MAX_ROWS);

    if (error) throw error;

    const userIds = (data || []).map((r) => r.user_id);
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({
      userIds,
      count: userIds.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[premium-badges]", e.message);
    return res.status(500).json({ error: "query_failed" });
  }
}
