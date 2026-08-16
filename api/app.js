// 스마트 앱 다운로드 링크 — 기기 감지해서 스토어로 302 + 클릭 로깅(유입원 attribution).
// 아이폰/아이패드/맥 → 앱스토어, 안드로이드 → 플레이스토어, 그 외 → 랜딩.
// ?s=threads 등으로 유입원 구분. 클릭은 link_clicks 테이블에 기록(실패해도 리다이렉트는 진행).
const { createClient } = require("@supabase/supabase-js");
const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

const APPSTORE = "https://apps.apple.com/kr/app/%EC%95%84%ED%8A%B8%EB%A7%81%ED%81%AC/id6752890224";
const PLAY = "https://play.google.com/store/apps/details?id=com.mm00.artlink";
const LANDING = "https://art-link.kr/launch";

module.exports = async (req, res) => {
  const ua = req.headers["user-agent"] || "";
  const platform = /android/i.test(ua)
    ? "android"
    : /iphone|ipad|ipod|macintosh/i.test(ua)
    ? "ios"
    : "desktop";
  const dest = platform === "android" ? PLAY : platform === "ios" ? APPSTORE : LANDING;

  try {
    const url = new URL(req.url, "http://x");
    const source = (url.searchParams.get("s") || "direct").slice(0, 40);
    // 봇/크롤러 노이즈 제외 (미리보기 등)
    const isBot = /bot|crawl|spider|facebookexternalhit|preview|slurp|bingpreview/i.test(ua);
    if (supabase && !isBot) {
      await supabase.from("link_clicks").insert({
        link: "app",
        source,
        platform,
        referer: (req.headers["referer"] || "").slice(0, 300) || null,
      });
    }
  } catch (_) {}

  res.statusCode = 302;
  res.setHeader("Location", dest);
  res.setHeader("Cache-Control", "no-store");
  res.end();
};
