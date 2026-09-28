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
  if (req.method && !["GET", "HEAD"].includes(req.method)) {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    return res.end();
  }
  const params = new URL(req.url, "http://x").searchParams;
  const ua = req.headers["user-agent"] || "";
  // An explicit store button must work on desktop too. Destinations are fixed;
  // arbitrary platform values never become redirect URLs.
  const requested = params.get("platform");
  const platform = ["ios", "android"].includes(requested) ? requested : /android/i.test(ua)
    ? "android"
    : /iphone|ipad|ipod|macintosh/i.test(ua)
    ? "ios"
    : "desktop";
  const dest = platform === "android" ? PLAY : platform === "ios" ? APPSTORE : LANDING;

  try {
    const candidate = params.get("s");
    const source = /^[a-z0-9_-]{1,40}$/.test(candidate || "") ? candidate : "direct";
    // 봇/크롤러 노이즈 제외 (미리보기 등)
    const isBot = /bot|crawl|spider|facebookexternalhit|preview|slurp|bingpreview/i.test(ua);
    if (supabase && !isBot && req.method !== "HEAD") {
      let referer = null;
      try {
        const from = new URL(req.headers["referer"]);
        if (["https:", "http:"].includes(from.protocol)) referer = `${from.origin}${from.pathname}`.slice(0, 300);
      } catch (_) {}
      await supabase.from("link_clicks").insert({
        link: "app",
        source,
        platform,
        referer,
      });
    }
  } catch (_) {}

  res.statusCode = 302;
  res.setHeader("Location", dest);
  res.setHeader("Cache-Control", "no-store");
  res.end();
};
